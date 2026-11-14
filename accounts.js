// REGAM Live - viewer accounts: sign-up with a code sent by e-mail, sign-in, forgotten password.
// The code that was sent proves the person owns the address; nothing is open before it is typed.
'use strict';
const crypto = require('crypto');
const fs = require('fs');

module.exports = function accounts({ db, save, send, readJson, sign, verify, clean, clientIp, siteTitle, env, onRemove = () => {} }) {
  db.members = db.members || [];
  db.mail = db.mail || {};                       // { host, port, user, pass, from } - set in the administration page
  db.access = ['open', 'join', 'watch'].includes(db.access) ? db.access : 'open';

  const LOGIN_MAX = Number(env.LOGIN_MAX) || 12;   // sign-in tries per network address in a quarter of an hour
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

  const spent = new Map();                       // passkey challenges already answered
  setInterval(() => { const old = Date.now() - 6 * 60e3; for (const [k, t] of spent) if (t < old) spent.delete(k); }, 60e3).unref();

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
  async function deliver(to, subject, text, attachments) {
    if (OUTBOX) { fs.appendFileSync(OUTBOX, JSON.stringify({ to, subject, text, files: (attachments || []).map((f) => ({ name: f.filename, content: f.content })) }) + '\n'); return; }
    const from = db.mail.from || db.mail.user;
    await mailer().sendMail({ from: `"${siteTitle.replace(/"/g, '')}" <${from}>`, to, subject, text, attachments });
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
      return m ? send(res, 200, { id: m.id, name: m.name, email: m.email, av: m.av || 0, keys: (m.keys || []).length }) : send(res, 401, { error: 'signed out' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await readJson(req), ip = clientIp(req), email = emailOf(b.email), lang = String(b.lang || 'ar');
    if (what === 'rename') {                     // a person changes the name shown to others
      const m = memberOf((req.headers.authorization || '').replace(/^Bearer\s+/i, '')), name = clean(b.name, 24);
      if (!m) return send(res, 401, { error: 'signed out' });
      if (name.length < 2) return send(res, 400, { error: 'bad name or email' });
      m.name = name; save();
      return send(res, 200, { ok: true, name });
    }
    if (what === 'delete') {                     // a person removes their own account, with their password
      const m = memberOf((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!m) return send(res, 401, { error: 'signed out' });
      if (!allowed('login:' + ip, LOGIN_MAX, 15 * 60e3)) return send(res, 429, { error: 'too many requests' });
      if (!safeEq(hash(String(b.password || ''), m.salt), m.hash)) return send(res, 401, { error: 'bad login' });
      db.members = db.members.filter((x) => x.id !== m.id); onRemove(m.id); save();
      return send(res, 200, { ok: true });
    }
    const hostName = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const origin = /^[a-z0-9.-]+(:\d+)?$/i.test(hostName) ? `${req.headers['x-forwarded-proto'] === 'http' || /^(localhost|127\.)/.test(hostName) ? 'http' : 'https'}://${hostName}` : '';
    if (!allowed('ip:' + ip, 40, 3600e3)) return send(res, 429, { error: 'too many requests' });

    // ---- Face ID / fingerprint (passkeys, WebAuthn): the phone or computer keeps a key that only its owner's
    // face or finger unlocks; the site keeps the public half and checks a signature at each sign-in. No password travels.
    if (what.startsWith('passkey/')) {
      const rpId = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, ''), b64 = (v) => Buffer.from(String(v || ''), 'base64url');
      const me = memberOf((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      const challenge = () => { const c = crypto.randomBytes(32).toString('base64url'); return { challenge: c, state: sign('wa', c, 5 * 60e3) }; };
      // what the browser says it signed: the right kind of request, our challenge, our own address
      const clientOk = (raw, type, state) => { try { const c = JSON.parse(b64(raw).toString('utf8')), want = verify(state, 'wa'); if (!origin || !want || c.type !== type || c.challenge !== want || c.origin !== origin || spent.has(want)) return false; spent.set(want, Date.now()); return true; } catch { return false; } };       // each challenge serves once
      if (what === 'passkey/options') {         // signed in: about to add this device
        if (!me) return send(res, 401, { error: 'signed out' });
        return send(res, 200, { ...challenge(), rpId, rpName: siteTitle, userId: Buffer.from(me.id).toString('base64url'), userName: me.email, displayName: me.name, exclude: (me.keys || []).map((k) => k.id), count: (me.keys || []).length });
      }
      if (what === 'passkey/add') {
        if (!me) return send(res, 401, { error: 'signed out' });
        const id = String(b.id || ''), alg = Number(b.alg), pk = String(b.publicKey || '');
        if (!clientOk(b.clientDataJSON, 'webauthn.create', b.state) || !/^[\w-]{16,400}$/.test(id) || ![-7, -257].includes(alg) || pk.length > 2000) return send(res, 400, { error: 'bad passkey' });
        try { crypto.createPublicKey({ key: b64(pk), format: 'der', type: 'spki' }); } catch { return send(res, 400, { error: 'bad passkey' }); }
        if (db.members.some((m) => (m.keys || []).some((k) => k.id === id))) return send(res, 409, { error: 'bad passkey' });
        me.keys = [...(me.keys || []), { id, pk, alg, n: 0, at: Date.now(), label: clean(b.label, 40) }].slice(-5);
        save();
        return send(res, 200, { ok: true, count: me.keys.length });
      }
      if (what === 'passkey/remove') {          // this account goes back to the password only
        if (!me) return send(res, 401, { error: 'signed out' });
        delete me.keys; save();
        return send(res, 200, { ok: true, count: 0 });
      }
      if (what === 'passkey/start') return send(res, 200, { ...challenge(), rpId });
      if (what === 'passkey/login') {
        if (!allowed('login:' + ip, LOGIN_MAX, 15 * 60e3)) return send(res, 429, { error: 'too many requests' });
        const id = String(b.id || ''), m = db.members.find((x) => x.verified && (x.keys || []).some((k) => k.id === id)), k = m && m.keys.find((x) => x.id === id);
        const auth = b64(b.authenticatorData), bad = () => send(res, 401, { error: 'bad passkey' });
        if (!k || auth.length < 37 || !clientOk(b.clientDataJSON, 'webauthn.get', b.state)) return bad();
        if (!auth.subarray(0, 32).equals(crypto.createHash('sha256').update(rpId).digest()) || (auth[32] & 0x05) !== 0x05) return bad();      // made for this site, by a person who was there and was recognised
        const n = auth.readUInt32BE(33);
        if (k.n && n <= k.n) return bad();                                           // a copy of the key being used
        let good = false;
        try { good = crypto.verify('sha256', Buffer.concat([auth, crypto.createHash('sha256').update(b64(b.clientDataJSON)).digest()]), crypto.createPublicKey({ key: b64(k.pk), format: 'der', type: 'spki' }), b64(b.signature)); } catch { good = false; }
        if (!good) return bad();
        k.n = n; k.used = Date.now(); save();
        return send(res, 200, { token: tokenFor(m), name: m.name });
      }
      return send(res, 404, { error: 'not found' });
    }

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
      if (!allowed('login:' + ip, LOGIN_MAX, 15 * 60e3)) return send(res, 429, { error: 'too many requests' });
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
  function adminRemove(id) { const n = db.members.length; db.members = db.members.filter((m) => m.id !== id); if (db.members.length < n) onRemove(id); save(); return db.members.length < n; }

  const find = (email) => { const m = byEmail(emailOf(email)); return m && m.verified ? m : null; };
  const byId = (id) => db.members.find((m) => m.id === id) || null;
  return { find, byId, handle, memberOf, mailReady, adminView, adminSet, adminTest, adminRemove, mail: deliver, access: () => db.access };
};
