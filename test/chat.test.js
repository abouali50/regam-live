'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');

test('viewer chat, studio replies and moderation over WebSocket', { timeout: 15000 }, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'regam-live-chat-'));
  const password = randomUUID();
  const clients = [];
  const child = spawn(process.execPath, [join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: '0', LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir,
      ADMIN_PASSWORD: password, HOST_NAME: 'Studio', MTX_API: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stopped = once(child, 'close');
  t.after(async () => {
    for (const client of clients) client.terminate();
    child.kill();
    await stopped;
    await rm(dataDir, { recursive: true, force: true });
  });

  const [line] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  const port = /listening on :(\d+)/.exec(line.toString())?.[1];
  assert.ok(port, 'the server reports its assigned port');
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/healthz`);
  assert.deepEqual(await health.json(), { ok: true, live: false, viewers: 0 });

  async function connect(uid, name, token) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.push(socket);
    const events = [];
    socket.on('message', (data) => {
      const event = JSON.parse(data);
      events.push(...(event.t === 'batch' ? event.ev : [event]));
    });
    await once(socket, 'open', { signal: AbortSignal.timeout(3000) });
    const send = (event) => socket.send(JSON.stringify(event));
    async function receive(type) {
      const deadline = Date.now() + 3000;
      do {
        const index = events.findIndex((event) => event.t === type);
        if (index >= 0) return events.splice(index, 1)[0];
        await delay(15);
      } while (Date.now() < deadline);
      assert.fail(`Expected ${type} for ${name}`);
    }
    send({ t: 'hello', uid, name, token });
    return { send, receive, initial: await receive('init') };
  }

  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const host = await connect('regamtesthost1', 'Studio', token);
  const viewer = await connect('regamtestviewer1', 'كريم');
  const audience = await connect('regamtestviewer2', 'Nora');
  assert.equal(host.initial.mod, true);
  assert.equal(viewer.initial.mod, false);

  viewer.send({ t: 'msg', text: 'سلام من المتفرج' });
  const [studioComment, audienceComment] = await Promise.all([
    host.receive('msg'), audience.receive('msg'),
  ]);
  assert.equal(studioComment.m.text, 'سلام من المتفرج');
  assert.equal(studioComment.m.name, 'كريم');
  assert.equal(audienceComment.m.id, studioComment.m.id);

  viewer.send({ t: 'msg', text: 'Second comment too soon' });
  assert.equal((await viewer.receive('err')).code, 'slow');
  host.send({ t: 'msg', text: 'مرحبا من الستوديو' });
  const hostReply = await audience.receive('msg');
  assert.equal(hostReply.m.text, 'مرحبا من الستوديو');
  assert.equal(hostReply.m.mod, true);
  const newcomer = await connect('regamtestviewer3', 'Sam');
  assert.deepEqual(newcomer.initial.history.map((message) => message.text), [
    'سلام من المتفرج', 'مرحبا من الستوديو',
  ]);

  host.send({ t: 'pin', text: 'Pinned by studio' });
  assert.equal((await audience.receive('pin')).text, 'Pinned by studio');
  host.send({ t: 'del', id: studioComment.m.id });
  assert.equal((await audience.receive('del')).id, studioComment.m.id);
  host.send({ t: 'ban', uid: 'regamtestviewer1', on: true });
  assert.equal((await viewer.receive('banned')).on, true);
  viewer.send({ t: 'msg', text: 'Banned viewer comment' });
  assert.equal((await viewer.receive('err')).code, 'banned');
});
