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
let saveTimer = null, frozen = false;         // frozen: a backup was just put back, the running state must not be written over it
function save() {
  if (frozen) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (frozen) return;
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (err) => { if (!err && !frozen) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {}); });
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
    questions: [], poll: null,                                       // questions put to the teacher; the poll or quiz in progress
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
// An account is gone: nothing about it stays in the rooms (class lists, assistants, payments of entry).
function forgetMember(id) {
  fs.unlink(avatarFile(id), () => {});
  for (const room of rooms.values()) {
    const c = room.cfg;
    for (const k of ['students', 'helpers', 'left']) if (c[k]) c[k] = c[k].filter((x) => x !== id);
    if (c.paid) delete c.paid[id];
  }
}
const acct = require('./accounts')({ db, save, send, readJson, sign, verify, clean, clientIp, siteTitle: SITE_TITLE, env, onRemove: forgetMember });
const ai = require('./ai')({ db, save, clean, env });
const bak = require('./backup')({ db, dataDir: DATA_DIR, dbFile: DB_FILE, freeze: () => { frozen = true; clearTimeout(saveTimer); }, mail: acct.mail, mailReady: acct.mailReady, siteTitle: SITE_TITLE });
const SITE_TZ = env.SITE_TZ || 'Africa/Casablanca';
const QUESTION = /[?؟]|^\s*(comment|pourquoi|quand|où|ou est|est-ce|c'est quoi|combien|how|why|what|when|where|who|can |is |does |كيف|كيفاش|شنو|شنا|علاش|واش|فين|فوقاش|شحال|متى|هل|ماذا|لماذا|أين|كم)|@ai\b|@assistant|المساعد/i;
// What the help assistant may know about the site (nothing private: no codes, no e-mails).
function siteFacts() {
  const when = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: SITE_TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const lines = [`Site name: ${SITE_TITLE}. Times below are in the ${SITE_TZ} time zone. Now: ${when(Date.now())}.`,
    acct.access() === 'watch' ? 'An account is required to watch: "Créer un compte", then validate with the 6-digit code (or the link) received by e-mail, then sign in.'
      : acct.access() === 'join' ? 'Watching is open to all; an account is required to comment or to come on stage.' : acct.mailReady() ? 'Accounts are optional.' : 'There are no viewer accounts on this site.',
    'To enter a room: open the home page and click "Entrer dans la salle", or open the invitation link. If the room asks for an entry code, type the 6-digit code from the invitation (each planned live has its own code, valid from 30 minutes before its start).',
    'To speak with the host on video: during a live, click "Demander à monter"; the host accepts; then choose camera or microphone only.',
    'Under the video: reactions (emoji), "Traduction" to read or hear the host in Arabic, French or English, "Partager" for the link. Comments open with the "Commentaires" button.',
    'Rooms:'];
  for (const r of rooms.values()) {
    const next = sessionsOf(r).slice(0, 3).map((s) => `${when(s.at)}${s.title ? ' (' + s.title + ')' : ''}`).join('; ');
    lines.push(`- "${r.cfg.title}"${r.cfg.topic ? ' [' + r.cfg.topic + ']' : ''}, host ${ownerName(r)}: ${r.live ? 'LIVE NOW' : 'not live'}${r.cfg.code ? ', entry code required' : ''}${next ? '. Planned lives: ' + next : '. No live planned.'}`);
  }
  return lines.join('\n');
}
const helpHits = new Map();                  // ip -> [timestamps]
// A viewer asked something in the comments: the assistant answers in the thread, at a calm pace.
async function aiReply(room, ws, msg) {
  const now = Date.now();
  if (room.aiBusy || now - (room.aiAt || 0) < 6000 || now - (ws.aiAt || 0) < 20000) return;
  room.aiBusy = true; room.aiAt = now; ws.aiAt = now;
  try {
    const text = await ai.answerComment({
      site: SITE_TITLE, room: room.cfg.title, live: room.live, title: room.cfg.liveTitle || '',
      spoken: (room.capLog || []).slice(-12), comments: room.history.slice(-12, -1).map((m) => `${m.name}: ${m.text}`), asker: msg.name, question: msg.text,
    });
    if (!text || !room.history.includes(msg)) return;             // nothing to say, or the question was deleted meanwhile
    const reply = { id: ++room.seq, uid: 'assistant', name: 'Assistant IA', text: clean(`@${msg.name} ${text}`, 500), ts: Date.now(), ai: true };
    room.history.push(reply);
    if (room.history.length > HISTORY) room.history.shift();
    broadcast(room, { t: 'msg', m: reply });
  } catch { /* the assistant stays silent */ } finally { room.aiBusy = false; }
}
// the stream is only handed to people holding a pass when the room has a waiting room or the site asks for an account
const passNeeded = (room) => !!room.cfg.gate || !!room.cfg.code || acct.access() === 'watch' || !!(room.cfg.fee && room.cfg.fee.amount > 0) || !!room.cfg.closed;
// Entry code of a room (like a meeting passcode): the host sends it with the invitation.
// Which codes open the room right now. Each planned live has its own code, good from half an hour
// before its start until half an hour after its end, and during that time it is the only one that
// works. Outside planned lives, the room's own code works; it is renewed after every live.
const OPEN_EARLY = 30 * 60e3, OPEN_LATE = 30 * 60e3;
function codeState(room, code) {
  if (!room.cfg.code) return { ok: true };
  const c = String(code || '').replace(/\D/g, ''), now = Date.now(), all = room.cfg.sessions || [];
  const current = all.filter((s) => now >= s.at - OPEN_EARLY && now < (s.end || s.at + 3 * 3600e3) + OPEN_LATE);
  if (current.length ? current.some((s) => s.code && safeEq(s.code, c)) : safeEq(room.cfg.code, c)) return { ok: true };
  const later = all.find((s) => s.code && now < s.at - OPEN_EARLY && safeEq(s.code, c));
  return later ? { ok: false, early: later.at } : { ok: false };
}
const codeOk = (room, code) => codeState(room, code).ok;
const codeTries = new Map();     // ip -> [timestamps of wrong codes]
function codeAllowed(ip, wrong) {
  const now = Date.now(), list = (codeTries.get(ip) || []).filter((t) => t > now - 10 * 60e3);
  if (wrong) list.push(now);
  codeTries.set(ip, list);
  return list.length <= 12;
}
// The room's calendar: sessions planned by its host ({ id, at, end, title }, times in ms).
// A session stays listed until its end (or three hours after its start when no end was given).
const newCode = (room) => {                 // six digits, different from the room's other codes
  for (;;) { const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); if (c !== room.cfg.code && !(room.cfg.sessions || []).some((x) => x.code === c)) return c; }
};
function plannedOf(room) {                  // with each session's own entry code: for the host only
  const c = room.cfg, now = Date.now();
  if (c.next && !c.sessions) { c.sessions = [{ id: 's' + c.next.at, at: c.next.at, end: 0, title: c.next.title || '' }]; delete c.next; }     // from the earlier single "next live"
  const list = (c.sessions || []).filter((s) => (s.end || s.at + 3 * 3600e3) > now).sort((a, b) => a.at - b.at);
  for (const s of list) if (!s.code) s.code = newCode(room);
  return list;
}
const sessionsOf = (room) => plannedOf(room).map((s) => ({ id: s.id, at: s.at, end: s.end, title: s.title }));     // what everybody may see
const nextOf = (room) => sessionsOf(room)[0] || null;
// One session as a calendar file, so people can add it to their own agenda.
function icsOf(room, s, origin) {
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = (t) => String(t).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const url = `${origin}/r/${room.cfg.slug}`, name = room.cfg.title + (s.title ? ' - ' + s.title : '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//REGAM Live//FR', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${s.id}-${room.cfg.slug}@regam-live`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(s.at)}`, `DTEND:${z(s.end || s.at + 3600e3)}`,
    `SUMMARY:${esc(name)}`, `DESCRIPTION:${esc(url)}`, `URL:${url}`, `LOCATION:${esc(url)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(name)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
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
// The recitation that comes with the site, played one surah after the other and then again from the
// start: Ar-Rahman (55), Al-Waqi'a (56), Al-Hadid (57), by Abdulbasit Abdulsamad. WAIT_SOUND_URL
// replaces it (several addresses separated by commas).
const DEFAULT_SOUNDS = ('WAIT_SOUND_URL' in env ? env.WAIT_SOUND_URL : ['055', '056', '057'].map((n) => `https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/${n}.mp3`).join(','))
  .split(',').map((u) => u.trim()).filter(Boolean);
const soundList = (room) => (room.cfg.sound ? [`/media/sound/${room.cfg.slug}?v=${room.cfg.sound.v}`] : room.cfg.soundOff ? [] : DEFAULT_SOUNDS);
const soundUrl = (room) => soundList(room)[0] || '';

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
        try { const st = fs.statSync(path.join(dir, f)); list.push({ name: f, size: st.size, mtime: st.mtimeMs, title: ((room.cfg.replays || {})[f] || {}).title || '' }); } catch { /* removed meanwhile */ }
      }
      list.sort((x, y) => (x.name < y.name ? 1 : -1));
      // while on air, the newest file is still being written
      send(res, 200, { live: room.live, list });
    });
  }
  if (!REC_NAME.test(name)) return send(res, 400, { error: 'bad name' });
  const file = path.join(dir, name);
  if (req.method === 'DELETE') { if (room.cfg.replays) { delete room.cfg.replays[name]; save(); } return fs.unlink(file, (err) => send(res, err ? 404 : 200, { ok: !err })); }
  if (req.method === 'PUT') {                    // show this recording to the students as a replay (with a title), or take it back
    return readJson(req).then((b) => {
      const title = clean(b.title, 80);
      if (title && !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      room.cfg.replays = room.cfg.replays || {};
      if (title) room.cfg.replays[name] = { title }; else delete room.cfg.replays[name];
      save();
      send(res, 200, { ok: true });
    });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${room.cfg.slug}_${name}"` });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

// ---- what a class keeps for its students: replays of past lives, and files to download
// A file sent in pieces when asked (players and phones ask for ranges).
function serveRanged(req, res, file, head) {
  fs.stat(file, (e, st) => {
    if (e) return send(res, 404, 'Not found');
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let from = 0, to = st.size - 1, code = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) { from = Number(m[1]); if (m[2]) to = Math.min(to, Number(m[2])); } else from = Math.max(0, st.size - Number(m[2]));
      if (from > to || from >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      code = 206; head['Content-Range'] = `bytes ${from}-${to}/${st.size}`;
    }
    res.writeHead(code, { ...head, 'Accept-Ranges': 'bytes', 'Content-Length': to - from + 1, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start: from, end: to }).on('error', () => res.destroy()).pipe(res);
  });
}
// May this person see what the room keeps for its students? The host, and whoever could walk in without being asked anything.
function mayEnter(req, room) {
  if (canHost(whoIs(bearer(req)), room)) return true;
  const who = acct.memberOf(bearer(req));
  if (acct.access() === 'watch' && !who) return false;
  if (cls.entry(room, who)) return false;
  return !room.cfg.code || cls.known(room, who);
}
// The photo of a profile: a small square JPEG, made in the browser from whatever picture the person chose.
const avatarFile = (id) => path.join(DATA_DIR, `avatar_${id}`);
const avatarOf = (m) => (m && m.av ? `${m.id}?v=${m.av}` : '');
function handleAvatar(req, res) {
  const m = acct.memberOf(bearer(req));
  if (!m) return send(res, 401, { error: 'signed out' });
  if (req.method === 'DELETE') { fs.unlink(avatarFile(m.id), () => {}); delete m.av; save(); return send(res, 200, { av: 0 }); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const tmp = avatarFile(m.id) + '.new';
  receiveFile(req, res, tmp, 400 * 1024, () => {
    const head = Buffer.alloc(3);
    try { const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 3, 0); fs.closeSync(fd); } catch { /* unreadable */ }
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) { fs.unlink(tmp, () => {}); return send(res, 415, { error: 'bad type' }); }
    fs.renameSync(tmp, avatarFile(m.id));
    m.av = Date.now(); save();
    send(res, 200, { av: m.av });
  });
}
const FILE_OK = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|png|jpe?g|zip|mp3)$/i, FILE_MAX = 30 * 1024 * 1024, FILES_PER_ROOM = 20;
const classFile = (slug, id) => path.join(DATA_DIR, `file_${slug}_${id}`);
const filesOf = (room) => (room.cfg.files || []).map((f) => ({ id: f.id, name: f.name, size: f.size }));
function handleFiles(req, res, url) {
  const room = roomOf(url);
  if (!room) return send(res, 404, { error: 'no such room' });
  if (!canHost(whoIs(bearer(req)), room)) return send(res, 401, { error: 'unauthorized' });
  const files = (room.cfg.files = room.cfg.files || []);
  if (req.method === 'GET') return send(res, 200, { files: filesOf(room) });
  if (req.method === 'DELETE') {
    const id = String(url.searchParams.get('id') || '');
    if (!files.some((f) => f.id === id)) return send(res, 404, { error: 'no such file' });
    room.cfg.files = files.filter((f) => f.id !== id); save();
    fs.unlink(classFile(room.cfg.slug, id), () => {});
    return send(res, 200, { files: filesOf(room) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const name = clean(path.basename(String(url.searchParams.get('name') || '')), 100);
  if (!FILE_OK.test(name)) return send(res, 415, { error: 'bad type' });
  if (files.length >= FILES_PER_ROOM) return send(res, 409, { error: 'too many files' });
  const id = crypto.randomBytes(6).toString('hex'), dest = classFile(room.cfg.slug, id);
  receiveFile(req, res, dest, FILE_MAX, () => {
    room.cfg.files.push({ id, name, size: fs.statSync(dest).size, at: Date.now() }); save();
    send(res, 200, { files: filesOf(room) });
  });
}
// The replays and files of a room, with links good for six hours, for those who may come in.
function handleExtras(req, res, url) {
  const room = roomOf(url);
  if (!room) return send(res, 404, { error: 'no such room' });
  if (!mayEnter(req, room)) return send(res, 200, { replays: [], files: [] });
  const slug = room.cfg.slug, dir = path.join(REC_ROOT, `air_${slug}`), key = (kind) => encodeURIComponent(sign(kind, slug, 6 * 3600e3));
  const replays = Object.entries(room.cfg.replays || {}).map(([name, r]) => {
    try { const st = fs.statSync(path.join(dir, name)); return { title: r.title, at: st.mtimeMs, url: `/media/replay/${slug}/${name}?k=${key('replay')}` }; } catch { return null; }
  }).filter(Boolean).sort((x, y) => y.at - x.at);
  send(res, 200, { replays, files: (room.cfg.files || []).map((f) => ({ name: f.name, size: f.size, url: `/media/file/${slug}/${f.id}?k=${key('file')}` })) });
}
function serveReplay(req, res, url, rest) {
  const [slug, name] = rest.split('/'), room = rooms.get(slug);
  if (!room || verify(String(url.searchParams.get('k') || ''), 'replay') !== slug || !REC_NAME.test(name || '') || !(room.cfg.replays || {})[name]) return send(res, 403, 'Forbidden');
  serveRanged(req, res, path.join(REC_ROOT, `air_${slug}`, name), { 'Content-Type': 'video/mp4' });
}
function serveClassFile(req, res, url, rest) {
  const [slug, id] = rest.split('/'), room = rooms.get(slug), f = room && (room.cfg.files || []).find((x) => x.id === id);
  if (!f || verify(String(url.searchParams.get('k') || ''), 'file') !== slug) return send(res, 403, 'Forbidden');
  serveRanged(req, res, classFile(slug, id), { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

// ---------------------------------------------------------- administration --
const publicRoom = (r) => ({ capacity: r.cfg.capacity || 0, slug: r.cfg.slug, title: r.cfg.title, topic: r.cfg.topic, host: ownerName(r), live: r.live, viewers: r.clients.size, liveTitle: r.cfg.liveTitle, locked: !!r.cfg.code, fee: cls.feeOf(r) || undefined, closed: !!r.cfg.closed || undefined, next: nextOf(r), sessions: sessionsOf(r).slice(0, 10) });
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

// A payment was received (noted by the administrator, or collected online): the subscription runs longer.
function addMonths(u, months) {
  u.paidUntil = Math.max(Date.now(), u.paidUntil || 0) + months * 30 * 24 * 3600e3;
  u.active = true;
}
function openIfApproved(u) {                     // first approval: open the room they asked for
  if (!u.active || !u.pending) return;
  u.pending = false;
  const plan = db.plans.find((x) => x.id === u.planId);
  if (u.wantRoom && !db.rooms.some((c) => c.ownerId === u.id) && rooms.size < 200) {
    const cfg = { slug: slugFor(u.wantRoom), title: u.wantRoom, topic: u.wantTopic || '', ownerId: u.id, slow: 3, pinned: '', liveTitle: '', banned: {}, capacity: plan ? plan.capacity : 0 };
    db.rooms.push(cfg); openRoom(cfg);
  }
}
const cls = require('./school')({ db, save, rooms, acct, sign, env, toMods: (room, obj) => toHost(room, obj), ownerName, plannedOf });
const pay = require('./pay')({ db, save, env, grant: (u, months) => { addMonths(u, months); openIfApproved(u); save(); },
  grantEntry: (mid, slug, days) => {               // a student paid the entry of a room
    const m = acct.byId(mid), room = rooms.get(slug);
    if (!m || !room) return null;
    cls.paidFor(room, m, days);
    return { name: m.name, email: m.email, room: room.cfg.title, teacher: ownerName(room) };
  } });
const originOf = (req) => { const h = String(req.headers.host || ''); return /^[a-z0-9.-]+(:\d+)?$/i.test(h) ? `${/^(localhost|127\.)/.test(h) ? 'http' : 'https'}://${h}` : ''; };

async function handleAdmin(req, res, url, what) {
  const me = whoIs(bearer(req));
  if (!me || me.role !== 'admin') return send(res, me ? 403 : 401, { error: 'administrator only' });
  if (originOf(req) && db.origin !== originOf(req)) { db.origin = originOf(req); save(); }     // the site's own address (as the administrator reaches it), for links in the e-mails it sends by itself

  if (!what && req.method === 'GET') {
    return send(res, 200, {
      users: db.users.map((u) => ({ id: u.id, name: u.name, login: u.login, active: u.active, expired: !!u.active && !isActive(u), pending: !!u.pending, contact: u.contact || '', paidUntil: u.paidUntil || 0, planId: u.planId || '', wantRoom: u.wantRoom || '', wantTopic: u.wantTopic || '' })),
      plans: db.plans, payInfo: db.payInfo, legal: db.legal || { owner: '', contact: '' }, uplink: db.uplink || 400, accounts: acct.adminView(), ai: ai.adminView(), backup: bak.adminView(), pay: pay.adminView(), stats: cls.stats(),
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
      if (Number.isInteger(months) && months > 0 && months <= 24) addMonths(u, months);   // payment received: extend the subscription
      openIfApproved(u);
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
    pay.adminSet(b.pay);                                       // online payment: the PayPal keys
    ai.adminSet(b.ai);                                         // the AI assistant: key, model, what it should know
    if (b.ai) for (const r of rooms.values()) toMods(r, { t: 'aichat', ready: ai.inChat(), on: !r.cfg.aiOff });
    const bad = acct.adminSet(b);                              // who must have an account, and the mailbox that sends the codes
    if (bad) return send(res, 400, { error: bad });
    if (Number(b.uplink) >= 20 && Number(b.uplink) <= 100000) db.uplink = Math.round(Number(b.uplink));     // what the server can send, in Mbit/s (measured): the picture's rate is fitted to it
    if (b.legal && typeof b.legal === 'object') db.legal = { owner: clean(b.legal.owner, 120), contact: clean(b.legal.contact, 160) };     // who runs the site, for the legal pages
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
  // backups: download the whole file, choose where a copy is mailed and how often, send one now, put one back
  if (what === 'backup' && req.method === 'GET') {
    return send(res, 200, bak.download(), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="regam-live-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
  }
  if (what === 'backup' && req.method === 'POST') { const bad = bak.adminSet(await readJson(req)); if (bad) return send(res, 400, { error: bad }); save(); return send(res, 200, { ok: true }); }
  if (what === 'backupsend' && req.method === 'POST') { const bad = await bak.sendNow(); save(); return bad ? send(res, 400, { error: bad }) : send(res, 200, { ok: true }); }
  if (what === 'restore' && req.method === 'POST') {
    let text = '';
    try { text = String(await readBody(req, 20 * 1024 * 1024)); } catch { return send(res, 413, { error: 'not a backup' }); }
    const bad = bak.restore(text);
    return bad ? send(res, 400, { error: bad }) : send(res, 200, { ok: true });
  }
  if (what === 'paytest' && req.method === 'POST') { const bad = await pay.adminTest(); return bad ? send(res, 400, { error: bad }) : send(res, 200, { ok: true }); }
  if (what === 'aitest' && req.method === 'POST') { const bad = await ai.adminTest(); return bad ? send(res, 400, { error: bad }) : send(res, 200, { ok: true }); }
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
        rooms: rooms.size, hls: `${HLS_PUBLIC_URL || '/hls'}/air_${room.cfg.slug}/index.m3u8`, locked: !!room.cfg.code, next: nextOf(room), sessions: sessionsOf(room).slice(0, 10), sound: soundUrl(room), sounds: soundList(room), soundOwn: !!room.cfg.sound, pics: picUrls(room),
        access: acct.access(), accounts: acct.mailReady(), assistant: ai.inHelp(),
      });
    }
    if (p === '/api/site') return send(res, 200, { site: SITE_TITLE, access: acct.access(), accounts: acct.mailReady(), assistant: ai.inHelp(), build: BUILD, legal: { owner: (db.legal || {}).owner || '', contact: (db.legal || {}).contact || '' } });
    if (p === '/api/assistant' && req.method === 'POST') {       // the private help bubble
      if (!ai.inHelp()) return send(res, 404, { error: 'off' });
      const ip = clientIp(req), now = Date.now(), hits = (helpHits.get(ip) || []).filter((t) => t > now - 10 * 60e3);
      if (hits.length >= 20) return send(res, 429, { error: 'too many requests' });
      hits.push(now); helpHits.set(ip, hits);
      const b = await readJson(req);
      const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-8)
        .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: clean(m && m.content, 600) })).filter((m) => m.content);
      for (let i = messages.length - 1; i > 0; i--) if (messages[i].role === messages[i - 1].role) { messages[i - 1].content += '\n' + messages[i].content; messages.splice(i, 1); }     // roles must alternate
      while (messages.length && messages[0].role !== 'user') messages.shift();
      if (!messages.length || messages[messages.length - 1].role !== 'user') return send(res, 400, { error: 'empty' });
      try { return send(res, 200, { text: await ai.answerHelp({ site: SITE_TITLE, facts: siteFacts(), messages }) }); }
      catch { return send(res, 502, { error: 'assistant unavailable' }); }
    }
    if (p.startsWith('/api/member/')) return await acct.handle(req, res, p.slice(12));
    if (p === '/api/ics') {                       // a planned session, as a file for the person's own calendar
      const room = roomOf(url), s = room && sessionsOf(room).find((x) => x.id === url.searchParams.get('id'));
      if (!s) return send(res, 404, 'Not found');
      const hostName = String(req.headers['x-forwarded-host'] || req.headers.host || '');
      const origin = /^[a-z0-9.-]+(:\d+)?$/i.test(hostName) ? `${/^(localhost|127\.)/.test(hostName) ? 'http' : 'https'}://${hostName}` : '';
      return send(res, 200, icsOf(room, s, origin), { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="regam-live-${room.cfg.slug}.ics"` });
    }
    if (p === '/api/sound') return handleSound(req, res, url);
    if (p === '/api/pics') return handlePics(req, res, url);
    if (p === '/api/avatar') return handleAvatar(req, res);
    if (p.startsWith('/media/avatar/')) {
      const id = p.slice(14);
      if (!/^[a-z0-9]{6,40}$/.test(id)) return send(res, 404, 'Not found');
      return serveRanged(req, res, avatarFile(id), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    if (p === '/api/files') return handleFiles(req, res, url);
    if (p === '/api/extras') return handleExtras(req, res, url);
    if (p.startsWith('/media/replay/')) return serveReplay(req, res, url, p.slice(14));
    if (p.startsWith('/media/file/')) return serveClassFile(req, res, url, p.slice(12));
    if (p.startsWith('/media/pic/')) return servePic(res, p.slice(11));
    if (p.startsWith('/media/sound/')) return serveSound(req, res, p.slice(13));
    if (p === '/api/pass') {                      // the pass that lets an admitted person's player fetch the stream
      const room = roomOf(url);
      if (!room) return send(res, 404, { error: 'no such room' });
      if (room.cfg.gate && !room.admitted.has(String(url.searchParams.get('uid') || ''))) return send(res, 403, { error: 'not admitted' });
      const who = acct.memberOf(bearer(req));
      if (acct.access() === 'watch' && !who) return send(res, 401, { error: 'sign in' });
      if (cls.entry(room, who)) return send(res, 403, { error: 'not a student' });           // a paid or closed class
      if (!cls.known(room, who) && !codeOk(room, url.searchParams.get('code'))) return send(res, 403, { error: 'bad code' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': `rlp_${room.cfg.slug}=${sign('pass', room.cfg.slug, 6 * 3600e3)}; Path=/hls/; Max-Age=21600; HttpOnly; SameSite=Lax` });
    }
    if (p === '/api/join' && req.method === 'POST') {            // "join with a code": which room does this entry code open?
      const code = String((await readJson(req)).code || '').replace(/\D/g, ''), ip = clientIp(req);
      let room = null, early = 0;
      if (code.length === 6) for (const r of rooms.values()) { if (!r.cfg.code) continue; const st = codeState(r, code); if (st.ok || st.early) { room = r; early = st.early || 0; break; } }
      if (!codeAllowed(ip, !room)) return send(res, 429, { error: 'too many requests' });
      return room ? send(res, 200, { slug: room.cfg.slug, early }) : send(res, 404, { error: 'bad code' });
    }
    if (p === '/api/rooms') return send(res, 200, { site: SITE_TITLE, rooms: [...rooms.values()].map(publicRoom) });
    if (p === '/api/plans') return send(res, 200, { site: SITE_TITLE, plans: db.plans, pay: pay.ready(), months: pay.MONTHS });
    // Online payment of a subscription. The teacher proves who they are with their login and password
    // (their account may be waiting for approval or run out, so they have no studio session).
    if (p === '/api/pay/start' && req.method === 'POST') {
      const ip = clientIp(req);
      if (!loginAllowed(ip)) return send(res, 429, { error: 'too many attempts' });
      const b = await readJson(req);
      const u = db.users.find((x) => x.login === clean(b.login, 30).toLowerCase());
      const got = hashPass(String(b.password || ''), u ? u.salt : 'no-such-user');
      if (!u || !u.hash || !safeEq(got, u.hash)) { loginFailed(ip); return send(res, 401, { error: 'wrong login or password' }); }
      if (!u.active && !u.pending) return send(res, 403, { error: 'account suspended' });
      let out;
      try { out = await pay.start(u, Number(b.months), originOf(req)); } catch (e) { console.error('payment start failed', e.message); out = { error: 'paypal refused' }; }
      return out.error ? send(res, out.error === 'paypal refused' ? 502 : 400, out) : send(res, 200, out);
    }
    if (p === '/api/pay/entry' && req.method === 'POST') {       // a signed-in student pays the entry of a paid room
      const who = acct.memberOf(bearer(req)), room = roomOf(url), fee = room && cls.feeOf(room);
      if (!who) return send(res, 401, { error: 'sign in' });
      if (!fee) return send(res, 400, { error: 'free' });
      let out;
      try { out = await pay.startEntry(who, room, fee, originOf(req)); } catch (e) { console.error('payment start failed', e.message); out = { error: 'paypal refused' }; }
      return out.error ? send(res, out.error === 'paypal refused' ? 502 : 400, out) : send(res, 200, out);
    }
    if (p === '/api/leave') {                    // "no more reminders": the link at the foot of a reminder
      const room = roomOf(url), key = verify(String(url.searchParams.get('k') || ''), 'leave');
      const [slug, mid] = String(key || '').split(':');
      if (!room || slug !== room.cfg.slug || !mid) return send(res, 400, 'Lien invalide.');
      room.cfg.students = (room.cfg.students || []).filter((id) => id !== mid);
      room.cfg.left = [...new Set([...(room.cfg.left || []), mid])].slice(-3000);
      save(); toHost(room, { t: 'class', ...cls.view(room), payReady: pay.ready() });
      return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${SITE_TITLE}</title><body style="font-family:system-ui;background:#0b0b12;color:#fff;padding:40px;text-align:center"><p>Vous ne recevrez plus les rappels de ce cours.</p><p dir="rtl">ما غاديش توصلك التذكيرات ديال هاد الدرس.</p>`, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (p === '/pay/return') {
      const out = await pay.finish(String(url.searchParams.get('token') || '').slice(0, 64));
      if (out.slug) { res.writeHead(302, { Location: `/r/${out.slug}?paid=${out.ok ? '1' : out.pending ? 'wait' : '0'}`, 'Cache-Control': 'no-store' }); return res.end(); }
      const u = out.ok ? db.users.find((x) => x.id === out.uid) : null;
      res.writeHead(302, { Location: u ? `/teach?paid=1&until=${u.paidUntil || 0}` : `/teach?paid=${out.pending ? 'wait' : '0'}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (p === '/pay/cancel') { res.writeHead(302, { Location: '/teach?paid=cancel' }); return res.end(); }
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
      return send(res, 200, { ok: true, payInfo: db.payInfo, plan, pay: pay.ready() });
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
    const a = p.match(/^\/api\/admin(?:\/(user|room|settings|mailtest|member|aitest|paytest|backup|backupsend|restore))?$/);
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
    if (p === '/legal') return serveFile(res, path.join(PUBLIC_DIR, 'legal.html'));
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
const toMods = (room, obj) => { for (const ws of room.clients) if (ws.mod || ws.helper) tx(ws, obj); };
const toHost = (room, obj) => { for (const ws of room.clients) if (ws.mod) tx(ws, obj); };      // the class list carries e-mails: for the host only
// Assistants: members the host chose to help in a room. They can accept or refuse people, bring guests
// up or down, close a microphone, delete comments and ban; nothing else (no broadcast, no settings).
const HELPER_ACTS = new Set(['del', 'ban', 'admit', 'stage', 'unstage', 'mute', 'answered']);
// The poll or quiz in progress, as one person sees it: the counts come once they have voted (or it is closed).
function pollFor(room, ws) {
  const p = room.poll;
  if (!p) return { t: 'poll', off: true };
  const mine = p.votes.get(ws.member || ws.uid), show = ws.mod || ws.helper || !p.open || mine !== undefined;
  const counts = p.opts.map(() => 0);
  for (const i of p.votes.values()) counts[i]++;
  return { t: 'poll', id: p.id, q: p.q, opts: p.opts, open: p.open, mine, total: p.votes.size, counts: show ? counts : undefined, correct: !p.open && p.correct >= 0 ? p.correct : undefined };
}
function tellPoll(room) {                        // at most once a second, however fast the votes come
  if (room.pollTimer) return;
  room.pollTimer = setTimeout(() => { room.pollTimer = null; for (const c of room.clients) tx(c, pollFor(room, c)); }, 800);
}
const askedAt = new Map();                       // person -> when they last put a question
const helpersOf = (room) => (room.cfg.helpers || []).map((id) => acct.byId(id)).filter(Boolean).map((m) => ({ id: m.id, name: m.name, email: m.email }));
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
const handsList = (room) => [...room.hands].map(([uid, h]) => ({ uid, name: h.name, av: h.av, point: h.point })).sort((x, y) => (y.point ? 1 : 0) - (x.point ? 1 : 0)).slice(0, 50);     // points of order first
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
      const helper = !!member && (room.cfg.helpers || []).includes(member.id);
      if (!host && !helper) {                              // a paid class, or one kept for its students
        const why = cls.entry(room, member);
        if (why === 'account') return tx(ws, { t: 'signin', fee: cls.feeOf(room) || undefined, closed: !!room.cfg.closed });
        if (why === 'pay') return tx(ws, { t: 'pay', fee: cls.feeOf(room), ready: pay.ready() });
        if (why === 'closed') return tx(ws, { t: 'closed' });
      }
      if (!host && !helper && room.cfg.code && !cls.known(room, member)) {             // the room has an entry code (students of the class are not asked again)
        const st = codeState(room, d.code);
        if (!codeAllowed(ws.ip, !st.ok && !st.early && !!d.code)) return tx(ws, { t: 'code', wait: true });
        if (!st.ok) return tx(ws, { t: 'code', bad: !!d.code && !st.early, early: st.early });
      }
      if (!host && room.cfg.capacity > 0 && viewersOf(room) >= room.cfg.capacity && !room.byUid.has(String(d.uid))) {
        tx(ws, { t: 'full', capacity: room.cfg.capacity });   // the room's plan is full
        return ws.close();
      }
      if (!host && !helper && room.cfg.gate && !room.admitted.has(String(d.uid))) {      // waiting room: the host lets people in one by one
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
      ws.helper = helper;
      ws.userId = ws.mod ? user.id : null;
      ws.member = member ? member.id : null;
      ws.name = ws.mod ? user.name : member ? member.name : clean(d.name, MAX_NAME);
      ws.color = colorOf(d.color);
      ws.av = avatarOf(member);
      room.clients.add(ws);
      if (member && !host) cls.enroll(room, member);
      // somebody came in: the host and the assistants hear it (once per person, not at every reconnection)
      if (!ws.mod && !ws.helper && !room.byUid.has(ws.uid)) {
        room.seen = room.seen || new Map();
        const now = Date.now();
        if (now - (room.seen.get(ws.uid) || 0) > 5 * 60e3) toMods(room, { t: 'joined', name: ws.name || '' });
        room.seen.set(ws.uid, now);
        if (room.seen.size > 5000) room.seen.clear();
      }
      if (!room.byUid.has(ws.uid)) room.byUid.set(ws.uid, new Set());
      room.byUid.get(ws.uid).add(ws);
      return tx(ws, {
        t: 'init', live: room.live, likes: room.likes, reacts: room.totals, viewers: room.clients.size,
        slow: room.cfg.slow, pinned: room.cfg.pinned, title: room.cfg.liveTitle,
        history: room.history, guests: guestsPublic(room), maxGuests: MAX_GUESTS, mod: ws.mod || ws.helper, helper: ws.helper || undefined, helpers: ws.mod ? helpersOf(room) : undefined, banned: !!room.cfg.banned[ws.uid],
        hands: ws.mod || ws.helper ? handsList(room) : undefined, hand: room.hands.has(ws.uid),
        code: ws.mod ? room.cfg.code || '' : undefined, next: nextOf(room), sessions: ws.mod ? plannedOf(room) : undefined,
        aiChat: ws.mod ? { ready: ai.inChat(), on: !room.cfg.aiOff } : undefined,
        cls: ws.mod ? { ...cls.view(room), payReady: pay.ready() } : undefined, att: ws.mod ? cls.sheets(room) : undefined,
        uplink: ws.mod ? db.uplink || 400 : undefined,
        questions: ws.mod || ws.helper ? room.questions : undefined, poll: room.poll ? pollFor(room, ws) : undefined,
        rec: ws.mod ? !!room.rec : undefined, needPass: passNeeded(room), access: acct.access(), gate: !!room.cfg.gate, waiting: ws.mod || ws.helper ? waitingList(room) : undefined,
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
        const msg = { id: ++room.seq, uid: ws.uid, name: ws.name, text, ts: now, mod: ws.mod || undefined, c: ws.color || undefined, av: ws.av || undefined };
        room.history.push(msg);
        if (room.history.length > HISTORY) room.history.shift();
        broadcast(room, { t: 'msg', m: msg });
        if (!ws.mod && ai.inChat() && !cfg.aiOff && QUESTION.test(text)) aiReply(room, ws, msg);
        return;
      }

      // ---- stage requests (viewer side)
      case 'people': {                     // who is in the room, for the list of participants
        if (Date.now() - (ws.lastWho || 0) < 1500) return;
        ws.lastWho = Date.now();
        const seen = new Map(); let nameless = 0;
        for (const c of room.clients) {
          if (seen.has(c.uid)) continue;
          if (!c.name) { seen.set(c.uid, null); nameless++; continue; }
          const slot = slotOf(room, c.uid), hand = room.hands.get(c.uid);
          seen.set(c.uid, { name: c.name, av: c.av || undefined, role: c.mod ? 'host' : c.helper ? 'helper' : slot ? 'stage' : hand ? (hand.point ? 'point' : 'hand') : undefined });
        }
        const rank = { host: 0, helper: 1, stage: 2, point: 3, hand: 4 };
        const list = [...seen.values()].filter(Boolean).sort((x, y) => (rank[x.role] ?? 9) - (rank[y.role] ?? 9) || x.name.localeCompare(y.name)).slice(0, 600);
        return tx(ws, { t: 'people', list, nameless, total: seen.size });
      }
      case 'ask': {                        // a question for the teacher: it goes to a list of its own, not into the comments
        const text = clean(d.text, 300);
        if (!ws.mod && !ws.member && acct.access() !== 'open') return tx(ws, { t: 'err', code: 'signin' });
        if (!text || !ws.name || cfg.banned[ws.uid]) return;
        const now = Date.now(), who = ws.member || ws.uid;
        if (now - (askedAt.get(who) || 0) < 20e3) return tx(ws, { t: 'asked', wait: true });
        askedAt.set(who, now); if (askedAt.size > 20000) askedAt.clear();
        room.questions.push({ id: 'q' + (++room.seq), name: ws.name, text, at: now });
        if (room.questions.length > 100) room.questions.shift();
        tx(ws, { t: 'asked' });
        return toMods(room, { t: 'questions', list: room.questions });
      }
      case 'vote': {                       // an answer to the poll in progress (it can be changed while the poll is open)
        const p = room.poll, i = Number(d.i);
        if (!p || !p.open || d.id !== p.id || !Number.isInteger(i) || i < 0 || i >= p.opts.length || ws.mod) return;
        if (p.votes.size >= 5000 && !p.votes.has(ws.member || ws.uid)) return;
        p.votes.set(ws.member || ws.uid, i);
        tx(ws, pollFor(room, ws));
        return tellPoll(room);
      }
      case 'hand':
        if (!ws.mod && !ws.member && acct.access() !== 'open') return tx(ws, { t: 'err', code: 'signin' });
        if (!ws.name || cfg.banned[ws.uid] || slotOf(room, ws.uid)) return;
        if (d.on === false) room.hands.delete(ws.uid);
        else if (room.hands.size < 200) room.hands.set(ws.uid, { name: ws.name, ts: Date.now(), av: ws.av || undefined, point: d.point ? true : undefined });   // point: a point of order, heard before the others
        tx(ws, { t: 'hand', on: room.hands.has(ws.uid), point: room.hands.has(ws.uid) && !!d.point });
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

    // ---- moderator actions (the room's host, and for a few of them the assistants)
    if (!ws.mod && !(ws.helper && HELPER_ACTS.has(d.t))) return;
    if (ws.helper && d.t === 'stage' && !room.live) return tx(ws, { t: 'err', code: 'notlive' });
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
        cfg.code = d.on ? newCode(room) : '';
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
          room.capLog = [...(room.capLog || []), words[src]].slice(-15);          // what the host said lately, for the assistant
          tx(ws, { t: 'capinfo', tx: words });
        });
        return;
      }
      case 'session': {                    // the room's calendar: plan a session, or remove one
        const list = plannedOf(room);
        if (d.del) cfg.sessions = list.filter((s) => s.id !== String(d.del));
        else {
          const at = Number(d.at), end = Number(d.end) || 0, now = Date.now();
          if (!(at > now - 3600e3 && at < now + 366 * 24 * 3600e3) || (end && (end <= at || end > at + 24 * 3600e3)) || list.length >= 40) return tx(ws, { t: 'sessions', list, err: 'bad' });
          cfg.sessions = [...list, { id: 's' + crypto.randomBytes(5).toString('hex'), at, end, title: clean(d.title, 80), code: newCode(room) }];
        }
        save();
        broadcast(room, { t: 'next', next: nextOf(room) });
        return toMods(room, { t: 'sessions', list: plannedOf(room) });
      }
      case 'helper': {                     // the host names an assistant (by the e-mail of their account) or removes one
        const list = (cfg.helpers = cfg.helpers || []);
        const m = d.id ? acct.byId(String(d.id)) : acct.find(d.email);
        if (!m) return tx(ws, { t: 'helpers', list: helpersOf(room), err: 'unknown' });
        const on = d.on !== false;
        if (on && !list.includes(m.id) && list.length < 20) list.push(m.id);
        if (!on) cfg.helpers = list.filter((id) => id !== m.id);
        save();
        for (const c of room.clients) if (c.member === m.id) tx(c, { t: 'helper', on });      // their page takes the new role at once
        return toMods(room, { t: 'helpers', list: helpersOf(room) });
      }
      case 'fee': {                        // the class is free, or paid: a price for a month or for one day
        const amount = Math.round(Number(d.amount) * 100) / 100, days = Number(d.days) === 1 ? 1 : 30;
        if (amount > 0 && !pay.ready()) return tx(ws, { t: 'class', ...cls.view(room), payReady: false, err: 'nopay' });
        if (amount > 0 && amount <= 2000) cfg.fee = { amount, days }; else delete cfg.fee;
        save();                                           // people already inside stay; the price is asked at the next entry
        return toHost(room, { t: 'class', ...cls.view(room), payReady: pay.ready() });
      }
      case 'closed': cfg.closed = !!d.on; save(); return toHost(room, { t: 'class', ...cls.view(room), payReady: pay.ready() });
      case 'remind': cfg.remind = d.on !== false; save(); return toHost(room, { t: 'class', ...cls.view(room), payReady: pay.ready() });
      case 'student': {                    // the host adds a student by the e-mail of their account, or removes one
        const m = d.id ? acct.byId(String(d.id)) : acct.find(d.email);
        if (!m) return tx(ws, { t: 'class', ...cls.view(room), payReady: pay.ready(), err: 'unknown' });
        if (d.on === false) { cfg.students = (cfg.students || []).filter((id) => id !== m.id); cfg.left = [...new Set([...(cfg.left || []), m.id])].slice(-3000); }
        else { cfg.left = (cfg.left || []).filter((id) => id !== m.id); cfg.students = [...new Set([...(cfg.students || []), m.id])].slice(0, 3000); }
        save();
        return toHost(room, { t: 'class', ...cls.view(room), payReady: pay.ready() });
      }
      case 'answered':                     // a question was answered (or set aside): off the list
        room.questions = d.all ? [] : room.questions.filter((q) => q.id !== d.id);
        return toMods(room, { t: 'questions', list: room.questions });
      case 'poll': {                       // the host starts a poll (or a quiz, when one answer is marked right), closes it, or takes it away
        if (d.end) { room.poll = null; return broadcast(room, { t: 'poll', off: true }); }
        if (d.close) { if (room.poll) { room.poll.open = false; for (const c of room.clients) tx(c, pollFor(room, c)); } return; }
        const q = clean(d.q, 200), opts = (Array.isArray(d.opts) ? d.opts : []).map((o) => clean(o, 80)).filter(Boolean).slice(0, 6);
        if (!q || opts.length < 2) return tx(ws, { t: 'poll', off: !room.poll, err: 'bad' });
        const correct = Number.isInteger(d.correct) && d.correct >= 0 && d.correct < opts.length ? d.correct : -1;
        room.poll = { id: 'p' + (++room.seq), q, opts, correct, open: true, votes: new Map() };
        for (const c of room.clients) tx(c, pollFor(room, c));
        return;
      }
      case 'aichat':                       // the assistant answers in this room's comments, or stays out of them
        cfg.aiOff = d.on === false; save();
        return toMods(room, { t: 'aichat', ready: ai.inChat(), on: !cfg.aiOff });
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

// When the pages on this server were last changed: shown in the studio, to tell which version is running.
const BUILD = (() => { try { return new Date(Math.max(...fs.readdirSync(PUBLIC_DIR).map((f) => fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs))).toISOString().slice(0, 16).replace('T', ' '); } catch { return ''; } })();

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
// One slow or failed answer must not end a live: a room goes off air only when the media server
// has answered several times in a row without it, or has been unreachable for a while.
let pollFails = 0;
async function pollLive() {
  const onAir = new Set();
  let answered = false;
  try {
    const r = await fetch(`${MTX_API}/v3/paths/list?itemsPerPage=1000`, { headers: { Authorization: MTX_AUTH }, signal: AbortSignal.timeout(4000) });
    if (r.ok) { answered = true; for (const it of (await r.json()).items || []) if (it.available ?? it.ready) onAir.add(it.name); }
  } catch { /* counted below */ }
  pollFails = answered ? 0 : pollFails + 1;
  if (!answered && pollFails < 8) return;                 // no news: keep things as they are for a while
  for (const room of rooms.values()) {
    const seen = onAir.has(`air_${room.cfg.slug}`);
    room.missed = seen ? 0 : (room.missed || 0) + 1;
    const on = seen || (room.live && answered && room.missed < 3);
    if (on === room.live) continue;
    room.live = on;
    if (on) { room.likes = 0; room.totals = zeros(); room.likesDirty = true; }      // a new live starts its reactions from zero
    broadcast(room, { t: 'live', on });
    if (!on) endStage(room, 'ended');
    if (!on && room.rec) setRecording(room, false);                                 // the next live starts without recording
    if (!on && room.cfg.code) { room.cfg.code = newCode(room); save(); toMods(room, { t: 'code', code: room.cfg.code }); }   // the code of an unplanned live is good for that live only
  }
}
let polling = false;
setInterval(() => { if (polling) return; polling = true; pollLive().catch(() => {}).finally(() => { polling = false; }); }, 2000);

server.listen(PORT, LISTEN_HOST, () => {
  console.log(`REGAM Live listening on :${server.address().port}`);
});
