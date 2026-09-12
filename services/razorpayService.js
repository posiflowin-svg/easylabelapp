const https = require('https');
const crypto = require('crypto');

function getAccount(accountKey) {
  const requested = String(accountKey || process.env.RAZORPAY_ACTIVE_ACCOUNT || '1').trim();
  const slot = requested === '2' ? '2' : '1';
  const keyId = String(process.env[`RAZORPAY_ACCOUNT_${slot}_KEY_ID`] || '').trim();
  const keySecret = String(process.env[`RAZORPAY_ACCOUNT_${slot}_KEY_SECRET`] || '').trim();
  if (!keyId || !keySecret) throw new Error(`Razorpay account ${slot} is not configured`);
  return { accountKey: slot, keyId, keySecret };
}

function requestRazorpay(method, path, account, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const auth = Buffer.from(`${account.keyId}:${account.keySecret}`).toString('base64');
    const req = https.request({
      hostname: 'api.razorpay.com', port: 443, method, path,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>{
        let parsed={}; try{parsed=raw?JSON.parse(raw):{}}catch(e){parsed={raw}};
        if(res.statusCode>=200 && res.statusCode<300) resolve(parsed);
        else reject(new Error(parsed.error?.description || parsed.error?.reason || `Razorpay HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject); if(payload) req.write(payload); req.end();
  });
}

async function createPaymentOrder({ amount, currency='INR', receipt, accountKey }) {
  const account=getAccount(accountKey);
  const amountPaise=Math.round(Number(amount)*100);
  if(!Number.isFinite(amountPaise) || amountPaise<100) throw new Error('Invalid payment amount');
  const order=await requestRazorpay('POST','/v1/orders',account,{amount:amountPaise,currency,receipt:String(receipt||`EL-${Date.now()}`).slice(0,40),payment_capture:1});
  return { account, order };
}

async function verifyPayment({ paymentId, orderId, amount, accountKey }) {
  const account=getAccount(accountKey);
  const payment=await requestRazorpay('GET',`/v1/payments/${encodeURIComponent(paymentId)}`,account);
  const expectedPaise=Math.round(Number(amount)*100);
  const statusOk=['authorized','captured'].includes(String(payment.status||'').toLowerCase());
  const orderOk=String(payment.order_id||'')===String(orderId||'');
  const amountOk=Number(payment.amount)===expectedPaise;
  return { verified: statusOk && orderOk && amountOk, payment, account };
}

module.exports={getAccount,createPaymentOrder,verifyPayment};
