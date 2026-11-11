// REGAM Live - viewer accounts: sign-up with a code sent by e-mail, sign-in, forgotten password.
// The code that was sent proves the person owns the address; nothing is open before it is typed.
'use strict';
const crypto = require('crypto');
const fs = require('fs');

module.exports = function accounts({ db, save, send, readJson, sign, verify, clean, clientIp, siteTitle, env }) {
  db.members = db.members || [];
  db.mail = db.mail || {};                       // { host, port, user, pass, from } - set in the administration page
  db.access = ['open', 'join', 'watch'].includes(db.access) ? db.access : 'open';

  const OUTBOX = env.MAIL_OUTBOX || '';          // tests: write the messages to a file instead of sending them
  const mailReady = () => !!(db.mail.host && db.mail.user && db.mail.pass);
  const hash = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const emailOf = (v) => { const e = String(v || '').trim().toLowerCase(); return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; };
  const byEmail = (email) => db.members.find((m) => m.email === email);
  const tokenFor = (m) => sign('member', m.id, 30 * 24 * 3600e3);
  function memberOf(token) {
    const id = verify(token, 'member');
    return (id && db.members.find((m) => m.id === id && m.verified)) || null;
  }

  // ---- limits: a few tries per address and per network, so codes cannot be guessed or mail flooded
  const hits = new Map();                        // key -> [timestamps]
  function allowed(key, max, windowMs) {
    const now = Date.now(), list = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    return true;
  }
  setInterval(() => { const now = Date.now(); for (const [k, l] of hits) if (!l.some((t) => t > now - 3600e3)) hits.delete(k); }, 600e3).unref();

  // ---- sending
  let transport = null, transportKey = '';
  function mailer() {
    const m = db.mail, key = JSON.stringify([m.host, m.port, m.user, m.pass]);
    if (!transport || key !== transportKey) {
      const port = Number(m.port) || 465;
      transport = require('nodemailer').createTransport({ host: m.host, port, secure: port === 465, auth: { user: m.user, pass: m.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
      transportKey = key;
    }
    return transport;
  }
  async function deliver(to, subject, text) {
    if (OUTBOX) { fs.appendFileSync(OUTBOX, JSON.stringify({ to, subject, text }) + '\n'); return; }
    const from = db.mail.from || db.mail.user;
    await mailer().sendMail({ from: `"${siteTitle.replace(/"/g, '')}" <${from}>`, to, subject, text });
  }
  const TEXT = {
    ar: { s: 'الكود ديال التفعيل: {code}', b: 'السلام عليكم {name}،\n\nالكود ديالك ف {site} هو:\n\n    {code}\n\nالكود صالح 15 دقيقة. إلا ما طلبتيش هاد الكود، تجاهل هاد الرسالة.', l: 'ولا ورك على هاد الرابط باش تفعل الحساب مباشرة:' },
    fr: { s: 'Votre code de validation : {code}', b: 'Bonjour {name},\n\nVotre code pour {site} est :\n\n    {code}\n\nCe code est valable 15 minutes. Si vous n’avez rien demandé, ignorez ce message.', l: 'Ou cliquez sur ce lien pour valider directement :' },
    en: { s: 'Your verification code: {code}', b: 'Hello {name},\n\nYour code for {site} is:\n\n    {code}\n\nThis code is valid for 15 minutes. If you did not ask for it, ignore this message.', l: 'Or open this link to validate directly:' },
  };
  async function sendCode(m, lang, origin) {
    m.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    m.codeExp = Date.now() + 15 * 60e3; m.codeTries = 0;
    save();
    const t = TEXT[lang] || TEXT.ar, fill = (s) => s.replace('{code}', m.code).replace('{name}', m.name).replace('{site}', siteTitle);
    // the same code as a link: one tap validates the account
    const link = origin ? `\n\n${t.l}\n${origin}/rooms?e=${encodeURIComponent(m.email)}&v=${m.code}` : '';
    await deliver(m.email, fill(t.s), fill(t.b) + link);
  }
  function codeOk(m, code) {                     // one code, a handful of tries
    if (!m || !m.code || m.codeExp < Date.now()) return false;
    if ((m.codeTries = (m.codeTries || 0) + 1) > 6) { m.code = ''; save(); return false; }
    if (!safeEq(m.code, String(code || '').trim())) { save(); return false; }
    m.code = ''; m.codeTries = 0;
    return true;
  }

  async function handle(req, res, what) {
    if (what === 'me' && req.method === 'GET') {
      const m = memberOf((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      return m ? send(res, 200, { name: m.name, email: m.email }) : send(res, 401, { error: 'signed out' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await readJson(req), ip = clientIp(req), email = emailOf(b.email), lang = String(b.lang || 'ar');
    const hostName = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const origin = /^[a-z0-9.-]+(:\d+)?$/i.test(hostName) ? `${req.headers['x-forwarded-proto'] === 'http' || /^(localhost|127\.)/.test(hostName) ? 'http' : 'https'}://${hostName}` : '';
    if (!allowed('ip:' + ip, 40, 3600e3)) return send(res, 429, { error: 'too many requests' });

    if (what === 'signup') {
      if (!mailReady()) return send(res, 503, { error: 'mail not set up' });
      const name = clean(b.name, 24), password = String(b.password || '');
      if (!name || !email) return send(res, 400, { error: 'bad name or email' });
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'password too short' });
      let m = byEmail(email);
      if (m && m.verified) return send(res, 409, { error: 'email already used' });
      if (!allowed('mail:' + email, 5, 3600e3)) return send(res, 429, { error: 'too many requests' });
      if (!m) {
        if (db.members.length >= 200000) return send(res, 503, { error: 'full' });
        m = { id: 'm' + crypto.randomBytes(8).toString('hex'), email, verified: false, created: Date.now() };
        db.members.push(m);
      }
      m.name = name; m.salt = crypto.randomBytes(16).toString('hex'); m.hash = hash(password, m.salt);
      try { await sendCode(m, lang, origin); } catch { return send(res, 502, { error: 'mail failed' }); }
      return send(res, 200, { ok: true });
    }
    if (what === 'verify') {                     // the code from the e-mail: the account opens
      const m = byEmail(email);
      if (!codeOk(m, b.code)) return send(res, 400, { error: 'bad code' });
      m.verified = true; save();
      return send(res, 200, { token: tokenFor(m), name: m.name });
    }
    if (what === 'login') {
      const m = byEmail(email);
      if (!allowed('login:' + ip, 12, 15 * 60e3)) return send(res, 429, { error: 'too many requests' });
      if (!m || !safeEq(hash(String(b.password || ''), m.salt), m.hash)) return send(res, 401, { error: 'bad login' });
      if (!m.verified) {                         // signed up but never typed the code: send a new one
        if (mailReady() && allowed('mail:' + email, 5, 3600e3)) { try { await sendCode(m, lang, origin); } catch { /* shown as unverified anyway */ } }
        return send(res, 403, { error: 'unverified' });
      }
      return send(res, 200, { token: tokenFor(m), name: m.name });
    }
    if (what === 'forgot') {                     // always the same answer, whether the address is known or not
      const m = byEmail(email);
      if (m && mailReady() && allowed('mail:' + email, 5, 3600e3)) { try { await sendCode(m, lang, origin); } catch { /* nothing to tell */ } }
      return send(res, 200, { ok: true });
    }
    if (what === 'reset') {
      const m = byEmail(email), password = String(b.password || '');
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'password too short' });
      if (!codeOk(m, b.code)) return send(res, 400, { error: 'bad code' });
      m.salt = crypto.randomBytes(16).toString('hex'); m.hash = hash(password, m.salt); m.verified = true; save();
      return send(res, 200, { token: tokenFor(m), name: m.name });
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---- administration
  const adminView = () => ({
    access: db.access, mailReady: mailReady(),
    mail: { host: db.mail.host || '', port: db.mail.port || 465, user: db.mail.user || '', from: db.mail.from || '', hasPass: !!db.mail.pass },
    members: { total: db.members.length, verified: db.members.filter((m) => m.verified).length,
      list: db.members.slice(-300).reverse().map((m) => ({ id: m.id, name: m.name, email: m.email, verified: m.verified, created: m.created })) },
  });
  function adminSet(b) {
    const asked = ['open', 'join', 'watch'].includes(b.access) ? b.access : '';
    if (asked) db.access = asked;
    if (b.mail && typeof b.mail === 'object') {
      const host = String(b.mail.host || '').trim().toLowerCase(), user = String(b.mail.user || '').trim(), from = String(b.mail.from || '').trim();
      if (host && !/^[a-z0-9.-]{3,100}$/.test(host)) return 'bad mail settings';
      if ((user && user.length > 120) || (from && !emailOf(from))) return 'bad mail settings';
      db.mail.host = host; db.mail.port = Math.min(65535, Math.max(1, Number(b.mail.port) || 465)); db.mail.user = user; db.mail.from = from;
      if (typeof b.mail.pass === 'string' && b.mail.pass) db.mail.pass = b.mail.pass.slice(0, 200);
    }
    if (db.access !== 'open' && !mailReady()) db.access = 'open';      // never lock the site while nobody can sign up
    if (asked && db.access === asked) db.accessChosen = true;          // the administrator's own choice stands from now on
    save();
    return '';
  }
  async function adminTest(to) {
    const email = emailOf(to);
    if (!email || !mailReady()) return 'bad mail settings';
    try {
      await deliver(email, siteTitle + ' - test', 'OK. ' + siteTitle);
      // the mailbox works: from now on people must have an account, unless the administrator already chose otherwise
      if (!db.accessChosen && db.access === 'open') { db.access = 'watch'; save(); }
      return '';
    } catch (e) { return 'mail failed: ' + String((e && e.message) || e).slice(0, 160); }
  }
  function adminRemove(id) { const n = db.members.length; db.members = db.members.filter((m) => m.id !== id); save(); return db.members.length < n; }

  return { handle, memberOf, mailReady, adminView, adminSet, adminTest, adminRemove, access: () => db.access };
};
