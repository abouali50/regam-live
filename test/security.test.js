// REGAM Live - tests of the protections. Each test attacks the running server the way an intruder
// would, and passes only when the attack is refused.   Run:  npm run test:security
// Author: Aziz Mernissi
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 13977, BASE = `http://127.0.0.1:${PORT}`, ADMIN = 'Tr3s-Long-Mot-De-Passe!';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'regam-sec-')), OUTBOX = path.join(DIR, 'outbox.jsonl');
let app, logs = '';
const J = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const from = (ip, extra = {}) => ({ ...J, 'X-Forwarded-For': ip, ...extra });
const post = (p, body, headers = J) => fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body) });
const mails = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastCode = (to) => { const m = mails().filter((x) => x.to === to).pop(); return m ? (m.text.match(/\b(\d{6})\b/) || [])[1] : ''; };
// a request with the Host a real visitor would send (fetch cannot set it)
const raw = (p, { host = 'live.example.com', method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Host: host, ...headers } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  r.on('error', reject); r.end();
});
let adminToken = '';
const AH = () => ({ ...J, Authorization: 'Bearer ' + adminToken });
async function member(email, ip) {
  await post('/api/member/signup', { name: 'Test', email, password: 'motdepasse-1', lang: 'fr' }, from(ip));
  const r = await post('/api/member/verify', { email, code: lastCode(email) }, from(ip));
  return (await r.json()).token;
}

test.before(async () => {
  app = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', ADMIN_PASSWORD: ADMIN, SECRET: 'x'.repeat(64),
    DATA_DIR: path.join(DIR, 'data'), REC_DIR: path.join(DIR, 'rec'), MAIL_OUTBOX: OUTBOX, MTX_API: 'http://127.0.0.1:9', MTX_RTC: 'http://127.0.0.1:9', MTX_HLS: 'http://127.0.0.1:9', MTX_PASS: 'm', API_PER_MIN: '400', NODE_ENV: 'test' } });
  app.stdout.on('data', (c) => { logs += c; }); app.stderr.on('data', (c) => { logs += c; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { /* not up yet */ } await sleep(200); }
  adminToken = (await (await post('/api/login', { login: '', password: ADMIN }, from('10.0.0.1'))).json()).token;
  assert.ok(adminToken, 'the administrator signs in');
  const set = await post('/api/admin/settings', { access: 'join', mail: { host: 'smtp.test.local', port: 465, user: 'live@test.local', from: 'live@test.local', pass: 'mail-secret-1' } }, AH());
  assert.equal(set.status, 200);
});
test.after(() => { if (app) app.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('1. real authentication: no session, a forged session and an altered session are refused', async () => {
  assert.equal((await fetch(BASE + '/api/me')).status, 401);
  assert.equal((await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer user.admin.99999999999999.deadbeef' } })).status, 401);
  const p = adminToken.split('.'); p[2] = String(Number(p[2]) + 1000);            // same signature, later expiry
  assert.equal((await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + p.join('.') } })).status, 401);
  assert.equal((await fetch(BASE + '/api/me', { headers: AH() })).status, 200);
});

test('2. keys are hidden: nothing the public can read carries a secret', async () => {
  for (const p of ['/api/site', '/api/config', '/api/rooms', '/api/plans', '/healthz']) {
    const body = await (await fetch(BASE + p)).text();
    assert.ok(!body.includes('mail-secret-1') && !body.includes(ADMIN) && !/"(pass|secret|key|hash|salt)"\s*:\s*"[^"]/.test(body), p);
  }
  const adm = await (await fetch(BASE + '/api/admin', { headers: AH() })).json();
  assert.ok(!JSON.stringify(adm).includes('mail-secret-1'), 'even the administration page never gets the mailbox password back');
});

test('3 + 9. the database and the administration are locked', async () => {
  const tok = await member('amina@example.com', '10.0.3.1');
  for (const what of ['', '/user', '/room', '/settings', '/backup', '/restore', '/member', '/backupsend', '/mailtest', '/aitest', '/paytest']) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const anon = await fetch(BASE + '/api/admin' + what, { method, headers: J });
      const asMember = await fetch(BASE + '/api/admin' + what, { method, headers: { ...J, Authorization: 'Bearer ' + tok } });
      assert.equal(anon.status, 401, `${method} /api/admin${what} without a session`);
      assert.equal(asMember.status, 401, `${method} /api/admin${what} with a viewer's session`);
    }
  }
  for (const p of ['/data/db.json', '/db.json', '/.env', '/server.js', '/package.json', '/.git/config', '/security.js', '/..%2f.env', '/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cserver.js', '/data/security.log', '/data/backups/'])
    assert.ok([400, 404].includes((await raw(p)).status), 'exposed file: ' + p);
  assert.equal(fs.statSync(path.join(DIR, 'data', 'db.json')).mode & 0o077, 0, 'db.json is readable by its owner only');
});

test('4 + 14 + 15. HTTPS is imposed, security headers are sent, the cookie is protected', async () => {
  for (const p of ['/', '/studio', '/admin', '/api/site', '/common.js', '/nothing-here']) {
    const h = (await raw(p)).headers;
    assert.match(h['strict-transport-security'] || '', /max-age=31536000/, p);
    assert.equal(h['x-content-type-options'], 'nosniff', p);
    assert.equal(h['x-frame-options'], 'SAMEORIGIN', p);
    assert.ok(h['referrer-policy'] && h['permissions-policy'], p);
    const csp = h['content-security-policy'] || '';
    assert.match(csp, /default-src 'self'/, p);
    assert.match(csp, /frame-ancestors 'self'/, p);
    assert.match(csp, /object-src 'none'/, p);
    const scripts = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    assert.ok(!/unsafe-inline|unsafe-eval'|\*|https?:/.test(scripts.replace("'wasm-unsafe-eval'", '')), 'scripts only from the site itself: ' + scripts);
  }
  const pass = await raw('/api/pass?room=main&uid=abcdefabcdef12');
  assert.match(String(pass.headers['set-cookie']), /HttpOnly; SameSite=Lax; Secure/);
});

test('5. passwords are hashed (scrypt, one salt per account), never stored or logged in clear', async () => {
  await member('hash@example.com', '10.0.5.1');
  await post('/api/admin/user', { name: 'Prof', login: 'prof.hash', password: 'prof-password-1' }, AH());
  await sleep(400);
  const dbText = fs.readFileSync(path.join(DIR, 'data', 'db.json'), 'utf8'), db = JSON.parse(dbText);
  assert.ok(!dbText.includes('motdepasse-1') && !dbText.includes('prof-password-1') && !dbText.includes(ADMIN));
  const m = db.members.find((x) => x.email === 'hash@example.com'), u = db.users.find((x) => x.login === 'prof.hash');
  assert.match(m.hash, /^[0-9a-f]{64}$/); assert.match(m.salt, /^[0-9a-f]{32}$/);
  assert.match(u.hash, /^[0-9a-f]{64}$/); assert.notEqual(m.salt, u.salt);
  assert.ok(!logs.includes('motdepasse-1') && !logs.includes(ADMIN));
});

test('6. forms are checked on the server', async () => {
  const bad = [
    ['/api/member/signup', { name: 'A', email: 'not-an-email', password: 'motdepasse-1' }, 400],
    ['/api/member/signup', { name: 'A', email: 'a@example.com', password: 'short' }, 400],
    ['/api/member/signup', { name: '', email: 'a@example.com', password: 'motdepasse-1' }, 400],
    ['/api/apply', { name: 'X', login: 'admin', password: 'longenough1', contact: 'c', roomTitle: 'r', planId: 'p100' }, 400],
    ['/api/apply', { name: 'X', login: 'a b<script>', password: 'longenough1', contact: 'c', roomTitle: 'r', planId: 'p100' }, 400],
    ['/api/apply', { name: 'X', login: 'okname', password: 'longenough1', contact: 'c', roomTitle: 'r', planId: 'no-such-plan' }, 400],
    ['/api/join', { code: "1' OR '1'='1" }, 404],
  ];
  let n = 0;
  for (const [p, body, want] of bad) assert.equal((await post(p, body, from('10.0.6.' + (++n)))).status, want, p + ' ' + JSON.stringify(body));
  // an oversized form is not read: the server answers 400 or hangs up
  const big = await fetch(BASE + '/api/member/signup', { method: 'POST', headers: from('10.0.6.50'), body: JSON.stringify({ name: 'x'.repeat(200000), email: 'big@example.com', password: 'motdepasse-1' }) }).then((r) => r.status, () => 0);
  assert.ok([0, 400].includes(big));
  await sleep(300);
  assert.ok(!fs.readFileSync(path.join(DIR, 'data', 'db.json'), 'utf8').includes('big@example.com'), 'and nothing of it is kept');
  assert.equal((await post('/api/admin/settings', { plans: [{ name: 'X', price: -5, capacity: 10 }] }, AH())).status, 400);
});

test('7. XSS: names and comments stay text, pages carry no inline script', async () => {
  const tok = await member('xss@example.com', '10.0.7.1'), evil = '<img src=x onerror=alert(1)>';
  const r = await post('/api/member/rename', { name: evil }, { ...from('10.0.7.1'), Authorization: 'Bearer ' + tok });
  assert.equal(r.headers.get('content-type'), 'application/json', 'what a person typed only ever travels as data');
  for (const page of ['index.html', 'home.html', 'studio.html', 'admin.html', 'teach.html', 'legal.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), page + ' has a script written in the page');
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), page + ' has an inline event handler');
  }
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'public')).filter((x) => x.endsWith('.js'))) {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.ok(!/\.innerHTML\s*=(?!\s*[A-Z_]+;)|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(js), f + ' writes markup from data');
  }
});

test('8. suspicious activity is recorded, without any password', async () => {
  await post('/api/login', { login: 'prof.hash', password: 'wrong-guess-123' }, from('10.0.8.1'));
  await post('/api/member/login', { email: 'hash@example.com', password: 'wrong-guess-456' }, from('10.0.8.2'));
  const adm = await (await fetch(BASE + '/api/admin', { headers: AH() })).json(), kinds = adm.security.list.map((e) => e.kind);
  assert.ok(kinds.includes('login.fail') && kinds.includes('member.fail') && kinds.includes('login.admin'));
  assert.ok(adm.security.list.some((e) => e.kind === 'login.fail' && e.ip === '10.0.8.1' && e.login === 'prof.hash'));
  await sleep(300);
  const file = fs.readFileSync(path.join(DIR, 'data', 'security.log'), 'utf8');
  assert.ok(file.includes('member.fail') && !file.includes('wrong-guess') && !file.includes(ADMIN));
  assert.equal(fs.statSync(path.join(DIR, 'data', 'security.log')).mode & 0o077, 0);
});

test('10. no query is built from what a visitor types (no SQL here: injection strings are plain text)', async () => {
  for (const login of ["' OR 1=1 --", '{"$ne":null}', 'admin\u0000', '__proto__', 'constructor'])
    assert.equal((await post('/api/login', { login, password: "' OR '1'='1" }, from('10.0.10.' + login.length))).status, 401);
  const r = await fetch(BASE + '/api/member/login', { method: 'POST', headers: from('10.0.10.99'), body: '{"email":{"$gt":""},"password":{"$gt":""},"__proto__":{"verified":true}}' });
  assert.equal(r.status, 401);
  assert.equal(({}).verified, undefined);
});

test('11. settings are checked when the server starts', async () => {
  const run = (env) => new Promise((resolve) => { let out = ''; const c = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: '13978', LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(DIR, 'd2'), REC_DIR: path.join(DIR, 'r2'), ...env } });
    c.stderr.on('data', (d) => { out += d; }); c.stdout.on('data', (d) => { out += d; if (/listening/.test(out)) c.kill(); }); c.on('exit', (code) => resolve({ code, out })); });
  const none = await run({ ADMIN_PASSWORD: '' });
  assert.equal(none.code, 1); assert.match(none.out, /ADMIN_PASSWORD is missing/);
  const weak = await run({ ADMIN_PASSWORD: 'admin1234', SECRET: '', NODE_ENV: 'production', MTX_PASS: '' });
  assert.match(weak.out, /SECRET is not set/); assert.match(weak.out, /MTX_PASS is not set/); assert.match(weak.out, /ADMIN_PASSWORD is shorter than 12/); assert.match(weak.out, /common word/);
});

test('12. limits: guessing a password is stopped, per address and per account', async () => {
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await post('/api/login', { login: 'x', password: 'guess-number-' + i }, from('10.0.12.1'))).status;
  assert.equal(last, 429, 'studio: eight wrong passwords from one address, then a pause');
  assert.equal((await post('/api/login', { login: '', password: ADMIN }, from('10.0.12.1'))).status, 429, 'even the right password waits');
  assert.equal((await post('/api/login', { login: '', password: ADMIN }, from('10.0.12.2'))).status, 200, 'other addresses are not affected');
  for (let i = 0; i < 10; i++) await post('/api/login', { login: 'prof.hash', password: 'nope-nope-' + i }, from('10.1.12.' + i));      // ten addresses, one account
  assert.equal((await post('/api/login', { login: 'prof.hash', password: 'prof-password-1' }, from('10.1.12.200'))).status, 429, 'studio account: ten wrong passwords from anywhere, then a pause');
  for (let i = 0; i < 10; i++) await post('/api/member/login', { email: 'amina@example.com', password: 'nope-nope-' + i }, from('10.2.12.' + i));
  assert.equal((await post('/api/member/login', { email: 'amina@example.com', password: 'motdepasse-1' }, from('10.2.12.200'))).status, 429, 'viewer account: same rule');
  // a whole class behind one address signs in without being stopped (only failures count)
  for (let i = 0; i < 30; i++) assert.equal((await post('/api/member/login', { email: 'hash@example.com', password: 'motdepasse-1' }, from('10.3.12.1'))).status, 200);
  let seen429 = false;
  for (let i = 0; i < 45 && !seen429; i++) seen429 = (await Promise.all(Array.from({ length: 10 }, () => fetch(BASE + '/api/site', { headers: { 'X-Forwarded-For': '10.4.12.1' } })))).some((r) => r.status === 429);
  assert.ok(seen429, 'one address cannot send requests without end');
  assert.equal((await fetch(BASE + '/api/site', { headers: { 'X-Forwarded-For': '10.4.12.2' } })).status, 200);
});

test('13. other sites cannot read the programs of this one (CORS)', async () => {
  for (const p of ['/api/site', '/api/rooms', '/api/me']) {
    const r = await fetch(BASE + p, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null, p);
  }
  const pre = await fetch(BASE + '/api/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

test('16. CSRF: another site cannot act with a visitor\'s session', async () => {
  // sessions travel in a header the page adds itself, never in a cookie the browser sends on its own
  const login = await post('/api/login', { login: '', password: ADMIN }, from('10.0.16.1'));
  assert.equal(login.headers.get('set-cookie'), null, 'signing in sets no cookie');
  const forged = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example', Cookie: 'token=' + adminToken }, body: JSON.stringify({ access: 'open' }) });
  assert.equal(forged.status, 401, 'a form sent from another site, even with the session in a cookie, is refused');
});

test('17. the password reset: the code runs out, serves once, and the link cannot be sent to another site', async () => {
  const email = 'reset@example.com', old = await member(email, '10.0.17.1');
  await post('/api/member/forgot', { email, lang: 'fr' }, from('10.0.17.2', { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' }));
  const mail = mails().filter((m) => m.to === email).pop();
  assert.ok(!mail.text.includes('evil.example'), 'the link in the e-mail is the site\'s own address');
  const code = lastCode(email);
  assert.equal((await post('/api/member/reset', { email, code: code === '000000' ? '000001' : '000000', password: 'nouveau-passe-1' }, from('10.0.17.3'))).status, 400, 'a wrong code is refused');
  const ok = await post('/api/member/reset', { email, code, password: 'nouveau-passe-1' }, from('10.0.17.3'));
  assert.equal(ok.status, 200);
  assert.equal((await post('/api/member/reset', { email, code, password: 'encore-un-autre-1' }, from('10.0.17.4'))).status, 400, 'the same code does not serve twice');
  assert.equal((await fetch(BASE + '/api/member/me', { headers: { Authorization: 'Bearer ' + old } })).status, 401, 'sessions opened with the old password are over');
  assert.equal((await fetch(BASE + '/api/member/me', { headers: { Authorization: 'Bearer ' + (await ok.json()).token } })).status, 200);
  // six wrong tries burn the code
  await post('/api/member/forgot', { email, lang: 'fr' }, from('10.0.17.5'));
  const code2 = lastCode(email);
  for (let i = 0; i < 6; i++) await post('/api/member/reset', { email, code: '99999' + (code2.endsWith('9') ? '8' : '9'), password: 'nouveau-passe-2' }, from('10.0.17.6'));
  assert.equal((await post('/api/member/reset', { email, code: code2, password: 'nouveau-passe-2' }, from('10.0.17.7'))).status, 400, 'after six wrong tries the right code is dead too');
  // an expired code
  await sleep(500);
  const db = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'db.json'), 'utf8'));
  assert.ok(db.members.find((m) => m.email === email).codeExp - Date.now() <= 15 * 60e3, 'a code lives fifteen minutes at most');
});

test('18. uploads: the kind and the size of files are limited', async () => {
  const tok = await member('upload@example.com', '10.0.18.1'), MH = { Authorization: 'Bearer ' + tok };
  const up = (p, type, body, headers = MH) => fetch(BASE + p, { method: 'POST', headers: { ...headers, 'Content-Type': type }, body });
  assert.equal((await up('/api/avatar', 'image/jpeg', Buffer.from('<html><script>alert(1)</script>'))).status, 415, 'a page disguised as a photo');
  assert.equal((await up('/api/avatar', 'image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500 * 1024)]))).status, 413, 'a photo that is too heavy');
  assert.equal((await up('/api/avatar', 'image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000)]))).status, 200);
  assert.equal((await up('/api/pics?room=main', 'image/svg+xml', '<svg onload="alert(1)"/>', { Authorization: 'Bearer ' + adminToken })).status, 415, 'SVG (it can carry scripts)');
  assert.equal((await up('/api/pics?room=main', 'image/png', Buffer.alloc(100), MH)).status, 401, 'a viewer cannot send pictures to a room');
  assert.equal((await up('/api/files?room=main&name=virus.exe', 'application/octet-stream', Buffer.alloc(100), { Authorization: 'Bearer ' + adminToken })).status, 415);
  assert.equal((await up('/api/files?room=main&name=page.html', 'application/octet-stream', Buffer.alloc(100), { Authorization: 'Bearer ' + adminToken })).status, 415);
  assert.equal((await up('/api/files?room=main&name=..%2F..%2Fserver.js.pdf', 'application/octet-stream', Buffer.alloc(100), { Authorization: 'Bearer ' + adminToken })).status, 200);
  assert.ok(fs.readdirSync(path.join(DIR, 'data')).every((f) => !f.includes('server.js')), 'the name sent never becomes a path on the server');
  assert.equal((await up('/api/sound?room=main', 'text/html', '<script>', { Authorization: 'Bearer ' + adminToken })).status, 415);
});

test('19. prices: the amount is never taken from the browser', async () => {
  // (the whole payment, with a stand-in for PayPal, is played in test/e2e.js; here: what a browser may claim)
  const r = await post('/api/pay/start', { login: 'prof.hash', password: 'whatever-1', months: 1, amount: 0.01, price: 0 }, from('10.0.19.1'));
  assert.ok([401, 429].includes(r.status));
  const src = fs.readFileSync(path.join(__dirname, '..', 'pay.js'), 'utf8');
  assert.match(src, /Number\(c\.amount\.value\) >= Number\(o\.amount\)/, 'the sum PayPal collected is compared with the price the server asked');
  assert.match(src, /c\.status === 'COMPLETED'/);
});

test('20. no debug mode: an error tells nothing about the inside of the server', async () => {
  for (const [p, opt] of [['/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }], ['/%E0%A4%A', {}], ['/api/recordings?room=nope', {}], ['/api/config?room=%00', {}], ['/api/admin/restore', { method: 'POST' }]]) {
    const r = await raw(p, opt);
    assert.ok(!/\bat .+\(.+:\d+:\d+\)|node_modules|\/home\/|server\.js|Error:/.test(r.body), p + ' -> ' + r.body.slice(0, 120));
    assert.equal(r.headers['x-powered-by'], undefined);
  }
});

test('websocket: one connection cannot flood the server', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', r));
  for (let i = 0; i < 400 && ws.readyState === 1; i++) ws.send('{"t":"react","k":1}');
  await Promise.race([closed, sleep(4000)]);
  assert.notEqual(ws.readyState, 1, 'the connection is cut');
  const big = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r) => big.on('open', r));
  const bigClosed = new Promise((r) => big.on('close', r)); big.on('error', () => {});
  big.send(JSON.stringify({ t: 'msg', text: 'x'.repeat(10000) }));
  await Promise.race([bigClosed, sleep(4000)]);
  assert.notEqual(big.readyState, 1, 'a message that is too long cuts the connection');
});
