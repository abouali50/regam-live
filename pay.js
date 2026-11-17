// REGAM Live - online payment of the teachers' subscription, with PayPal.
// The teacher is sent to PayPal, pays there, and comes back: the payment is then collected and the
// subscription extended (the account and its room open by themselves on a first payment).
// The PayPal keys (Client ID and Secret of a "Live" app) are set in the administration page.
'use strict';

const crypto = require('crypto');

module.exports = function payments({ db, save, env, grant, grantEntry }) {
  db.pay = db.pay || {};                          // { clientId, secret, sandbox, orders: { id: {...} }, log: [...] }
  db.pay.orders = db.pay.orders || {}; db.pay.log = db.pay.log || [];
  const api = () => (env.PAY_URL || (db.pay.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com')).replace(/\/$/, '');
  const paypal = () => !!(db.pay.clientId && db.pay.secret);
  const ready = () => paypal() || walletOn();      // some way to pay online is set up
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
    if (!paypal()) return { error: 'payment not set up' };
    if (!MONTHS.includes(months)) return { error: 'bad months' };
    const plan = db.plans.find((p) => p.id === user.planId);
    if (!plan || !(plan.price > 0)) return { error: 'no plan' };
    if (!origin) return { error: 'bad address' };
    if (plan.yearly) months = 12;                  // a plan priced by the year is paid for the year, at its price
    const amount = money(plan.yearly ? plan.price : plan.price * months);
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
  // A student pays the entry of a paid room: same road, another thing bought.
  async function startEntry(member, room, fee, origin) {
    if (!paypal()) return { error: 'payment not set up' };
    if (!origin) return { error: 'bad address' };
    const amount = money(fee.amount);
    const order = await call('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: amount }, custom_id: `entry:${room.cfg.slug}:${member.id}`.slice(0, 120), description: `REGAM Live - ${room.cfg.title}`.slice(0, 120) }],
      payment_source: { paypal: { experience_context: { return_url: origin + '/pay/return', cancel_url: `${origin}/r/${room.cfg.slug}?paid=cancel`, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'REGAM Live' } } },
    });
    const go = (order.links || []).find((l) => l.rel === 'payer-action') || (order.links || []).find((l) => l.rel === 'approve');
    if (!order.id || !go || !/^https:\/\//.test(go.href) && !env.PAY_URL) return { error: 'paypal refused' };
    db.pay.orders[order.id] = { kind: 'entry', mid: member.id, slug: room.cfg.slug, days: fee.days, amount, at: Date.now(), done: false };
    save();
    return { url: go.href };
  }
  // The teacher is back from PayPal: collect the money, and only then extend the subscription. Once per payment.
  const busy = new Set();
  async function finish(orderId) {
    const o = db.pay.orders[orderId];
    if (!o) return { ok: false };
    if (o.done) return { ok: true, uid: o.uid, slug: o.slug };
    if (busy.has(orderId)) return { ok: false };
    busy.add(orderId);
    try {
      const d = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
      const cap = (((d.purchase_units || [])[0] || {}).payments || {}).captures || [];
      const got = cap.find((c) => c.status === 'COMPLETED' && c.amount && c.amount.currency_code === 'USD' && Number(c.amount.value) >= Number(o.amount));
      if (d.status !== 'COMPLETED' || !got) return { ok: false, slug: o.slug, pending: cap.some((c) => c.status === 'PENDING') };
      if (o.kind === 'entry') {                    // a student's entry to a paid room
        const who = grantEntry(o.mid, o.slug, o.days);
        if (!who) return { ok: false, slug: o.slug };
        o.done = true; o.captureId = got.id || '';
        db.pay.log.push({ at: Date.now(), kind: 'entry', name: who.name, login: who.email, room: who.room, teacher: who.teacher, days: o.days, amount: o.amount, orderId, captureId: o.captureId });
        db.pay.log = db.pay.log.slice(-300);
        save();
        return { ok: true, slug: o.slug };
      }
      const user = db.users.find((u) => u.id === o.uid);
      if (!user) return { ok: false };
      o.done = true; o.captureId = got.id || '';
      grant(user, o.months);
      db.pay.log.push({ at: Date.now(), uid: user.id, name: user.name, login: user.login, months: o.months, amount: o.amount, orderId, captureId: o.captureId });
      db.pay.log = db.pay.log.slice(-300);
      save();
      return { ok: true, uid: user.id };
    } catch (e) { console.error('payment capture failed', orderId, e.message); return { ok: false, slug: o.slug }; }
    finally { busy.delete(orderId); }
  }

  // ---------------------------------------------------------------------------------------------
  // Payment with a crypto wallet (MetaMask, Trust Wallet, Binance Wallet, OKX, Coinbase Wallet...).
  // The payer sends a dollar stablecoin (USDT or USDC) on BNB Smart Chain, from their wallet, straight to the
  // site's own address: no middleman, nothing kept here but that public address. The site then reads the
  // transaction on the chain and opens the subscription only if it finds, in a confirmed block, a transfer
  // of that coin, from the wallet that asked, to the site's address, of at least the price, made after the request.
  const CHAIN = { id: 56, name: 'BNB Smart Chain', confirms: Number(env.CHAIN_CONFIRMS) || 3,
    rpc: (env.CHAIN_RPC || 'https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io,https://bsc-rpc.publicnode.com').split(',').map((x) => x.trim()).filter(Boolean),
    tokens: { USDT: '0x55d398326f99059ff775485246999027b3197955', USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' } };      // both have 18 decimals on this chain
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ADDR = /^0x[0-9a-fA-F]{40}$/, TX = /^0x[0-9a-f]{64}$/;
  db.pay.txs = db.pay.txs || {};                  // transaction -> the payment it settled: a transfer pays once
  function walletOn() { return !!(db.pay.wallet && ADDR.test(db.pay.wallet)); }
  const walletView = () => (walletOn() ? { chain: CHAIN.name, tokens: Object.keys(CHAIN.tokens) } : false);
  async function rpc(method, params) {
    let last;
    for (const url of CHAIN.rpc) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (r.ok && !d.error) return d.result;
        last = new Error('rpc ' + r.status);
      } catch (e) { last = e; }
    }
    throw last || new Error('rpc');
  }
  // what: { uid, months } for a teacher's plan, or { kind: 'entry', mid, slug, days } for a student's entry
  function startWallet(what, amountUsd, from, symbol) {
    if (!walletOn()) return { error: 'payment not set up' };
    const token = CHAIN.tokens[String(symbol || 'USDT').toUpperCase()];
    if (!token || !ADDR.test(String(from || ''))) return { error: 'bad wallet' };
    const amount = money(amountUsd), wei = (BigInt(Math.round(Number(amount) * 100)) * 10n ** 16n).toString();
    const id = 'w' + crypto.randomBytes(12).toString('hex');
    const cutoff = Date.now() - 3 * 24 * 3600e3;
    for (const [k, o] of Object.entries(db.pay.orders)) if (!o.done && o.at < cutoff) delete db.pay.orders[k];
    db.pay.orders[id] = { ...what, via: 'wallet', amount, at: Date.now(), done: false, from: String(from).toLowerCase(), to: db.pay.wallet.toLowerCase(), token, wei, symbol: String(symbol || 'USDT').toUpperCase() };
    save();
    return { wallet: { order: id, chainId: CHAIN.id, chain: CHAIN.name, token, to: db.pay.wallet, value: wei, amount, symbol: db.pay.orders[id].symbol } };
  }
  function planPrice(user, months) {
    if (!MONTHS.includes(months)) return { error: 'bad months' };
    const plan = db.plans.find((p) => p.id === user.planId);
    if (!plan || !(plan.price > 0)) return { error: 'no plan' };
    return plan.yearly ? { months: 12, amount: plan.price } : { months, amount: plan.price * months };
  }
  const startWalletPlan = (user, months, from, symbol) => { const p = planPrice(user, months); return p.error ? p : startWallet({ uid: user.id, months: p.months }, p.amount, from, symbol); };
  const startWalletEntry = (member, room, fee, from, symbol) => startWallet({ kind: 'entry', mid: member.id, slug: room.cfg.slug, days: fee.days }, fee.amount, from, symbol);
  // The payer's wallet has sent the transaction: read it on the chain. { ok } once settled, { pending } while it is not yet in a confirmed block.
  async function finishWallet(orderId, tx) {
    const o = db.pay.orders[orderId];
    tx = String(tx || '').toLowerCase();
    if (!o || o.via !== 'wallet' || !TX.test(tx)) return { ok: false };
    if (o.done) return { ok: true, uid: o.uid, slug: o.slug };
    if (db.pay.txs[tx] && db.pay.txs[tx] !== orderId) return { ok: false, error: 'used' };
    if (busy.has(orderId)) return { ok: false, pending: true };
    busy.add(orderId);
    try {
      const rc = await rpc('eth_getTransactionReceipt', [tx]);
      if (!rc || !rc.blockNumber) return { ok: false, pending: true };
      if (rc.status !== '0x1') return { ok: false, error: 'failed' };
      const half = (a) => '0x' + '0'.repeat(24) + a.slice(2);
      const paid = (rc.logs || []).some((l) => String(l.address).toLowerCase() === o.token && l.topics && l.topics[0] === TRANSFER
        && String(l.topics[1]).toLowerCase() === half(o.from) && String(l.topics[2]).toLowerCase() === half(o.to) && BigInt(l.data) >= BigInt(o.wei));
      if (!paid) return { ok: false, error: 'not the payment' };
      const head = await rpc('eth_blockNumber', []);
      if (BigInt(head) - BigInt(rc.blockNumber) < BigInt(CHAIN.confirms)) return { ok: false, pending: true };
      const block = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]);
      if (!block || Number(BigInt(block.timestamp)) * 1000 < o.at - 10 * 60e3) return { ok: false, error: 'not the payment' };      // an older transfer is not this payment
      db.pay.txs[tx] = orderId;
      return settle(o, orderId, tx);
    } catch (e) { console.error('wallet payment check failed', orderId, e.message); return { ok: false, pending: true }; }
    finally { busy.delete(orderId); }
  }
  // The money is in: open what was bought, once, and write it in the journal.
  function settle(o, orderId, ref) {
    if (o.kind === 'entry') {
      const who = grantEntry(o.mid, o.slug, o.days);
      if (!who) return { ok: false, slug: o.slug };
      o.done = true; o.captureId = ref;
      db.pay.log.push({ at: Date.now(), kind: 'entry', via: o.via, name: who.name, login: who.email, room: who.room, teacher: who.teacher, days: o.days, amount: o.amount, orderId, captureId: ref });
      db.pay.log = db.pay.log.slice(-300); save();
      return { ok: true, slug: o.slug };
    }
    const user = db.users.find((u) => u.id === o.uid);
    if (!user) return { ok: false };
    o.done = true; o.captureId = ref;
    grant(user, o.months);
    db.pay.log.push({ at: Date.now(), via: o.via, uid: user.id, name: user.name, login: user.login, months: o.months, amount: o.amount, orderId, captureId: ref });
    db.pay.log = db.pay.log.slice(-300); save();
    return { ok: true, uid: user.id };
  }

  const adminView = () => ({ ready: paypal(), wallet: db.pay.wallet || '', walletChain: CHAIN.name, clientId: db.pay.clientId || '', hasSecret: !!db.pay.secret, sandbox: !!db.pay.sandbox,
    log: db.pay.log.slice(-50).reverse().map((l) => ({ at: l.at, kind: l.kind || 'plan', name: l.name, login: l.login, months: l.months, days: l.days, room: l.room, teacher: l.teacher, amount: l.amount, via: l.via || 'paypal', ref: l.via === 'wallet' ? l.captureId : undefined })) });
  function adminSet(b) {
    if (!b || typeof b !== 'object') return;
    if (typeof b.clientId === 'string') db.pay.clientId = b.clientId.trim().slice(0, 200);
    if (typeof b.secret === 'string' && b.secret.trim()) db.pay.secret = b.secret.trim().slice(0, 200);
    if (typeof b.sandbox === 'boolean') db.pay.sandbox = b.sandbox;
    if (typeof b.wallet === 'string') { const w = b.wallet.trim(); if (!w) delete db.pay.wallet; else if (ADDR.test(w)) db.pay.wallet = w; }      // the site's own address: public, it only receives
    if (!db.pay.clientId) delete db.pay.secret;
    token = '';
    save();
  }
  async function adminTest() {
    if (!paypal()) return 'payment not set up';
    try { token = ''; await bearer(); return ''; } catch (e) { return 'paypal refused the keys' + (e.status ? ` (${e.status})` : ''); }
  }
  return { ready, paypal, walletView, start, startEntry, startWalletPlan, startWalletEntry, finishWallet, finish, adminView, adminSet, adminTest, MONTHS };
};
