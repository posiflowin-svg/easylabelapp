const UsageEvent = require('../models/UsageEvent');

function clean(s) { return String(s || '').trim(); }

function normalizePrinterModel(value) {
  let model = clean(value);
  if (!model) return 'Unknown';

  // Remove a Bluetooth MAC address when it is appended to the device/model name.
  model = model.replace(/\s+[0-9A-F]{2}(?::[0-9A-F]{2}){5}.*$/i, '').trim();

  // Common printer Bluetooth names append a serial suffix:
  // CD410-1233678 / CD410-78999 -> CD410.
  // Preserve actual model names such as PSF-20 / CD410-UB.
  model = model.replace(/-\d{4,}$/i, '').trim();
  model = model.replace(/[_-][0-9A-F]{8,}$/i, '').trim();

  return model || 'Unknown';
}
function parseDate(v, endOfDay) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    if (endOfDay) d.setHours(23, 59, 59, 999); else d.setHours(0, 0, 0, 0);
  }
  return d;
}
function filtersFromQuery(q) {
  const match = {};
  const from = parseDate(q.from, false);
  const to = parseDate(q.to, true);
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = from;
    if (to) match.occurredAt.$lte = to;
  }
  if (q.type && ['LABEL_PRINT','BILL_PRINT','INVENTORY_SNAPSHOT'].includes(q.type)) match.eventType = q.type;
  const customer = clean(q.customer);
  if (customer) {
    const rx = new RegExp(customer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [{ customerName: rx }, { customerMobile: rx }, { customerEmail: rx }];
  }
  const mobile = clean(q.mobile);
  if (mobile) match.customerMobile = new RegExp(mobile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return match;
}

exports.ingest = async (req, res) => {
  try {
    const events = Array.isArray(req.body && req.body.events) ? req.body.events : [];
    if (!events.length) return res.json({ success: true, accepted: 0, duplicate: 0 });
    let accepted = 0, duplicate = 0, invalid = 0;
    for (const raw of events.slice(0, 500)) {
      try {
        const eventId = clean(raw.eventId);
        const eventType = clean(raw.eventType);
        if (!eventId || !['LABEL_PRINT','BILL_PRINT','INVENTORY_SNAPSHOT'].includes(eventType)) { invalid++; continue; }
        const doc = {
          eventId, eventType,
          customerId: clean(raw.customerId), customerName: clean(raw.customerName),
          customerMobile: clean(raw.customerMobile), customerEmail: clean(raw.customerEmail),
          deviceId: clean(raw.deviceId), appVersion: clean(raw.appVersion),
          printerModel: clean(raw.printerModel), printerModelNormalized: normalizePrinterModel(raw.printerModel), source: clean(raw.source),
          occurredAt: new Date(Number(raw.occurredAt) || raw.occurredAt || Date.now()),
          labelWidthMm: Number(raw.labelWidthMm) || 0, labelHeightMm: Number(raw.labelHeightMm) || 0,
          copies: Math.max(0, Number(raw.copies) || 0), billNo: clean(raw.billNo),
          billAmount: Math.max(0, Number(raw.billAmount) || 0), itemCount: Math.max(0, Number(raw.itemCount) || 0),
          paymentMode: clean(raw.paymentMode),
          inventoryCount: Math.max(0, Number(raw.inventoryCount) || 0),
          inventoryItems: Array.isArray(raw.inventoryItems) ? raw.inventoryItems.slice(0, 500).map(x => ({ productId: clean(x.productId), name: clean(x.name), category: clean(x.category) })) : []
        };
        const r = await UsageEvent.updateOne({ eventId }, { $setOnInsert: doc }, { upsert: true });
        if (r.upsertedCount) accepted++; else duplicate++;
      } catch (e) { invalid++; }
    }
    res.json({ success: true, accepted, duplicate, invalid });
  } catch (e) {
    console.error('Usage ingest failed', e);
    res.status(500).json({ success: false, message: 'Unable to save usage events' });
  }
};

exports.summary = async (req, res) => {
  try {
    const match = filtersFromQuery(req.query || {});
    const [totals, sizeWise, daily] = await Promise.all([
      UsageEvent.aggregate([
        { $match: match },
        { $group: { _id: null,
          labelPrintJobs: { $sum: { $cond: [{ $eq: ['$eventType','LABEL_PRINT'] }, 1, 0] } },
          labelsPrinted: { $sum: { $cond: [{ $eq: ['$eventType','LABEL_PRINT'] }, '$copies', 0] } },
          billsPrinted: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, 1, 0] } },
          totalSales: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, '$billAmount', 0] } },
          users: { $addToSet: {
            $cond: [
              { $ne: ['$customerMobile',''] },
              { $concat: ['m:', '$customerMobile'] },
              { $concat: ['i:', '$customerId'] }
            ]
          } }
        } },
        { $project: {
          _id: 0, labelPrintJobs: 1, labelsPrinted: 1, billsPrinted: 1,
          totalSales: 1, activeCustomers: { $size: '$users' }
        } }
      ]),
      UsageEvent.aggregate([
        { $match: { ...match, eventType: 'LABEL_PRINT' } },
        { $group: { _id: { w: '$labelWidthMm', h: '$labelHeightMm' }, copies: { $sum: '$copies' }, jobs: { $sum: 1 } } },
        { $sort: { copies: -1 } }, { $limit: 20 }
      ]),
      UsageEvent.aggregate([
        { $match: match },
        { $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Asia/Kolkata' } } },
          labels: { $sum: { $cond: [{ $eq: ['$eventType','LABEL_PRINT'] }, '$copies', 0] } },
          bills: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, 1, 0] } },
          sales: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, '$billAmount', 0] } }
        } },
        { $sort: { '_id.day': 1 } }, { $limit: 120 }
      ])
    ]);

    res.json({
      success: true,
      totals: totals[0] || { labelPrintJobs:0, labelsPrinted:0, billsPrinted:0, totalSales:0, activeCustomers:0 },
      sizeWise,
      daily
    });
  } catch (e) {
    console.error('Usage summary failed', e);
    res.status(500).json({ success:false, message:'Unable to load usage analytics' });
  }
};

function pageNumber(value) {
  return Math.max(1, parseInt(value, 10) || 1);
}

exports.customers = async (req, res) => {
  try {
    const match = filtersFromQuery(req.query || {});
    const page = pageNumber(req.query.page);
    const limit = 100;
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: match },
      { $sort: { occurredAt: 1 } },
      { $group: {
        _id: {
          key: {
            $cond: [
              { $ne: ['$customerMobile',''] },
              { $concat: ['m:', '$customerMobile'] },
              { $concat: ['i:', '$customerId'] }
            ]
          },
          mobile: '$customerMobile',
          id: '$customerId'
        },
        name: { $last: '$customerName' },
        email: { $last: '$customerEmail' },
        labels: { $sum: { $cond: [{ $eq:['$eventType','LABEL_PRINT'] }, '$copies', 0] } },
        printJobs: { $sum: { $cond: [{ $eq:['$eventType','LABEL_PRINT'] }, 1, 0] } },
        bills: { $sum: { $cond: [{ $eq:['$eventType','BILL_PRINT'] }, 1, 0] } },
        sales: { $sum: { $cond: [{ $eq:['$eventType','BILL_PRINT'] }, '$billAmount', 0] } },
        lastActivity: { $max: '$occurredAt' }
      } },
      { $sort: { labels: -1, printJobs: -1, lastActivity: -1 } },
      { $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }]
      } }
    ];

    const result = await UsageEvent.aggregate(pipeline).allowDiskUse(true);
    const row = result[0] || { data: [], meta: [] };
    const total = row.meta[0] ? row.meta[0].total : 0;

    res.json({
      success: true,
      data: row.data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (e) {
    console.error('Usage customer summary failed', e);
    res.status(500).json({ success:false, message:'Unable to load customer summary' });
  }
};

exports.recent = async (req, res) => {
  try {
    const match = filtersFromQuery(req.query || {});
    const page = pageNumber(req.query.page);
    const limit = 100;
    const skip = (page - 1) * limit;

    // Inventory snapshots are background sync records and are intentionally not
    // shown as "Recent Activity" unless the admin explicitly filters Inventory.
    if (!req.query.type) match.eventType = { $in: ['LABEL_PRINT','BILL_PRINT'] };

    const [data, total] = await Promise.all([
      UsageEvent.find(match).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
      UsageEvent.countDocuments(match)
    ]);

    res.json({
      success:true,
      data,
      pagination:{ page, limit, total, pages:Math.max(1, Math.ceil(total / limit)) }
    });
  } catch(e) {
    console.error('Usage recent activity failed', e);
    res.status(500).json({ success:false, message:'Unable to load recent activity' });
  }
};

exports.customerActivity = async (req, res) => {
  try {
    const mobile = clean(req.query.mobile);
    const id = clean(req.query.id);
    const who = {};
    if (mobile) who.customerMobile = mobile;
    else if (id) who.customerId = id;
    else return res.status(400).json({ success:false, message:'Customer required' });

    const dateMatch = filtersFromQuery({ from:req.query.from, to:req.query.to });
    const match = { ...who };
    if (dateMatch.occurredAt) match.occurredAt = dateMatch.occurredAt;
    match.eventType = { $in:['LABEL_PRINT','BILL_PRINT'] };

    const page = pageNumber(req.query.page);
    const limit = 100;
    const skip = (page - 1) * limit;

    const [data,total,totals] = await Promise.all([
      UsageEvent.find(match).sort({ occurredAt:-1 }).skip(skip).limit(limit).lean(),
      UsageEvent.countDocuments(match),
      UsageEvent.aggregate([
        { $match: match },
        { $group: { _id:null,
          labels:{ $sum:{ $cond:[{$eq:['$eventType','LABEL_PRINT']},'$copies',0] } },
          printJobs:{ $sum:{ $cond:[{$eq:['$eventType','LABEL_PRINT']},1,0] } },
          bills:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},1,0] } },
          sales:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},'$billAmount',0] } }
        } }
      ])
    ]);

    res.json({
      success:true,
      data,
      totals: totals[0] || { labels:0, printJobs:0, bills:0, sales:0 },
      pagination:{ page, limit, total, pages:Math.max(1,Math.ceil(total/limit)) }
    });
  } catch(e) {
    console.error('Usage customer activity failed',e);
    res.status(500).json({success:false,message:'Unable to load customer activity'});
  }
};

exports.models = async (req, res) => {
  try {
    const match = filtersFromQuery(req.query || {});
    const labelMatch = { ...match, eventType:'LABEL_PRINT' };

    const raw = await UsageEvent.aggregate([
      { $match: labelMatch },
      { $group: {
        _id: {
          normalized: '$printerModelNormalized',
          raw: '$printerModel'
        },
        commands:{ $sum:1 },
        copies:{ $sum:'$copies' },
        customers:{ $addToSet:{
          $cond:[
            { $ne:['$customerMobile',''] },
            { $concat:['m:','$customerMobile'] },
            { $concat:['i:','$customerId'] }
          ]
        } },
        lastUsed:{ $max:'$occurredAt' }
      } }
    ]).allowDiskUse(true);

    // Merge historical rows that predate printerModelNormalized. This keeps all
    // lifetime data usable without rewriting or deleting old events.
    const map = new Map();
    for (const row of raw) {
      const name = clean(row._id && row._id.normalized) || normalizePrinterModel(row._id && row._id.raw);
      const key = name || 'Unknown';
      const current = map.get(key) || {
        model:key, commands:0, copies:0, customers:new Set(), lastUsed:null
      };
      current.commands += Number(row.commands || 0);
      current.copies += Number(row.copies || 0);
      for (const customer of (row.customers || [])) current.customers.add(customer);
      if (!current.lastUsed || (row.lastUsed && new Date(row.lastUsed) > new Date(current.lastUsed))) {
        current.lastUsed = row.lastUsed;
      }
      map.set(key,current);
    }

    const data = Array.from(map.values())
      .map(x => ({
        model:x.model,
        commands:x.commands,
        copies:x.copies,
        uniqueCustomers:x.customers.size,
        lastUsed:x.lastUsed
      }))
      .sort((a,b) => (b.copies-a.copies) || (b.commands-a.commands));

    res.json({ success:true, data });
  } catch(e) {
    console.error('Usage printer models failed',e);
    res.status(500).json({success:false,message:'Unable to load printer models'});
  }
};


exports.customerDetail = async (req,res) => {
  try {
    const mobile=clean(req.query.mobile), id=clean(req.query.id);
    const who={}; if(mobile) who.customerMobile=mobile; else if(id) who.customerId=id; else return res.status(400).json({success:false,message:'Customer required'});
    const dateMatch=filtersFromQuery({from:req.query.from,to:req.query.to});
    const occurredAt=dateMatch.occurredAt;
    const base={...who}; if(occurredAt) base.occurredAt=occurredAt;
    const [labels,bills,inventory] = await Promise.all([
      UsageEvent.aggregate([{ $match:{...base,eventType:'LABEL_PRINT'}},{ $group:{_id:{w:'$labelWidthMm',h:'$labelHeightMm'},copies:{$sum:'$copies'},jobs:{$sum:1}}},{ $sort:{copies:-1}}]),
      UsageEvent.find({...base,eventType:'BILL_PRINT'}).sort({occurredAt:-1}).limit(500).lean(),
      UsageEvent.findOne({...who,eventType:'INVENTORY_SNAPSHOT'}).sort({occurredAt:-1}).lean()
    ]);
    res.json({success:true,labels,bills,inventory:inventory?{count:inventory.inventoryCount||0,items:inventory.inventoryItems||[],occurredAt:inventory.occurredAt}:{count:0,items:[]}});
  } catch(e) { console.error('Usage customer detail failed',e); res.status(500).json({success:false,message:'Unable to load customer details'}); }
};

exports.page = (req,res) => res.render('usage-analytics');
