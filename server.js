'use strict';
// REGAM Live - app server.
//   rooms      : each room is its own live (chat, reactions, stage, recordings)
//   accounts   : one administrator (ADMIN_PASSWORD) and teachers created by them
//   media      : authenticated proxies to the media server (MediaMTX): WHIP/WHEP + HLS

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
const REC_ROOT = env.REC_DIR || path.join(__dirname, 'recordings');   // written by the media server
const HISTORY = 150, MAX_TEXT = 300, MAX_NAME = 24;
const MAX_GUESTS = 12;               // guests on stage at once, next to the host
const REACTIONS = 7;                 // thumbs up, hug, heart, laugh, oops, blush, thinking
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const zeros = () => new Array(REACTIONS).fill(0);
const COLORS = 9;                    // comment colours offered to everyone (0 = default)
const colorOf = (v) => (Number.isInteger(v) && v > 0 && v < COLORS ? v : 0);

if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD is missing or shorter than 8 characters.');
  process.exit(1);
}

// --------------------------------------------------------------- database --
// A small JSON file: teachers and rooms. Everything else lives in memory.
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const db = { users: [], rooms: [], plans: [{ id: 'p100', name: '100', price: 500, capacity: 100 }], payInfo: '' };
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (err) => { if (!err) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {}); });
  }, 200);
}
if (!db.rooms.length) {
  // first start, or upgrade from the single-room version: keep its settings
  let old = {};
  try { old = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8')); } catch { /* none */ }
  db.rooms.push({ slug: 'main', title: SITE_TITLE, topic: '', ownerId: 'admin', slow: old.slow ?? 3, pinned: old.pinned || '', liveTitle: old.title || '', banned: old.banned || {} });
  save();
}

// One live per room. `cfg` is the saved part, the rest is the running state.
const rooms = new Map();
function openRoom(cfg) {
  const room = {
    cfg, live: false, seq: 0, history: [], hands: new Map(), guests: new Map(), rtc: new Map(),   // guests: slot -> { uid, name, nonce, ready }
    clients: new Set(), byUid: new Map(), lastMsgAt: new Map(), outbox: [],
    likes: 0, reacts: zeros(), totals: zeros(), likesDirty: false, lastViewers: -1,
    waiters: new Set(), admitted: new Set(), refused: new Set(),     // waiting room: sockets at the door, people let in, people turned away
  };
  rooms.set(cfg.slug, room);
  fs.mkdir(path.join(REC_ROOT, `air_${cfg.slug}`), { recursive: true }, () => {});   // ours, so we may delete recordings
  return room;
}
db.rooms.forEach(openRoom);
const defaultRoom = () => rooms.get('main') || rooms.values().next().value;

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
// approved by the administrator, and (when the account has an end date) still paid for
const isActive = (u) => !!u.active && (!u.paidUntil || u.paidUntil > Date.now());
const hashPass = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');
// Who holds this token: the administrator, an active teacher, or nobody.
function whoIs(token) {
  const id = verify(token, 'user');
  if (!id) return null;
  if (id === 'admin') return { id: 'admin', role: 'admin', name: HOST_NAME };
  const u = db.users.find((x) => x.id === id && isActive(x));
  return u ? { id: u.id, role: 'teacher', name: u.name } : null;
}
const canHost = (user, room) => !!user && !!room && (user.role === 'admin' || room.cfg.ownerId === user.id);
const ownerName = (room) => (room.cfg.ownerId === 'admin' ? HOST_NAME : (db.users.find((u) => u.id === room.cfg.ownerId) || {}).name || HOST_NAME);
// The stage slot (1..MAX_GUESTS) this token gives access to, or 0.
function guestSlot(token, room) {
  const v = verify(token, 'stage');
  if (!v) return 0;
  for (const [slot, g] of room.guests) if (v === `${room.cfg.slug}_${g.uid}_${slot}_${g.nonce}`) return slot;
  return 0;
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

const applies = new Map();       // ip -> [timestamps]  (teacher applications)
function applyAllowed(ip) {
  const now = Date.now(), list = (applies.get(ip) || []).filter((t) => t > now - 3600e3);
  if (list.length >= 5) return false;
  list.push(now); applies.set(ip, list);
  return true;
}
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
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
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
async function readJson(req) {
  try { const v = JSON.parse(await readBody(req, 8192)); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function serveFile(res, file, cache = 'no-cache') {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const acct = require('./accounts')({ db, save, send, readJson, sign, verify, clean, clientIp, siteTitle: SITE_TITLE, env });
// the stream is only handed to people holding a pass when the room has a waiting room or the site asks for an account
const passNeeded = (room) => !!room.cfg.gate || !!room.cfg.code || acct.access() === 'watch';
// Entry code of a room (like a meeting passcode): the host sends it with the invitation.
const codeOk = (room, code) => !room.cfg.code || safeEq(room.cfg.code, String(code || '').replace(/\D/g, ''));
const codeTries = new Map();     // ip -> [timestamps of wrong codes]
function codeAllowed(ip, wrong) {
  const now = Date.now(), list = (codeTries.get(ip) || []).filter((t) => t > now - 10 * 60e3);
  if (wrong) list.push(now);
  codeTries.set(ip, list);
  return list.length <= 12;
}
const nextOf = (room) => (room.cfg.next && room.cfg.next.at > Date.now() - 3 * 3600e3 ? room.cfg.next : null);   // the announced session, until a few hours after its time
const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return '';
};
// Sound played to people while the room is not live (one file per room, sent by its host).
const SOUND_TYPES = { 'audio/mpeg': 1, 'audio/mp3': 1, 'audio/mp4': 1, 'audio/x-m4a': 1, 'audio/m4a': 1, 'audio/aac': 1, 'audio/ogg': 1, 'audio/wav': 1, 'audio/x-wav': 1 };
const SOUND_MAX = 60 * 1024 * 1024;
const soundFile = (slug) => path.join(DATA_DIR, `sound_${slug}`);
// Receives an uploaded file into `dest` (through a temporary file). Answers the error itself.
function receiveFile(req, res, dest, max, done) {
  if (Number(req.headers['content-length']) > max) return send(res, 413, { error: 'too large' });
  const tmp = dest + '.tmp', out = fs.createWriteStream(tmp);
  let size = 0, failed = false;
  const fail = (code) => { if (failed) return; failed = true; req.unpipe(out); out.destroy(); fs.unlink(tmp, () => {}); send(res, code, { error: code === 413 ? 'too large' : 'upload failed' }); req.resume(); };
  req.on('data', (c) => { size += c.length; if (size > max) fail(413); });
  req.on('error', () => fail(400)); out.on('error', () => fail(500));
  req.on('aborted', () => fail(400));
  req.pipe(out);
  out.on('finish', () => {
    if (failed) return;
    if (!size) return fail(400);
    fs.rename(tmp, dest, (e) => (e ? fail(500) : done()));
  });
}
const typeOf = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
function handleSound(req, res, url) {
  const room = roomOf(url);
  if (!room) return send(res, 404, { error: 'no such room' });
  if (!canHost(whoIs(bearer(req)), room)) return send(res, 401, { error: 'unauthorized' });
  if (req.method === 'DELETE') {                 // no sound at all
    delete room.cfg.sound; room.cfg.soundOff = true; save();
    fs.unlink(soundFile(room.cfg.slug), () => {});
    return send(res, 200, { ok: true, sound: '' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (url.searchParams.get('default')) {         // back to the recitation that comes with the site
    delete room.cfg.sound; delete room.cfg.soundOff; save();
    fs.unlink(soundFile(room.cfg.slug), () => {});
    return send(res, 200, { ok: true, sound: soundUrl(room) });
  }
  const type = typeOf(req);
  if (!SOUND_TYPES[type]) return send(res, 415, { error: 'not a sound file' });
  receiveFile(req, res, soundFile(room.cfg.slug), SOUND_MAX, () => {
    room.cfg.sound = { type, v: Date.now() }; delete room.cfg.soundOff; save();
    send(res, 200, { ok: true, sound: soundUrl(room) });
  });
}
// A room without its own sound plays the recitation that comes with the site (Surat Ar-Rahman,
// Abdulbasit Abdulsamad), unless its host switched the sound off.
const DEFAULT_SOUND = 'WAIT_SOUND_URL' in env ? env.WAIT_SOUND_URL : 'https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/055.mp3';
const soundUrl = (room) => (room.cfg.sound ? `/media/sound/${room.cfg.slug}?v=${room.cfg.sound.v}` : room.cfg.soundOff ? '' : DEFAULT_SOUND);

// Pictures shown one after the other while the room is not live (sent by its host; without any, the reef picture).
const PIC_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PIC_MAX = 8 * 1024 * 1024, PICS_PER_ROOM = 12;
const picFile = (slug, id) => path.join(DATA_DIR, `pic_${slug}_${id}`);
const picUrls = (room) => (room.cfg.pics || []).map((p) => ({ id: p.id, url: `/media/pic/${room.cfg.slug}/${p.id}` }));
function handlePics(req, res, url) {
  const room = roomOf(url);
  if (!room) return send(res, 404, { error: 'no such room' });
  if (!canHost(whoIs(bearer(req)), room)) return send(res, 401, { error: 'unauthorized' });
  const pics = (room.cfg.pics = room.cfg.pics || []);
  if (req.method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '');
    if (!pics.some((p) => p.id === id)) return send(res, 404, { error: 'no such picture' });
    room.cfg.pics = pics.filter((p) => p.id !== id); save();
    fs.unlink(picFile(room.cfg.slug, id), () => {});
    return send(res, 200, { ok: true, pics: picUrls(room) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const type = typeOf(req);
  if (!PIC_TYPES[type]) return send(res, 415, { error: 'not a picture' });
  if (pics.length >= PICS_PER_ROOM) return send(res, 409, { error: 'too many pictures' });
  const id = crypto.randomBytes(6).toString('hex');
  receiveFile(req, res, picFile(room.cfg.slug, id), PIC_MAX, () => {
    room.cfg.pics.push({ id, type }); save();
    send(res, 200, { ok: true, pics: picUrls(room) });
  });
}
function servePic(res, rest) {
  const [slug, id] = rest.split('/'), room = rooms.get(slug), pic = room && (room.cfg.pics || []).find((p) => p.id === id);
  if (!pic) return send(res, 404, 'Not found');
  fs.readFile(picFile(slug, id), (e, data) => (e ? send(res, 404, 'Not found') : send(res, 200, data, { 'Content-Type': pic.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })));
}
function serveSound(req, res, slug) {
  const room = rooms.get(slug);
  if (!room || !room.cfg.sound) return send(res, 404, 'Not found');
  fs.stat(soundFile(slug), (e, st) => {
    if (e) return send(res, 404, 'Not found');
    const head = { 'Content-Type': room.cfg.sound.type === 'audio/mp3' ? 'audio/mpeg' : room.cfg.sound.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let from = 0, to = st.size - 1, code = 200;
    if (m && (m[1] || m[2])) {                    // phones ask for the file in pieces
      if (m[1]) { from = Number(m[1]); if (m[2]) to = Math.min(to, Number(m[2])); } else from = Math.max(0, st.size - Number(m[2]));
      if (from > to || from >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      code = 206; head['Content-Range'] = `bytes ${from}-${to}/${st.size}`;
    }
    head['Content-Length'] = to - from + 1;
    res.writeHead(code, head);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(soundFile(slug), { start: from, end: to }).on('error', () => res.destroy()).pipe(res);
  });
}
const roomOf = (url) => (url.searchParams.get('room') ? rooms.get(url.searchParams.get('room')) : defaultRoom());

// Which role may open which WebRTC session on the media server.
//   whip = publish, whep = watch in real time
//   host        : publishes the broadcast and one "backstage<n>" sound mix per guest, watches every guest
//   guest in <n>: publishes "guest<n>", watches the broadcast picture and their own backstage mix
function rtcAllowed(slot, kind, name) {
  if (!slot) return kind === 'whip' ? (name === 'studio' || /^backstage(?:[1-9]|1[0-2])$/.test(name)) : /^guest(?:[1-9]|1[0-2])$/.test(name);
  return kind === 'whip' ? name === `guest${slot}` : (name === 'studio' || name === `backstage${slot}`);
}

async function closeRtc(room, key) {
  const url = room.rtc.get(key);
  if (!url) return;
  room.rtc.delete(key);
  try { await fetch(url, { method: 'DELETE', headers: { Authorization: MTX_AUTH } }); } catch { /* already gone */ }
}

async function handleRtc(req, res, url, kind, name) {
  const room = roomOf(url);
  if (!room) return send(res, 404, { error: 'no such room' });
  const token = bearer(req);
  const slot = canHost(whoIs(token), room) ? 0 : guestSlot(token, room);
  if (slot === 0 && !canHost(whoIs(token), room)) return send(res, 401, { error: 'unauthorized' });
  if (!rtcAllowed(slot, kind, name)) return send(res, 403, { error: 'forbidden' });
  const key = `${slot ? 'guest' + slot : 'host'}:${kind}:${name}`;

  if (req.method === 'DELETE') { await closeRtc(room, key); return send(res, 200, { ok: true }); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });

  let offer;
  try { offer = await readBody(req); } catch { return send(res, 413, { error: 'too large' }); }
  await closeRtc(room, key);
  let up;
  try {
    up = await fetch(`${MTX_RTC}/${name}_${room.cfg.slug}/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: MTX_AUTH }, body: offer,
    });
  } catch { return send(res, 502, { error: 'media server unreachable' }); }
  const text = await up.text();
  if (up.status !== 201) return send(res, up.status === 404 ? 404 : 502, { error: 'media server', status: up.status, detail: text.slice(0, 200) });
  const loc = up.headers.get('location');
  if (loc) room.rtc.set(key, new URL(loc, MTX_RTC + '/').toString());
  send(res, 201, text, { 'Content-Type': 'application/sdp' });
}

// The audience streams. Only the "air_<room>" paths are public; the media server
// treats us as its CDN (shared secret), which gives plain playlists without
// per-viewer redirects and cookies.
function proxyHls(req, res, sub) {
  const m = sub.match(/^\/air_([a-z0-9-]+)\//);
  if (sub.includes('..') || !m || !rooms.has(m[1])) return send(res, 404, 'Not found');
  // a room with a waiting room only streams to the people its host let in
  if (passNeeded(rooms.get(m[1])) && verify(cookieOf(req, `rlp_${m[1]}`), 'pass') !== m[1]) return send(res, 403, 'Forbidden');
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

// Recordings of past lives (the room's host only): list, download, delete.
const REC_NAME = /^[0-9][0-9_.-]*\.mp4$/;
function handleRecordings(req, res, url) {
  const room = roomOf(url);
  // a download is a plain link, so the token may also come in the address
  if (!canHost(whoIs(bearer(req) || url.searchParams.get('token')), room)) return send(res, 401, { error: 'unauthorized' });
  const dir = path.join(REC_ROOT, `air_${room.cfg.slug}`);
  const name = url.searchParams.get('name');
  if (!name) {
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    return fs.readdir(dir, (err, files) => {
      const list = [];
      for (const f of err ? [] : files) {
        if (!REC_NAME.test(f)) continue;
        try { const st = fs.statSync(path.join(dir, f)); list.push({ name: f, size: st.size, mtime: st.mtimeMs }); } catch { /* removed meanwhile */ }
      }
      list.sort((x, y) => (x.name < y.name ? 1 : -1));
      // while on air, the newest file is still being written
      send(res, 200, { live: room.live, list });
    });
  }
  if (!REC_NAME.test(name)) return send(res, 400, { error: 'bad name' });
  const file = path.join(dir, name);
  if (req.method === 'DELETE') return fs.unlink(file, (err) => send(res, err ? 404 : 200, { ok: !err }));
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${room.cfg.slug}_${name}"` });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

// ---------------------------------------------------------- administration --
const publicRoom = (r) => ({ capacity: r.cfg.capacity || 0, slug: r.cfg.slug, title: r.cfg.title, topic: r.cfg.topic, host: ownerName(r), live: r.live, viewers: r.clients.size, liveTitle: r.cfg.liveTitle, locked: !!r.cfg.code, next: nextOf(r) });
function slugFor(title) {
  let base = String(title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!SLUG.test(base)) base = 'room';
  let slug = base;
  for (let i = 2; rooms.has(slug) || slug === 'main'; i++) slug = `${base}-${i}`;
  return slug;
}
function closeRoom(room) {
  endStage(room, 'ended');
  for (const k of [...room.rtc.keys()]) closeRtc(room, k);
  for (const ws of room.clients) ws.close();
  rooms.delete(room.cfg.slug);
  db.rooms = db.rooms.filter((c) => c !== room.cfg);
}

async function handleAdmin(req, res, url, what) {
  const me = whoIs(bearer(req));
  if (!me || me.role !== 'admin') return send(res, me ? 403 : 401, { error: 'administrator only' });

  if (!what && req.method === 'GET') {
    return send(res, 200, {
      users: db.users.map((u) => ({ id: u.id, name: u.name, login: u.login, active: u.active, expired: !!u.active && !isActive(u), pending: !!u.pending, contact: u.contact || '', paidUntil: u.paidUntil || 0, planId: u.planId || '', wantRoom: u.wantRoom || '', wantTopic: u.wantTopic || '' })),
      plans: db.plans, payInfo: db.payInfo, accounts: acct.adminView(),
      rooms: [...rooms.values()].map((r) => ({ ...publicRoom(r), ownerId: r.cfg.ownerId })),
    });
  }
  if (what === 'user' && req.method === 'POST') {            // create, or update when "id" is given
    const b = await readJson(req);
    const name = clean(b.name, 40), login = clean(b.login, 30).toLowerCase(), password = String(b.password || '');
    let u = b.id ? db.users.find((x) => x.id === b.id) : null;
    if (b.id && !u) return send(res, 404, { error: 'no such teacher' });
    if (!u) {
      if (!name || !/^[a-z0-9._-]{3,30}$/.test(login) || login === 'admin') return send(res, 400, { error: 'bad name or login' });
      if (db.users.some((x) => x.login === login)) return send(res, 409, { error: 'login already used' });
      if (password.length < 8) return send(res, 400, { error: 'password too short' });
      u = { id: 'u' + crypto.randomBytes(6).toString('hex'), name, login, active: true, salt: '', hash: '' };
      db.users.push(u);
    } else {
      if (name) u.name = name;
      if (typeof b.active === 'boolean') u.active = b.active;
      const months = Number(b.months);
      if (Number.isInteger(months) && months > 0 && months <= 24) {   // payment received: extend the subscription
        u.paidUntil = Math.max(Date.now(), u.paidUntil || 0) + months * 30 * 24 * 3600e3;
        u.active = true;
      }
      if (u.active && u.pending) {                                    // first approval: open the room they asked for
        u.pending = false;
        const plan = db.plans.find((x) => x.id === u.planId);
        if (u.wantRoom && !db.rooms.some((c) => c.ownerId === u.id) && rooms.size < 200) {
          const cfg = { slug: slugFor(u.wantRoom), title: u.wantRoom, topic: u.wantTopic || '', ownerId: u.id, slow: 3, pinned: '', liveTitle: '', banned: {}, capacity: plan ? plan.capacity : 0 };
          db.rooms.push(cfg); openRoom(cfg);
        }
      }
      if (password && password.length < 8) return send(res, 400, { error: 'password too short' });
    }
    if (password) { u.salt = crypto.randomBytes(12).toString('hex'); u.hash = hashPass(password, u.salt); }
    if (!isActive(u)) {                                        // a suspended teacher is cut off at once
      for (const r of rooms.values()) {
        if (r.cfg.ownerId !== u.id) continue;
        for (const k of [...r.rtc.keys()]) if (k.startsWith('host:')) closeRtc(r, k);
        for (const ws of r.clients) if (ws.userId === u.id) ws.close();
      }
    }
    save();
    return send(res, 200, { id: u.id });
  }
  if (what === 'user' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!db.users.some((u) => u.id === id)) return send(res, 404, { error: 'no such teacher' });
    if (db.rooms.some((c) => c.ownerId === id)) return send(res, 409, { error: 'teacher still has rooms' });
    db.users = db.users.filter((u) => u.id !== id);
    save();
    return send(res, 200, { ok: true });
  }
  if (what === 'room' && req.method === 'POST') {            // create, or update when "slug" is given
    const b = await readJson(req);
    const title = clean(b.title, 60), topic = clean(b.topic, 40);
    const ownerId = b.ownerId === 'admin' || db.users.some((u) => u.id === b.ownerId) ? b.ownerId : null;
    let room = b.slug ? rooms.get(b.slug) : null;
    if (b.slug && !room) return send(res, 404, { error: 'no such room' });
    if (!room) {
      if (!title || !ownerId) return send(res, 400, { error: 'title and teacher are required' });
      if (rooms.size >= 200) return send(res, 409, { error: 'too many rooms' });
      const cfg = { slug: slugFor(title), title, topic, ownerId, slow: 3, pinned: '', liveTitle: '', banned: {} };
      db.rooms.push(cfg);
      room = openRoom(cfg);
    } else {
      if (title) room.cfg.title = title;
      if (typeof b.topic === 'string') room.cfg.topic = topic;
      if (Number.isInteger(b.capacity) && b.capacity >= 0 && b.capacity <= 100000) room.cfg.capacity = b.capacity;
      if (ownerId && ownerId !== room.cfg.ownerId) {
        room.cfg.ownerId = ownerId;
        for (const k of [...room.rtc.keys()]) if (k.startsWith('host:')) closeRtc(room, k);
        for (const ws of room.clients) if (ws.mod) ws.close();
      }
    }
    save();
    return send(res, 200, { slug: room.cfg.slug });
  }
  if (what === 'settings' && req.method === 'POST') {       // payment instructions and the plans on offer
    const b = await readJson(req);
    const bad = acct.adminSet(b);                              // who must have an account, and the mailbox that sends the codes
    if (bad) return send(res, 400, { error: bad });
    if (typeof b.payInfo === 'string') db.payInfo = b.payInfo.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500);
    if (Array.isArray(b.plans)) {
      const plans = [];
      for (const x of b.plans.slice(0, 12)) {
        const name = clean(x && x.name, 30), price = Number(x && x.price), capacity = Number(x && x.capacity);
        if (!name || !(price >= 0) || !Number.isInteger(capacity) || capacity < 1 || capacity > 100000) return send(res, 400, { error: 'bad plan' });
        plans.push({ id: (x.id && /^[a-z0-9]{2,12}$/.test(x.id)) ? x.id : 'p' + crypto.randomBytes(4).toString('hex'), name, price: Math.round(price * 100) / 100, capacity });
      }
      db.plans = plans;
    }
    save();
    return send(res, 200, { ok: true });
  }
  if (what === 'mailtest' && req.method === 'POST') {
    const bad = await acct.adminTest((await readJson(req)).to);
    return bad ? send(res, 400, { error: bad }) : send(res, 200, { ok: true });
  }
  if (what === 'member' && req.method === 'DELETE') return acct.adminRemove(url.searchParams.get('id')) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'no such member' });
  if (what === 'room' && req.method === 'DELETE') {
    const room = rooms.get(url.searchParams.get('slug'));
    if (!room) return send(res, 404, { error: 'no such room' });
    if (rooms.size === 1) return send(res, 409, { error: 'the last room cannot be deleted' });
    closeRoom(room);
    save();
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p.startsWith('/hls/')) {
      if (req.method !== 'GET') return send(res, 405, 'Method');
      return proxyHls(req, res, p.slice(4) + url.search);
    }
    if (p === '/healthz') return send(res, 200, { ok: true, live: [...rooms.values()].some((r) => r.live), viewers: wss.clients.size });
    if (p === '/api/config') {
      const room = roomOf(url);
      if (!room) return send(res, 404, { error: 'no such room' });
      return send(res, 200, {
        site: SITE_TITLE, room: room.cfg.slug, title: room.cfg.title, topic: room.cfg.topic, host: ownerName(room),
        rooms: rooms.size, hls: `${HLS_PUBLIC_URL || '/hls'}/air_${room.cfg.slug}/index.m3u8`, locked: !!room.cfg.code, next: nextOf(room), sound: soundUrl(room), soundOwn: !!room.cfg.sound, pics: picUrls(room),
        access: acct.access(), accounts: acct.mailReady(),
      });
    }
    if (p === '/api/site') return send(res, 200, { site: SITE_TITLE, access: acct.access(), accounts: acct.mailReady() });
    if (p.startsWith('/api/member/')) return await acct.handle(req, res, p.slice(12));
    if (p === '/api/sound') return handleSound(req, res, url);
    if (p === '/api/pics') return handlePics(req, res, url);
    if (p.startsWith('/media/pic/')) return servePic(res, p.slice(11));
    if (p.startsWith('/media/sound/')) return serveSound(req, res, p.slice(13));
    if (p === '/api/pass') {                      // the pass that lets an admitted person's player fetch the stream
      const room = roomOf(url);
      if (!room) return send(res, 404, { error: 'no such room' });
      if (room.cfg.gate && !room.admitted.has(String(url.searchParams.get('uid') || ''))) return send(res, 403, { error: 'not admitted' });
      if (acct.access() === 'watch' && !acct.memberOf(bearer(req))) return send(res, 401, { error: 'sign in' });
      if (!codeOk(room, url.searchParams.get('code'))) return send(res, 403, { error: 'bad code' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': `rlp_${room.cfg.slug}=${sign('pass', room.cfg.slug, 12 * 3600e3)}; Path=/hls/; Max-Age=43200; HttpOnly; SameSite=Lax` });
    }
    if (p === '/api/join' && req.method === 'POST') {            // "join with a code": which room does this entry code open?
      const code = String((await readJson(req)).code || '').replace(/\D/g, ''), ip = clientIp(req);
      const room = code.length === 6 ? [...rooms.values()].find((r) => r.cfg.code && safeEq(r.cfg.code, code)) : null;
      if (!codeAllowed(ip, !room)) return send(res, 429, { error: 'too many requests' });
      return room ? send(res, 200, { slug: room.cfg.slug }) : send(res, 404, { error: 'bad code' });
    }
    if (p === '/api/rooms') return send(res, 200, { site: SITE_TITLE, rooms: [...rooms.values()].map(publicRoom) });
    if (p === '/api/plans') return send(res, 200, { site: SITE_TITLE, plans: db.plans });
    if (p === '/api/apply' && req.method === 'POST') {            // a teacher asks for an account; nothing is open until approved
      const ip = clientIp(req);
      if (!applyAllowed(ip)) return send(res, 429, { error: 'too many requests' });
      const b = await readJson(req);
      const name = clean(b.name, 40), login = clean(b.login, 30).toLowerCase(), password = String(b.password || '');
      const contact = clean(b.contact, 80), wantRoom = clean(b.roomTitle, 60), wantTopic = clean(b.topic, 40);
      const plan = db.plans.find((x) => x.id === b.planId);
      if (!name || !contact || !wantRoom || !plan) return send(res, 400, { error: 'missing fields' });
      if (!/^[a-z0-9._-]{3,30}$/.test(login) || login === 'admin') return send(res, 400, { error: 'bad name or login' });
      if (password.length < 8) return send(res, 400, { error: 'password too short' });
      if (db.users.some((x) => x.login === login)) return send(res, 409, { error: 'login already used' });
      if (db.users.filter((x) => x.pending).length >= 300) return send(res, 429, { error: 'too many requests' });
      const salt = crypto.randomBytes(12).toString('hex');
      db.users.push({ id: 'u' + crypto.randomBytes(6).toString('hex'), name, login, active: false, pending: true, salt, hash: hashPass(password, salt), contact, wantRoom, wantTopic, planId: plan.id, askedAt: Date.now() });
      save();
      return send(res, 200, { ok: true, payInfo: db.payInfo, plan });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (!loginAllowed(ip)) return send(res, 429, { error: 'too many attempts' });
      const body = await readJson(req);
      const login = clean(body.login, 30).toLowerCase(), password = String(body.password || '');
      let id = null;
      const u = db.users.find((x) => x.login === login);
      // hash even for an unknown login, so the answer takes the same time
      const got = hashPass(password, u ? u.salt : 'no-such-user');
      if (u && isActive(u) && u.hash && safeEq(got, u.hash)) id = u.id;
      // the administrator has no login: their password is enough, whatever the browser
      // put in the login field (autofill often writes an e-mail address there)
      else if (!u && safeEq(hmac(password), hmac(ADMIN_PASSWORD))) id = 'admin';
      if (!id) { loginFailed(ip); return send(res, 401, { error: 'wrong login or password' }); }
      const me = whoIs(sign('user', id, 1000));
      return send(res, 200, { token: sign('user', id, 12 * 3600e3), role: me.role, name: me.name });
    }
    if (p === '/api/me') {
      const me = whoIs(bearer(req));
      if (!me) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, { user: me, rooms: [...rooms.values()].filter((r) => canHost(me, r)).map(publicRoom) });
    }
    if (p === '/api/recordings') return handleRecordings(req, res, url);
    const a = p.match(/^\/api\/admin(?:\/(user|room|settings|mailtest|member))?$/);
    if (a) return handleAdmin(req, res, url, a[1]);
    const m = p.match(/^\/api\/rtc\/(whip|whep)\/([a-z]+(?:[1-9]|1[0-2])?)$/);
    if (m) return handleRtc(req, res, url, m[1], m[2]);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method');
    // with a single room, the front page is that room; otherwise it lists the rooms
    if (p === '/') return serveFile(res, path.join(PUBLIC_DIR, rooms.size === 1 && !acct.mailReady() ? 'index.html' : 'home.html'));    // one room and no accounts: straight to the room; otherwise the site's front page
    if (p === '/rooms') return serveFile(res, path.join(PUBLIC_DIR, 'home.html'));
    if (/^\/r\/[a-z0-9-]+$/.test(p)) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (p === '/studio') return serveFile(res, path.join(PUBLIC_DIR, 'studio.html'));
    if (p === '/admin') return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    if (p === '/teach') return serveFile(res, path.join(PUBLIC_DIR, 'teach.html'));
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

const tx = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
// Chat traffic is batched: one frame every 200 ms for everybody in a room.
const broadcast = (room, ev) => room.outbox.push(ev);
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.outbox.length) continue;
    const frame = JSON.stringify({ t: 'batch', ev: room.outbox });
    room.outbox = [];
    for (const ws of room.clients) if (ws.readyState === 1) ws.send(frame);
  }
}, 200);
const toMods = (room, obj) => { for (const ws of room.clients) if (ws.mod) tx(ws, obj); };
const toUid = (room, uid, obj) => { for (const ws of room.byUid.get(uid) || []) tx(ws, obj); };
const viewersOf = (room) => { let n = 0; for (const ws of room.clients) if (!ws.mod) n++; return n; };
// People at the door of a room with a waiting room (one line per person, whatever their number of tabs).
function waitingList(room) {
  const seen = new Map();
  for (const ws of room.waiters) if (ws.wname && !seen.has(ws.uid)) seen.set(ws.uid, { uid: ws.uid, name: ws.wname });
  return [...seen.values()].slice(0, 100);
}
const tellWaiting = (room) => toMods(room, { t: 'waiting', gate: !!room.cfg.gate, list: waitingList(room) });
function answerDoor(room, uid, ok) {           // uid '' = everybody at the door
  for (const ws of [...room.waiters]) {
    if (uid ? ws.uid !== uid : !ws.wname && !ok) continue;
    room.waiters.delete(ws); ws.waitRoom = null;
    if (ok) { room.admitted.add(ws.uid); room.refused.delete(ws.uid); } else room.refused.add(ws.uid);
    tx(ws, { t: ok ? 'admitted' : 'refused' });
  }
}
const handsList = (room) => [...room.hands].map(([uid, h]) => ({ uid, name: h.name })).slice(0, 50);
const guestsPublic = (room) => [...room.guests].map(([slot, g]) => ({ slot, uid: g.uid, name: g.name, ready: g.ready, muted: !!g.muted, cam: g.cam !== false }));
const slotOf = (room, uid) => { for (const [slot, g] of room.guests) if (g.uid === uid) return slot; return 0; };

// Take one guest (or, without a slot, everybody) off the stage.
function endStage(room, reason, only) {
  const slots = only ? [only] : [...room.guests.keys()];
  let changed = false;
  for (const slot of slots) {
    const g = room.guests.get(slot);
    if (!g) continue;
    room.guests.delete(slot); changed = true;
    toUid(room, g.uid, { t: 'kick', reason });
    for (const k of [...room.rtc.keys()]) if (k.startsWith(`guest${slot}:`) || k === `host:whep:guest${slot}` || k === `host:whip:backstage${slot}`) closeRtc(room, k);
  }
  if (changed) broadcast(room, { t: 'guests', guests: guestsPublic(room) });
}

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.ip = clientIp(req);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (ws.waitRoom) { const r = ws.waitRoom; ws.waitRoom = null; r.waiters.delete(ws); if (ws.wname) tellWaiting(r); }
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    const set = room.byUid.get(ws.uid);
    if (set) { set.delete(ws); if (!set.size) room.byUid.delete(ws.uid); }
    if (!room.byUid.has(ws.uid) && room.hands.delete(ws.uid)) toMods(room, { t: 'hands', list: handsList(room) });
  });

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    if (!d || typeof d.t !== 'string') return;

    if (d.t === 'hello') {
      if (ws.room || ws.waitRoom) return;
      if (!/^[a-z0-9]{12,40}$/.test(String(d.uid || ''))) return ws.close();
      const room = d.room ? rooms.get(String(d.room)) : defaultRoom();
      if (!room) return ws.close();
      const user = whoIs(d.token);
      const host = canHost(user, room);
      const member = host ? null : acct.memberOf(d.mt);
      if (!host && !member && acct.access() === 'watch') return tx(ws, { t: 'signin' });   // the site is for signed-in people only
      if (!host && room.cfg.code) {             // the room has an entry code
        const wrong = !codeOk(room, d.code);
        if (!codeAllowed(ws.ip, wrong && !!d.code)) return tx(ws, { t: 'code', wait: true });
        if (wrong) return tx(ws, { t: 'code', bad: !!d.code });
      }
      if (!host && room.cfg.capacity > 0 && viewersOf(room) >= room.cfg.capacity && !room.byUid.has(String(d.uid))) {
        tx(ws, { t: 'full', capacity: room.cfg.capacity });   // the room's plan is full
        return ws.close();
      }
      if (!host && room.cfg.gate && !room.admitted.has(String(d.uid))) {      // waiting room: the host lets people in one by one
        ws.uid = String(d.uid);
        if (room.refused.has(ws.uid)) return tx(ws, { t: 'refused' });
        if (room.waiters.size >= 2000) { tx(ws, { t: 'full', capacity: 0 }); return ws.close(); }
        ws.waitRoom = room; ws.wname = member ? member.name : clean(d.name, MAX_NAME);
        room.waiters.add(ws);
        tx(ws, { t: 'wait', named: !!ws.wname });
        if (ws.wname) tellWaiting(room);
        return;
      }
      ws.room = room; ws.uid = d.uid;
      ws.mod = host;
      ws.userId = ws.mod ? user.id : null;
      ws.member = member ? member.id : null;
      ws.name = ws.mod ? user.name : member ? member.name : clean(d.name, MAX_NAME);
      ws.color = colorOf(d.color);
      room.clients.add(ws);
      if (!room.byUid.has(ws.uid)) room.byUid.set(ws.uid, new Set());
      room.byUid.get(ws.uid).add(ws);
      return tx(ws, {
        t: 'init', live: room.live, likes: room.likes, reacts: room.totals, viewers: room.clients.size,
        slow: room.cfg.slow, pinned: room.cfg.pinned, title: room.cfg.liveTitle,
        history: room.history, guests: guestsPublic(room), maxGuests: MAX_GUESTS, mod: ws.mod, banned: !!room.cfg.banned[ws.uid],
        hands: ws.mod ? handsList(room) : undefined, hand: room.hands.has(ws.uid),
        code: ws.mod ? room.cfg.code || '' : undefined, next: nextOf(room),
        rec: ws.mod ? !!room.rec : undefined, needPass: passNeeded(room), access: acct.access(), gate: !!room.cfg.gate, waiting: ws.mod ? waitingList(room) : undefined,
      });
    }
    if (ws.waitRoom) {                      // at the door: the only thing to say is one's name
      if ((d.t === 'knock' || d.t === 'name') && clean(d.name, MAX_NAME)) {
        ws.wname = clean(d.name, MAX_NAME);
        tx(ws, { t: 'wait', named: true });
        tellWaiting(ws.waitRoom);
      }
      return;
    }
    const room = ws.room;
    if (!room) return;
    const cfg = room.cfg;

    switch (d.t) {
      case 'name': if (!ws.mod && !ws.member) ws.name = clean(d.name, MAX_NAME); return;
      case 'color': ws.color = colorOf(d.c); return;          // the colour of this person's comments

      case 'msg': {
        const text = clean(d.text, MAX_TEXT);
        if (!ws.mod && !ws.member && acct.access() !== 'open') return tx(ws, { t: 'err', code: 'signin' });   // comments are for signed-in people
        if (!text || !ws.name) return;
        if (cfg.banned[ws.uid]) return tx(ws, { t: 'err', code: 'banned' });
        const now = Date.now();
        if (!ws.mod && cfg.slow > 0) {
          const wait = cfg.slow * 1000 - (now - (room.lastMsgAt.get(ws.uid) || 0));
          if (wait > 0) return tx(ws, { t: 'err', code: 'slow', wait: Math.ceil(wait / 1000) });
        }
        room.lastMsgAt.set(ws.uid, now);
        const msg = { id: ++room.seq, uid: ws.uid, name: ws.name, text, ts: now, mod: ws.mod || undefined, c: ws.color || undefined };
        room.history.push(msg);
        if (room.history.length > HISTORY) room.history.shift();
        return broadcast(room, { t: 'msg', m: msg });
      }

      // ---- stage requests (viewer side)
      case 'hand':
        if (!ws.mod && !ws.member && acct.access() !== 'open') return tx(ws, { t: 'err', code: 'signin' });
        if (!ws.name || cfg.banned[ws.uid] || slotOf(room, ws.uid)) return;
        if (d.on === false) room.hands.delete(ws.uid);
        else if (room.hands.size < 200) room.hands.set(ws.uid, { name: ws.name, ts: Date.now() });
        tx(ws, { t: 'hand', on: room.hands.has(ws.uid) });
        return toMods(room, { t: 'hands', list: handsList(room) });
      case 'onstage': {
        const g = room.guests.get(slotOf(room, ws.uid));
        if (g && !g.ready) { g.ready = true; broadcast(room, { t: 'guests', guests: guestsPublic(room) }); }
        return;
      }
      case 'cam': {                      // a guest turns their camera on or off
        const g = room.guests.get(slotOf(room, ws.uid));
        if (g && (g.cam !== false) !== !!d.on) { g.cam = !!d.on; broadcast(room, { t: 'guests', guests: guestsPublic(room) }); }
        return;
      }
      case 'who': {                      // who is watching: the names people chose, and how many gave none
        const now = Date.now();
        if (now - (ws.lastWho || 0) < 1500) return;
        ws.lastWho = now;
        const names = new Map(); let anon = 0;
        for (const c of room.clients) { if (c.name) names.set(c.uid, { name: c.name, host: c.mod || undefined }); else anon++; }
        return tx(ws, { t: 'who', people: [...names.values()].slice(0, 300), more: Math.max(0, names.size - 300), anon });
      }
      case 'leave':
        if (slotOf(room, ws.uid)) endStage(room, 'left', slotOf(room, ws.uid));
        return;
      case 'like':                       // older pages: a plain heart
      case 'react': {                    // reactions: anyone watching, a few per second at most
        const k = d.t === 'like' ? 2 : d.k;
        const now = Date.now();
        if (!Number.isInteger(k) || k < 0 || k >= REACTIONS || cfg.banned[ws.uid] || now - (ws.lastLike || 0) < 200) return;
        ws.lastLike = now; room.likes++; room.reacts[k]++; room.totals[k]++; room.likesDirty = true;
        return;
      }
    }

    // ---- moderator actions (the room's host)
    if (!ws.mod) return;
    switch (d.t) {
      case 'del': {
        const i = room.history.findIndex((m) => m.id === d.id);
        if (i >= 0) room.history.splice(i, 1);
        return broadcast(room, { t: 'del', id: d.id });
      }
      case 'ban': {
        const uid = String(d.uid || '');
        if (!room.byUid.has(uid) && !room.history.some((m) => m.uid === uid)) return;
        if (d.on === false) delete cfg.banned[uid]; else cfg.banned[uid] = Date.now();
        save();
        if (d.on !== false) {
          for (let i = room.history.length - 1; i >= 0; i--) if (room.history[i].uid === uid) room.history.splice(i, 1);
          room.hands.delete(uid);
          if (slotOf(room, uid)) endStage(room, 'banned', slotOf(room, uid));
          broadcast(room, { t: 'purge', uid });
          toMods(room, { t: 'hands', list: handsList(room) });
        }
        return toUid(room, uid, { t: 'banned', on: d.on !== false });
      }
      case 'slow': cfg.slow = Math.max(0, Math.min(120, Number(d.sec) || 0)); save(); return broadcast(room, { t: 'slow', sec: cfg.slow });
      case 'pin': cfg.pinned = clean(d.text, 200); save(); return broadcast(room, { t: 'pin', text: cfg.pinned });
      case 'title': cfg.liveTitle = clean(d.text, 80); save(); return broadcast(room, { t: 'title', text: cfg.liveTitle });
      case 'stage': {
        const uid = String(d.uid || '');
        const h = room.hands.get(uid);
        if (slotOf(room, uid)) return tx(ws, { t: 'err', code: 'onstage' });
        if (!h || !room.byUid.has(uid)) return;
        let slot = 0;
        for (let i = 1; i <= MAX_GUESTS; i++) if (!room.guests.has(i)) { slot = i; break; }
        if (!slot) return tx(ws, { t: 'err', code: 'stagefull' });
        room.hands.delete(uid);
        const g = { uid, name: h.name, nonce: crypto.randomBytes(6).toString('hex'), ready: false };
        room.guests.set(slot, g);
        toUid(room, uid, { t: 'invite', slot, token: sign('stage', `${cfg.slug}_${uid}_${slot}_${g.nonce}`, 4 * 3600e3) });
        broadcast(room, { t: 'guests', guests: guestsPublic(room) });
        return toMods(room, { t: 'hands', list: handsList(room) });
      }
      case 'code':                         // entry code on (a new one is drawn) or off
        cfg.code = d.on ? String(crypto.randomInt(0, 1000000)).padStart(6, '0') : '';
        save();
        if (cfg.code) for (const c of [...room.clients]) if (!c.mod && !slotOf(room, c.uid)) c.close();     // viewers come back through the code; guests on stage stay
        return toMods(room, { t: 'code', code: cfg.code });
      case 'cap': {                        // what the host just said, with its translations: shown (and spoken) to viewers
        const now = Date.now();
        if (now - (ws.lastCap || 0) < 150 || !['ar', 'fr', 'en'].includes(d.src) || !d.tx || typeof d.tx !== 'object') return;
        ws.lastCap = now;
        const words = {}, src = d.src;
        for (const l of ['ar', 'fr', 'en']) { const v = clean(d.tx[l], 400); if (v) words[l] = v; }
        if (!words[src]) return;
        // languages the host's browser did not translate are done here, one sentence after the other
        room.capChain = (room.capChain || Promise.resolve()).then(async () => {
          const missing = ['ar', 'fr', 'en'].filter((l) => !words[l]);
          if (TRANSLATE_URL) await Promise.all(missing.map(async (l) => { try { const v = await translate(words[src], src, l); if (v) words[l] = v; } catch { /* that language is left out */ } }));
          broadcast(room, { t: 'cap', src, tx: words });
          tx(ws, { t: 'capinfo', tx: words });
        });
        return;
      }
      case 'next': {                       // announce the next session (or clear it)
        const at = Number(d.at);
        cfg.next = at > Date.now() - 3600e3 && at < Date.now() + 366 * 24 * 3600e3 ? { at, title: clean(d.title, 80) } : null;
        save();
        return broadcast(room, { t: 'next', next: nextOf(room) });
      }
      case 'rec':                          // record this live, or stop recording it
        if (d.on && !room.live) return tx(ws, { t: 'rec', on: false, err: 'offline' });
        setRecording(room, !!d.on).then((ok) => { if (!ok) tx(ws, { t: 'rec', on: !!room.rec, err: 'failed' }); });
        return;
      case 'gate':                         // waiting room on or off
        cfg.gate = !!d.on; save();
        if (cfg.gate) { for (const c of room.clients) room.admitted.add(c.uid); }   // people already inside stay
        else { answerDoor(room, '', true); room.refused.clear(); }
        broadcast(room, { t: 'gate', on: cfg.gate });
        return tellWaiting(room);
      case 'admit':                        // let one person in (or everybody), or turn one away
        if (d.uid) answerDoor(room, String(d.uid), d.ok !== false);
        else for (const w of waitingList(room)) answerDoor(room, w.uid, true);     // everybody who gave a name
        return tellWaiting(room);
      case 'mute': {                       // the host closes or opens a guest's microphone (no uid: every guest)
        let changed = false;
        for (const [, g] of room.guests) {
          if (d.uid && g.uid !== String(d.uid)) continue;
          if (!!g.muted === (d.on !== false)) continue;
          g.muted = d.on !== false; changed = true;
          toUid(room, g.uid, { t: 'muted', on: g.muted });
        }
        if (changed) broadcast(room, { t: 'guests', guests: guestsPublic(room) });
        return;
      }
      case 'unstage':                      // one guest (by uid), or everybody
        if (!d.uid) return endStage(room, 'removed');
        if (slotOf(room, String(d.uid))) endStage(room, 'removed', slotOf(room, String(d.uid)));
        return;
    }
  });
});

// Dead-connection sweep
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30e3);
// Reactions: r = sent since the last tick, c = totals per reaction
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.likesDirty) continue;
    room.likesDirty = false;
    broadcast(room, { t: 'likes', n: room.likes, r: room.reacts, c: room.totals });
    room.reacts = zeros();
  }
}, 700);
setInterval(() => {
  for (const room of rooms.values()) {
    const n = room.clients.size;
    if (n !== room.lastViewers) { room.lastViewers = n; broadcast(room, { t: 'viewers', n }); }
  }
}, 3000);
setInterval(() => {
  const cutoff = Date.now() - 10 * 60e3;
  for (const room of rooms.values()) for (const [uid, ts] of room.lastMsgAt) if (ts < cutoff) room.lastMsgAt.delete(uid);
}, 60e3);

// A subscription that has run out ends the teacher's live and studio session.
setInterval(() => {
  for (const u of db.users) {
    if (!u.active || isActive(u)) continue;
    for (const r of rooms.values()) {
      if (r.cfg.ownerId !== u.id) continue;
      for (const k of [...r.rtc.keys()]) if (k.startsWith('host:')) closeRtc(r, k);
      for (const ws of r.clients) if (ws.userId === u.id) ws.close();
    }
  }
}, 60e3);

// Translation of the host's words (a LibreTranslate service next to the app; nothing leaves the server).
const TRANSLATE_URL = (env.TRANSLATE_URL || '').replace(/\/$/, '');
async function translate(q, source, target) {
  const r = await fetch(`${TRANSLATE_URL}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, source, target, format: 'text' }), signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error('translate ' + r.status);
  return clean((await r.json()).translatedText, 400);
}

// Recording is the host's choice, live by live. The media server writes the file; we only
// switch "record" on that room's air path (a change it applies without cutting the live).
async function setRecording(room, on) {
  const name = `air_${room.cfg.slug}`, head = { Authorization: MTX_AUTH, 'Content-Type': 'application/json' }, body = JSON.stringify({ record: on });
  const call = (method, verb) => fetch(`${MTX_API}/v3/config/paths/${verb}/${name}`, { method, headers: head, body, signal: AbortSignal.timeout(4000) });
  try {
    let r = await call('PATCH', 'patch');
    if (!r.ok && on) r = await call('POST', 'add');          // first recording of this room since the media server started
    if (!r.ok && on) return false;
  } catch { if (on) return false; }
  room.rec = on;
  toMods(room, { t: 'rec', on });
  return true;
}

// Ask the media server which rooms are on air.
async function pollLive() {
  const onAir = new Set();
  try {
    const r = await fetch(`${MTX_API}/v3/paths/list?itemsPerPage=1000`, { headers: { Authorization: MTX_AUTH }, signal: AbortSignal.timeout(1500) });
    if (r.ok) for (const it of (await r.json()).items || []) if (it.available ?? it.ready) onAir.add(it.name);
  } catch { /* media server down = everything offline */ }
  for (const room of rooms.values()) {
    const on = onAir.has(`air_${room.cfg.slug}`);
    if (on === room.live) continue;
    room.live = on;
    if (on) { room.likes = 0; room.totals = zeros(); room.likesDirty = true; }      // a new live starts its reactions from zero
    broadcast(room, { t: 'live', on });
    if (!on) endStage(room, 'ended');
    if (!on && room.rec) setRecording(room, false);                                 // the next live starts without recording
  }
}
setInterval(pollLive, 2000);

server.listen(PORT, LISTEN_HOST, () => {
  console.log(`REGAM Live listening on :${server.address().port}`);
});
