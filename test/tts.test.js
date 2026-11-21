// REGAM Live - the translation read aloud by the free voice service of the server.   Run:  node --test test/tts.test.js
// A stand-in for the voice service answers; the real one (Piper) is checked on the server itself.
// Author: Aziz Mernissi
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');

async function run(t, ttsUrl) {
  const dataDir = await mkdtemp(join(tmpdir(), 'regam-live-tts-')), password = randomUUID(), sockets = [];
  const env = { ...process.env, PORT: '0', LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: password, HOST_NAME: 'Studio', MTX_API: 'http://127.0.0.1:1' };
  if (ttsUrl) env.TTS_URL = ttsUrl; else delete env.TTS_URL;
  const child = spawn(process.execPath, [join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const stopped = once(child, 'close');
  t.after(async () => { sockets.forEach((s) => s.terminate()); child.kill(); await stopped; await rm(dataDir, { recursive: true, force: true }); });
  const [line] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  const base = `http://127.0.0.1:${/listening on :(\d+)/.exec(line.toString())[1]}`;
  const { token } = await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).json();
  async function connect(uid, name, tok) {
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws'); sockets.push(socket);
    const events = [];
    socket.on('message', (d) => { const e = JSON.parse(d); events.push(...(e.t === 'batch' ? e.ev : [e])); });
    await once(socket, 'open', { signal: AbortSignal.timeout(3000) });
    socket.send(JSON.stringify({ t: 'hello', uid, name, token: tok }));
    const receive = async (type) => { const end = Date.now() + 3000; do { const i = events.findIndex((e) => e.t === type); if (i >= 0) return events.splice(i, 1)[0]; await delay(15); } while (Date.now() < end); assert.fail('expected ' + type); };
    await receive('init');
    return { send: (e) => socket.send(JSON.stringify(e)), receive };
  }
  return { base, host: await connect('ttshost0000001', 'Studio', token), viewer: await connect('ttsviewer000001', 'Nora') };
}

test('each translated sentence gets a voice, made once and kept under a key; the language spoken has none', async (t) => {
  const calls = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      const j = JSON.parse(b); calls.push(j.lang);
      if (j.lang === 'en') { res.writeHead(500); return res.end('{}'); }              // one voice that fails
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.from('RIFF' + j.lang + j.text));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r)); t.after(() => fake.close());
  const { base, host, viewer } = await run(t, `http://127.0.0.1:${fake.address().port}`);

  host.send({ t: 'cap', src: 'ar', tx: { ar: 'مرحبا بكم', fr: 'Bonjour à tous', en: 'Hello everyone' } });
  const cap = await viewer.receive('cap');
  assert.deepEqual(Object.keys(cap.voice).sort(), ['en', 'fr']);
  assert.match(cap.voice.fr, /^[0-9a-f]{24}$/);
  const ok = await fetch(`${base}/api/tts/${cap.voice.fr}`);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'RIFFfrBonjour à tous');
  await fetch(`${base}/api/tts/${cap.voice.fr}`);
  assert.equal(calls.filter((l) => l === 'fr').length, 1, 'the sentence is made once, however many viewers fetch it');
  assert.equal((await fetch(`${base}/api/tts/${cap.voice.en}`)).status, 503, 'a voice that failed lets the viewer fall back to its own device');
  assert.equal((await fetch(`${base}/api/tts/${'0'.repeat(24)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/tts/../server.js`)).status === 200, false);
});

test('without the voice service, or when it is down, the translation still goes out and the viewers read it with their own device', async (t) => {
  const a = await run(t, '');
  a.host.send({ t: 'cap', src: 'fr', tx: { fr: 'Bonjour', en: 'Hello' } });
  const capA = await a.viewer.receive('cap');
  assert.deepEqual(capA.voice, {}); assert.equal(capA.tx.en, 'Hello');
  const b = await run(t, 'http://127.0.0.1:9');
  b.host.send({ t: 'cap', src: 'fr', tx: { fr: 'Bonjour', en: 'Hello' } });
  const capB = await b.viewer.receive('cap');
  assert.equal((await fetch(`${b.base}/api/tts/${capB.voice.en}`)).status, 503);
});
