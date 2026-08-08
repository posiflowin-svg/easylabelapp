const UsageEvent = require('../models/UsageEvent');

function clean(s) { return String(s || '').trim(); }
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
          printerModel: clean(raw.printerModel), source: clean(raw.source),
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
    const [totals, sizeWise, customers, recent, daily] = await Promise.all([
      UsageEvent.aggregate([
        { $match: match },
        { $group: { _id: null,
          labelPrintJobs: { $sum: { $cond: [{ $eq: ['$eventType','LABEL_PRINT'] }, 1, 0] } },
          labelsPrinted: { $sum: { $cond: [{ $eq: ['$eventType','LABEL_PRINT'] }, '$copies', 0] } },
          billsPrinted: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, 1, 0] } },
          totalSales: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, '$billAmount', 0] } },
          totalItems: { $sum: { $cond: [{ $eq: ['$eventType','BILL_PRINT'] }, '$itemCount', 0] } },
          users: { $addToSet: { $cond: [{ $ne: ['$customerMobile',''] }, '$customerMobile', '$customerId'] } }
        } },
        { $project: { _id:0,labelPrintJobs:1,labelsPrinted:1,billsPrinted:1,totalSales:1,totalItems:1,activeCustomers:{ $size:'$users' } } }
      ]),
      UsageEvent.aggregate([
        { $match: { ...match, eventType:'LABEL_PRINT' } },
        { $group: { _id: { w:'$labelWidthMm', h:'$labelHeightMm' }, copies:{ $sum:'$copies' }, jobs:{ $sum:1 } } },
        { $sort: { copies:-1 } }, { $limit:30 }
      ]),
      UsageEvent.aggregate([
        { $match: match },
        { $group: { _id: { mobile:'$customerMobile', id:'$customerId' }, name:{ $last:'$customerName' }, email:{ $last:'$customerEmail' },
          labels:{ $sum:{ $cond:[{$eq:['$eventType','LABEL_PRINT']},'$copies',0] } },
          bills:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},1,0] } },
          sales:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},'$billAmount',0] } },
          soldItems:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},'$itemCount',0] } }, lastActivity:{ $max:'$occurredAt' }
        } },
        { $sort:{ lastActivity:-1 } }, { $limit:250 }
      ]),
      UsageEvent.find(match).sort({occurredAt:-1}).limit(150).lean(),
      UsageEvent.aggregate([
        { $match: match },
        { $group:{ _id:{ day:{ $dateToString:{ format:'%Y-%m-%d',date:'$occurredAt',timezone:'Asia/Kolkata' } } },
          labels:{ $sum:{ $cond:[{$eq:['$eventType','LABEL_PRINT']},'$copies',0] } },
          bills:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},1,0] } },
          sales:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},'$billAmount',0] } }
        } }, { $sort:{'_id.day':1} }, { $limit:120 }
      ])
    ]);
    const inventoryLatest = await UsageEvent.aggregate([
      { $match: { ...match, eventType:'INVENTORY_SNAPSHOT' } },
      { $sort: { occurredAt:-1 } },
      { $group: { _id:{ mobile:'$customerMobile', id:'$customerId' }, inventoryCount:{ $first:'$inventoryCount' }, inventoryItems:{ $first:'$inventoryItems' } } }
    ]);
    const invMap = new Map(inventoryLatest.map(x => [String(x._id.mobile||'')+'|'+String(x._id.id||''), x]));
    customers.forEach(x => { const inv=invMap.get(String(x._id.mobile||'')+'|'+String(x._id.id||'')); x.items = inv ? inv.inventoryCount : 0; x.inventoryItems = inv ? inv.inventoryItems : []; });
    const outTotals=totals[0] || {labelPrintJobs:0,labelsPrinted:0,billsPrinted:0,totalSales:0,totalItems:0,activeCustomers:0};
    outTotals.inventoryItems = customers.reduce((n,x)=>n+(Number(x.items)||0),0);
    res.json({ success:true, totals:outTotals, sizeWise, customers, recent, daily });
  } catch(e) {
    console.error('Usage summary failed', e);
    res.status(500).json({ success:false, message:'Unable to load usage analytics' });
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
