'use strict';
// REGAM Live - app server: pages, chat (WebSocket), moderation, stage requests,
// and authenticated proxies to the media server (MediaMTX): WHIP/WHEP + HLS.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const env = process.env;
const PORT = Number(env.PORT || 3000);
const LISTEN_HOST = env.LISTEN_HOST || undefined;
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const SECRET = env.SECRET || crypto.randomBytes(32).toString('hex');
const MTX_RTC = (env.MTX_RTC || 'http://mediamtx:8889').replace(/\/$/, '');
const MTX_HLS = (env.MTX_HLS || 'http://mediamtx:8888').replace(/\/$/, '');
const MTX_API = (env.MTX_API || 'http://mediamtx:9997').replace(/\/$/, '');
const MTX_AUTH = 'Basic ' + Buffer.from(`${env.MTX_USER || 'regam'}:${env.MTX_PASS || ''}`).toString('base64');
const HLS_SECRET = env.HLS_SECRET || env.MTX_PASS || '';
const HLS_PUBLIC_URL = (env.HLS_PUBLIC_URL || '').replace(/\/$/, '');
const SITE_TITLE = env.SITE_TITLE || 'REGAM Live';
const HOST_NAME = env.HOST_NAME || 'REGAM';
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REC_DIR = path.join(env.REC_DIR || path.join(__dirname, 'recordings'), 'air');   // written by the media server
const AIR = 'air';
const HISTORY = 150, MAX_TEXT = 300, MAX_NAME = 24;

if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD is missing or shorter than 8 characters.');
  process.exit(1);
}

// ------------------------------------------------------------------ state --
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const state = { banned: {}, slow: 3, pinned: '', title: '' };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 300);
}

let live = false;
let seq = 0;
const history = [];              // recent chat messages
const hands = new Map();         // uid -> { name, ts }   (stage requests)
let guest = null;                // { uid, name, nonce, ready }
const rtcSessions = new Map();   // "role:path" -> upstream session URL

// ------------------------------------------------------------------- auth --
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function sign(kind, payload, ttlMs) {
  const body = `${kind}.${payload}.${Date.now() + ttlMs}`;
  return `${body}.${hmac(body)}`;
}
function verify(token, kind) {
  const p = String(token || '').split('.');
  if (p.length !== 4 || p[0] !== kind) return null;
  if (!safeEq(hmac(p.slice(0, 3).join('.')), p[3])) return null;
  if (Number(p[2]) < Date.now()) return null;
  return p[1];
}
const isAdmin = (token) => verify(token, 'admin') !== null;
function isGuest(token) {
  const v = verify(token, 'stage');
  return !!(v && guest && v === `${guest.uid}-${guest.nonce}`);
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

const loginFails = new Map();    // ip -> { n, until }
function loginAllowed(ip) {
  const f = loginFails.get(ip);
  return !f || f.until < Date.now() || f.n < 8;
}
function loginFailed(ip) {
  const f = loginFails.get(ip);
  if (!f || f.until < Date.now()) loginFails.set(ip, { n: 1, until: Date.now() + 15 * 60e3 });
  else f.n++;
}

// ------------------------------------------------------------------- http --
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Content-Length': buf.length, ...headers,
  });
  res.end(buf);
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function serveFile(res, file, cache = 'no-cache') {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

// Which role may open which WebRTC session on the media server.
//   whip = publish, whep = watch in real time
const RTC_RULES = {
  admin: { whip: ['studio', 'backstage'], whep: ['guest'] },
  guest: { whip: ['guest'], whep: ['studio', 'backstage'] },
};

async function closeRtc(key) {
  const url = rtcSessions.get(key);
  if (!url) return;
  rtcSessions.delete(key);
  try { await fetch(url, { method: 'DELETE', headers: { Authorization: MTX_AUTH } }); } catch { /* already gone */ }
}

async function handleRtc(req, res, kind, name) {
  const token = bearer(req);
  const role = isAdmin(token) ? 'admin' : isGuest(token) ? 'guest' : null;
  if (!role) return send(res, 401, { error: 'unauthorized' });
  if (!RTC_RULES[role][kind] || !RTC_RULES[role][kind].includes(name)) return send(res, 403, { error: 'forbidden' });
  const key = `${role}:${kind}:${name}`;

  if (req.method === 'DELETE') { await closeRtc(key); return send(res, 200, { ok: true }); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });

  let offer;
  try { offer = await readBody(req); } catch { return send(res, 413, { error: 'too large' }); }
  await closeRtc(key);
  let up;
  try {
    up = await fetch(`${MTX_RTC}/${name}/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: MTX_AUTH }, body: offer,
    });
  } catch { return send(res, 502, { error: 'media server unreachable' }); }
  const text = await up.text();
  if (up.status !== 201) return send(res, up.status === 404 ? 404 : 502, { error: 'media server', status: up.status, detail: text.slice(0, 200) });
  const loc = up.headers.get('location');
  if (loc) rtcSessions.set(key, new URL(loc, MTX_RTC + '/').toString());
  send(res, 201, text, { 'Content-Type': 'application/sdp' });
}

// The audience stream. Only the "air" path is public; the media server treats us
// as its CDN (shared secret), which gives plain playlists without per-viewer
// redirects and cookies.
function proxyHls(req, res, sub) {
  if (sub.includes('..') || !sub.startsWith(`/${AIR}/`)) return send(res, 404, 'Not found');
  const up = http.get(MTX_HLS + sub, { headers: { 'User-Agent': 'regam-live', Authorization: `Bearer ${HLS_SECRET}` } }, (r) => {
    const h = {
      'Content-Type': r.headers['content-type'] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      // playlists change every segment; segments never change -> CDN friendly
      'Cache-Control': /\.m3u8(\?|$)/.test(sub) ? 'public, max-age=1' : 'public, max-age=120',
    };
    if (r.headers['content-length']) h['Content-Length'] = r.headers['content-length'];
    res.writeHead(r.statusCode === 200 ? 200 : 404, h);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) send(res, 502, 'Media server unreachable'); else res.destroy(); });
  res.on('close', () => up.destroy());
}

// Recordings of past lives (studio only): list, download, delete.
const REC_NAME = /^[0-9][0-9_.-]*\.mp4$/;
function handleRecordings(req, res, url) {
  // a download is a plain link, so the token may also come in the address
  if (!isAdmin(bearer(req) || url.searchParams.get('token'))) return send(res, 401, { error: 'unauthorized' });
  const name = url.searchParams.get('name');
  if (!name) {
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    return fs.readdir(REC_DIR, (err, files) => {
      const list = [];
      for (const f of err ? [] : files) {
        if (!REC_NAME.test(f)) continue;
        try { const st = fs.statSync(path.join(REC_DIR, f)); list.push({ name: f, size: st.size, mtime: st.mtimeMs }); } catch { /* removed meanwhile */ }
      }
      list.sort((x, y) => (x.name < y.name ? 1 : -1));
      // while on air, the newest file is still being written
      send(res, 200, { live, list });
    });
  }
  if (!REC_NAME.test(name)) return send(res, 400, { error: 'bad name' });
  const file = path.join(REC_DIR, name);
  if (req.method === 'DELETE') return fs.unlink(file, (err) => send(res, err ? 404 : 200, { ok: !err }));
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="regam-live_${name}"` });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p.startsWith('/hls/')) {
      if (req.method !== 'GET') return send(res, 405, 'Method');
      return proxyHls(req, res, p.slice(4) + url.search);
    }
    if (p === '/healthz') return send(res, 200, { ok: true, live, viewers: wss.clients.size });
    if (p === '/api/config') {
      return send(res, 200, { title: SITE_TITLE, host: HOST_NAME, hls: `${HLS_PUBLIC_URL || '/hls'}/${AIR}/index.m3u8` });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (!loginAllowed(ip)) return send(res, 429, { error: 'too many attempts' });
      let body = {};
      try { body = JSON.parse(await readBody(req, 4096)); } catch { /* fallthrough */ }
      if (!safeEq(hmac(String(body.password || '')), hmac(ADMIN_PASSWORD))) { loginFailed(ip); return send(res, 401, { error: 'wrong password' }); }
      return send(res, 200, { token: sign('admin', 'host', 12 * 3600e3) });
    }
    if (p === '/api/recordings') return handleRecordings(req, res, url);
    const m = p.match(/^\/api\/rtc\/(whip|whep)\/([a-z]+)$/);
    if (m) return handleRtc(req, res, m[1], m[2]);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method');
    if (p === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (p === '/studio') return serveFile(res, path.join(PUBLIC_DIR, 'studio.html'));
    if (p === '/vendor/hls.min.js') return serveFile(res, path.join(__dirname, 'node_modules/hls.js/dist/hls.min.js'), 'public, max-age=86400');
    const file = path.join(PUBLIC_DIR, path.normalize(p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 400, 'Bad path');
    return serveFile(res, file);
  } catch (e) {
    console.error('http error', e);
    if (!res.headersSent) send(res, 500, { error: 'server' });
  }
});

// -------------------------------------------------------------- websocket --
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
const byUid = new Map();         // uid -> Set<ws>
const lastMsgAt = new Map();     // uid -> ts (slow mode)

const tx = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
// Chat traffic is batched: one frame every 200 ms for everybody.
let outbox = [];
const broadcast = (ev) => outbox.push(ev);
setInterval(() => {
  if (!outbox.length) return;
  const frame = JSON.stringify({ t: 'batch', ev: outbox });
  outbox = [];
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(frame);
}, 200);
const toMods = (obj) => { for (const ws of wss.clients) if (ws.mod) tx(ws, obj); };
const toUid = (uid, obj) => { for (const ws of byUid.get(uid) || []) tx(ws, obj); };
const handsList = () => [...hands].map(([uid, h]) => ({ uid, name: h.name })).slice(0, 50);
const guestPublic = () => (guest ? { name: guest.name, uid: guest.uid, ready: guest.ready } : null);
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function endStage(reason) {
  if (!guest) return;
  const uid = guest.uid;
  guest = null;
  toUid(uid, { t: 'kick', reason });
  for (const k of [...rtcSessions.keys()]) if (k.startsWith('guest:') || k === 'admin:whep:guest' || k === 'admin:whip:backstage') closeRtc(k);
  broadcast({ t: 'guest', guest: null });
}

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.ip = clientIp(req);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (!ws.uid) return;
    const set = byUid.get(ws.uid);
    if (set) { set.delete(ws); if (!set.size) byUid.delete(ws.uid); }
    if (!byUid.has(ws.uid) && hands.delete(ws.uid)) toMods({ t: 'hands', list: handsList() });
  });

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    if (!d || typeof d.t !== 'string') return;

    if (d.t === 'hello') {
      if (ws.uid) return;
      if (!/^[a-z0-9]{12,40}$/.test(String(d.uid || ''))) return ws.close();
      ws.uid = d.uid;
      ws.mod = isAdmin(d.token);
      ws.name = ws.mod ? HOST_NAME : clean(d.name, MAX_NAME);
      if (!byUid.has(ws.uid)) byUid.set(ws.uid, new Set());
      byUid.get(ws.uid).add(ws);
      return tx(ws, {
        t: 'init', live, likes, viewers: wss.clients.size, slow: state.slow, pinned: state.pinned, title: state.title,
        history, guest: guestPublic(), mod: ws.mod, banned: !!state.banned[ws.uid],
        hands: ws.mod ? handsList() : undefined, hand: hands.has(ws.uid),
      });
    }
    if (!ws.uid) return;

    switch (d.t) {
      case 'name': if (!ws.mod) ws.name = clean(d.name, MAX_NAME); return;

      case 'msg': {
        const text = clean(d.text, MAX_TEXT);
        if (!text || !ws.name) return;
        if (state.banned[ws.uid]) return tx(ws, { t: 'err', code: 'banned' });
        const now = Date.now();
        if (!ws.mod && state.slow > 0) {
          const wait = state.slow * 1000 - (now - (lastMsgAt.get(ws.uid) || 0));
          if (wait > 0) return tx(ws, { t: 'err', code: 'slow', wait: Math.ceil(wait / 1000) });
        }
        lastMsgAt.set(ws.uid, now);
        const msg = { id: ++seq, uid: ws.uid, name: ws.name, text, ts: now, mod: ws.mod || undefined };
        history.push(msg);
        if (history.length > HISTORY) history.shift();
        return broadcast({ t: 'msg', m: msg });
      }

      // ---- stage requests (viewer side)
      case 'hand':
        if (!ws.name || state.banned[ws.uid] || (guest && guest.uid === ws.uid)) return;
        if (d.on === false) hands.delete(ws.uid);
        else if (hands.size < 200) hands.set(ws.uid, { name: ws.name, ts: Date.now() });
        tx(ws, { t: 'hand', on: hands.has(ws.uid) });
        return toMods({ t: 'hands', list: handsList() });
      case 'onstage':
        if (guest && guest.uid === ws.uid && !guest.ready) { guest.ready = true; broadcast({ t: 'guest', guest: guestPublic() }); }
        return;
      case 'leave':
        if (guest && guest.uid === ws.uid) endStage('left');
        return;
      case 'like':                       // older pages: a plain heart
      case 'react': {                    // reactions: anyone watching, a few per second at most
        const k = d.t === 'like' ? 2 : d.k;
        const now = Date.now();
        if (!Number.isInteger(k) || k < 0 || k >= REACTIONS || state.banned[ws.uid] || now - (ws.lastLike || 0) < 200) return;
        ws.lastLike = now; likes++; reacts[k]++; likesDirty = true;
        return;
      }
    }

    // ---- moderator actions
    if (!ws.mod) return;
    switch (d.t) {
      case 'del': {
        const i = history.findIndex((m) => m.id === d.id);
        if (i >= 0) history.splice(i, 1);
        return broadcast({ t: 'del', id: d.id });
      }
      case 'ban': {
        const uid = String(d.uid || '');
        if (!byUid.has(uid) && !history.some((m) => m.uid === uid)) return;
        if (d.on === false) delete state.banned[uid]; else state.banned[uid] = Date.now();
        save();
        if (d.on !== false) {
          for (let i = history.length - 1; i >= 0; i--) if (history[i].uid === uid) history.splice(i, 1);
          hands.delete(uid);
          if (guest && guest.uid === uid) endStage('banned');
          broadcast({ t: 'purge', uid });
          toMods({ t: 'hands', list: handsList() });
        }
        return toUid(uid, { t: 'banned', on: d.on !== false });
      }
      case 'slow': state.slow = Math.max(0, Math.min(120, Number(d.sec) || 0)); save(); return broadcast({ t: 'slow', sec: state.slow });
      case 'pin': state.pinned = clean(d.text, 200); save(); return broadcast({ t: 'pin', text: state.pinned });
      case 'title': state.title = clean(d.text, 80); save(); return broadcast({ t: 'title', text: state.title });
      case 'stage': {
        const uid = String(d.uid || '');
        const h = hands.get(uid);
        if (!h || !byUid.has(uid)) return;
        if (guest) endStage('replaced');
        hands.delete(uid);
        guest = { uid, name: h.name, nonce: crypto.randomBytes(6).toString('hex'), ready: false };
        toUid(uid, { t: 'invite', token: sign('stage', `${uid}-${guest.nonce}`, 4 * 3600e3) });
        broadcast({ t: 'guest', guest: guestPublic() });
        return toMods({ t: 'hands', list: handsList() });
      }
      case 'unstage': return endStage('removed');
    }
  });
});

// Dead-connection sweep + viewer counter
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30e3);
const REACTIONS = 7;                 // thumbs up, hug, heart, laugh, oops, blush, thinking
let likes = 0, likesDirty = false, reacts = new Array(REACTIONS).fill(0);
setInterval(() => {
  if (!likesDirty) return;
  likesDirty = false;
  broadcast({ t: 'likes', n: likes, r: reacts });     // r = what was sent since the last tick
  reacts = new Array(REACTIONS).fill(0);
}, 700);
let lastViewers = -1;
setInterval(() => {
  const n = wss.clients.size;
  if (n !== lastViewers) { lastViewers = n; broadcast({ t: 'viewers', n }); }
}, 3000);
setInterval(() => {
  const cutoff = Date.now() - 10 * 60e3;
  for (const [uid, ts] of lastMsgAt) if (ts < cutoff) lastMsgAt.delete(uid);
}, 60e3);

// Ask the media server whether the broadcast is on air.
async function pollLive() {
  let on = false;
  try {
    const r = await fetch(`${MTX_API}/v3/paths/get/${AIR}`, { headers: { Authorization: MTX_AUTH }, signal: AbortSignal.timeout(1500) });
    if (r.ok) { const j = await r.json(); on = !!(j.available ?? j.ready); }
  } catch { /* media server down = offline */ }
  if (on !== live) {
    live = on;
    if (on) { likes = 0; likesDirty = true; }      // a new live starts its hearts from zero
    broadcast({ t: 'live', on });
    if (!on && guest) endStage('ended');
  }
}
setInterval(pollLive, 2000);

server.listen(PORT, LISTEN_HOST, () => {
  console.log(`REGAM Live listening on :${server.address().port}`);
});
