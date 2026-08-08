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
  if (q.type && ['LABEL_PRINT','BILL_PRINT'].includes(q.type)) match.eventType = q.type;
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
        if (!eventId || !['LABEL_PRINT','BILL_PRINT'].includes(eventType)) { invalid++; continue; }
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
          paymentMode: clean(raw.paymentMode)
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
          items:{ $sum:{ $cond:[{$eq:['$eventType','BILL_PRINT']},'$itemCount',0] } }, lastActivity:{ $max:'$occurredAt' }
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
    res.json({ success:true, totals:totals[0] || {labelPrintJobs:0,labelsPrinted:0,billsPrinted:0,totalSales:0,totalItems:0,activeCustomers:0}, sizeWise, customers, recent, daily });
  } catch(e) {
    console.error('Usage summary failed', e);
    res.status(500).json({ success:false, message:'Unable to load usage analytics' });
  }
};

exports.page = (req,res) => res.render('usage-analytics');
