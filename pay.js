// REGAM Live - online payment of the teachers' subscription, with PayPal.
// The teacher is sent to PayPal, pays there, and comes back: the payment is then collected and the
// subscription extended (the account and its room open by themselves on a first payment).
// The PayPal keys (Client ID and Secret of a "Live" app) are set in the administration page.
'use strict';

module.exports = function payments({ db, save, env, grant }) {
  db.pay = db.pay || {};                          // { clientId, secret, sandbox, orders: { id: {...} }, log: [...] }
  db.pay.orders = db.pay.orders || {}; db.pay.log = db.pay.log || [];
  const api = () => (env.PAY_URL || (db.pay.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com')).replace(/\/$/, '');
  const ready = () => !!(db.pay.clientId && db.pay.secret);
  const MONTHS = [1, 3, 6, 12];

  let token = '', tokenExp = 0, tokenKey = '';
  async function bearer() {
    const key = [db.pay.clientId, db.pay.secret, api()].join('|');
    if (token && key === tokenKey && Date.now() < tokenExp) return token;
    const r = await fetch(api() + '/v1/oauth2/token', {
      method: 'POST', body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Basic ' + Buffer.from(db.pay.clientId + ':' + db.pay.secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!r.ok) { const e = new Error('paypal ' + r.status); e.status = r.status; throw e; }
    const d = await r.json();
    token = d.access_token; tokenKey = key; tokenExp = Date.now() + Math.max(60, (d.expires_in || 300) - 120) * 1000;
    return token;
  }
  async function call(path, body) {
    const r = await fetch(api() + path, {
      method: 'POST', body: JSON.stringify(body || {}), signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Bearer ' + (await bearer()), 'Content-Type': 'application/json' },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error('paypal ' + r.status + ' ' + String(d.name || '')); e.status = r.status; e.detail = d; throw e; }
    return d;
  }
  const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

  // Starts a payment: the price is the teacher's own plan, times the months. Returns where to send them.
  async function start(user, months, origin) {
    if (!ready()) return { error: 'payment not set up' };
    if (!MONTHS.includes(months)) return { error: 'bad months' };
    const plan = db.plans.find((p) => p.id === user.planId);
    if (!plan || !(plan.price > 0)) return { error: 'no plan' };
    if (!origin) return { error: 'bad address' };
    const amount = money(plan.price * months);
    const order = await call('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: amount }, custom_id: `${user.id}:${months}`, description: `REGAM Live - ${plan.name} x ${months}`.slice(0, 120) }],
      payment_source: { paypal: { experience_context: { return_url: origin + '/pay/return', cancel_url: origin + '/pay/cancel', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'REGAM Live' } } },
    });
    const go = (order.links || []).find((l) => l.rel === 'payer-action') || (order.links || []).find((l) => l.rel === 'approve');
    if (!order.id || !go || !/^https:\/\//.test(go.href) && !env.PAY_URL) return { error: 'paypal refused' };
    const cutoff = Date.now() - 3 * 24 * 3600e3;                      // payments never finished are forgotten after three days
    for (const [id, o] of Object.entries(db.pay.orders)) if (!o.done && o.at < cutoff) delete db.pay.orders[id];
    db.pay.orders[order.id] = { uid: user.id, months, amount, at: Date.now(), done: false };
    save();
    return { url: go.href };
  }
  // The teacher is back from PayPal: collect the money, and only then extend the subscription. Once per payment.
  const busy = new Set();
  async function finish(orderId) {
    const o = db.pay.orders[orderId];
    if (!o) return { ok: false };
    if (o.done) return { ok: true, uid: o.uid };
    if (busy.has(orderId)) return { ok: false };
    busy.add(orderId);
    try {
      const d = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
      const cap = (((d.purchase_units || [])[0] || {}).payments || {}).captures || [];
      const got = cap.find((c) => c.status === 'COMPLETED' && c.amount && c.amount.currency_code === 'USD' && Number(c.amount.value) >= Number(o.amount));
      if (d.status !== 'COMPLETED' || !got) return { ok: false, pending: cap.some((c) => c.status === 'PENDING') };
      const user = db.users.find((u) => u.id === o.uid);
      if (!user) return { ok: false };
      o.done = true; o.captureId = got.id || '';
      grant(user, o.months);
      db.pay.log.push({ at: Date.now(), uid: user.id, name: user.name, login: user.login, months: o.months, amount: o.amount, orderId, captureId: o.captureId });
      db.pay.log = db.pay.log.slice(-300);
      save();
      return { ok: true, uid: user.id };
    } catch (e) { console.error('payment capture failed', orderId, e.message); return { ok: false }; }
    finally { busy.delete(orderId); }
  }

  const adminView = () => ({ ready: ready(), clientId: db.pay.clientId || '', hasSecret: !!db.pay.secret, sandbox: !!db.pay.sandbox,
    log: db.pay.log.slice(-50).reverse().map((l) => ({ at: l.at, name: l.name, login: l.login, months: l.months, amount: l.amount })) });
  function adminSet(b) {
    if (!b || typeof b !== 'object') return;
    if (typeof b.clientId === 'string') db.pay.clientId = b.clientId.trim().slice(0, 200);
    if (typeof b.secret === 'string' && b.secret.trim()) db.pay.secret = b.secret.trim().slice(0, 200);
    if (typeof b.sandbox === 'boolean') db.pay.sandbox = b.sandbox;
    if (!db.pay.clientId) delete db.pay.secret;
    token = '';
    save();
  }
  async function adminTest() {
    if (!ready()) return 'payment not set up';
    try { token = ''; await bearer(); return ''; } catch (e) { return 'paypal refused the keys' + (e.status ? ` (${e.status})` : ''); }
  }
  return { ready, start, finish, adminView, adminSet, adminTest, MONTHS };
};
