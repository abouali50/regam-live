// REGAM Live - tests of the opening (flag and anthem) played to the audience when a live starts.   Run:  node --test test/opening.test.js
// Author: Aziz Mernissi
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 13978, BASE = `http://127.0.0.1:${PORT}`, ADMIN = 'Tr3s-Long-Mot-De-Passe!';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'regam-open-'));
const J = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, token = '';

test.before(async () => {
  app = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', ADMIN_PASSWORD: ADMIN, SECRET: 'x'.repeat(64),
    DATA_DIR: path.join(DIR, 'data'), REC_DIR: path.join(DIR, 'rec'), MTX_API: 'http://127.0.0.1:9', MTX_RTC: 'http://127.0.0.1:9', MTX_HLS: 'http://127.0.0.1:9', MTX_PASS: 'm' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { /* not up yet */ } await sleep(200); }
  token = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: J, body: JSON.stringify({ login: '', password: ADMIN }) })).json()).token;
  assert.ok(token, 'the administrator signs in');
});
test.after(() => { app.kill(); });

test('the opening is on by default and offers the anthem; the photo and the video only once they were added', async () => {
  const o = await (await fetch(BASE + '/api/opening')).json();
  assert.equal(o.on, true);
  assert.equal(o.king, fs.existsSync(path.join(__dirname, '..', 'public', 'opening', 'king.jpg')) ? 'king.jpg' : '');
  assert.equal(o.video, fs.existsSync(path.join(__dirname, '..', 'public', 'opening', 'maroc.mp4')) ? 'maroc.mp4' : '');
});
test('the anthem is sent as audio, in pieces when a player asks, and nothing else can be read from that folder', async () => {
  const all = await fetch(BASE + '/opening/hymne.mp3');
  assert.equal(all.status, 200); assert.equal(all.headers.get('content-type'), 'audio/mpeg');
  const part = await fetch(BASE + '/opening/hymne.mp3', { headers: { Range: 'bytes=0-99' } });
  assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(BASE + '/opening/flag.webp')).headers.get('content-type'), 'image/webp');
  assert.equal((await fetch(BASE + '/opening/../server.js')).status !== 200 || (await (await fetch(BASE + '/opening/../server.js')).text()).includes('createServer') === false, true);
  assert.notEqual((await fetch(BASE + '/opening/other.mp3')).status, 200);
});
test('only the administrator can turn the opening off, and it then disappears for the audience', async () => {
  const anon = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: J, body: JSON.stringify({ opening: false }) });
  assert.ok(anon.status === 401 || anon.status === 403);
  assert.equal((await (await fetch(BASE + '/api/opening')).json()).on, true);
  const off = await fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { ...J, Authorization: 'Bearer ' + token }, body: JSON.stringify({ opening: false }) });
  assert.equal(off.status, 200);
  assert.equal((await (await fetch(BASE + '/api/opening')).json()).on, false);
  assert.equal((await (await fetch(BASE + '/api/admin', { headers: { Authorization: 'Bearer ' + token } })).json()).opening, false);
});
