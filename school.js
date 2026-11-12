// REGAM Live - what turns a room into a class: its students, a free or paid entry, reminders by e-mail
// before each planned live, and the attendance sheet of each live.
'use strict';

module.exports = function school({ db, save, rooms, acct, sign, env, toMods, ownerName, plannedOf }) {
  const TZ = env.SITE_TZ || 'Africa/Casablanca';
  const now = () => Date.now();
  const feeOf = (room) => (room.cfg.fee && room.cfg.fee.amount > 0 ? room.cfg.fee : null);
  const isStudent = (room, m) => !!m && (room.cfg.students || []).includes(m.id);
  const hasPaid = (room, m) => !!m && ((room.cfg.paid || {})[m.id] || 0) > now();
  // May this person come in? '' yes; 'account' (a paid or closed room needs an account); 'pay'; 'closed'.
  function entry(room, m) {
    const fee = feeOf(room);
    if (!fee && !room.cfg.closed) return '';
    if (!m) return 'account';
    if (fee) return hasPaid(room, m) ? '' : 'pay';
    return isStudent(room, m) ? '' : 'closed';
  }
  const known = (room, m) => isStudent(room, m) || hasPaid(room, m);      // the room's code is not asked again
  function enroll(room, m) {                       // whoever comes in with an account is on the class list
    const list = (room.cfg.students = room.cfg.students || []);
    if (!m || list.includes(m.id) || list.length >= 3000 || (room.cfg.left || []).includes(m.id)) return;
    list.push(m.id); save();
    toMods(room, { t: 'class', ...view(room) });
  }
  function paidFor(room, m, days) {
    room.cfg.paid = room.cfg.paid || {};
    room.cfg.paid[m.id] = Math.max(now(), room.cfg.paid[m.id] || 0) + days * 24 * 3600e3;
    room.cfg.left = (room.cfg.left || []).filter((id) => id !== m.id);
    enroll(room, m);
    save();
    toMods(room, { t: 'class', ...view(room) });
  }
  function view(room) {
    const fee = feeOf(room), paid = room.cfg.paid || {};
    return { fee: fee ? { amount: fee.amount, days: fee.days } : null, closed: !!room.cfg.closed, remind: room.cfg.remind !== false,
      students: (room.cfg.students || []).map((id) => acct.byId(id)).filter(Boolean).map((m) => ({ id: m.id, name: m.name, email: m.email, paid: paid[m.id] > now() ? paid[m.id] : 0 })) };
  }

  // ---- reminders: the day before and one hour before each planned live, to the class list
  const when = (ms, lang) => new Date(ms).toLocaleString(lang, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  async function remind(room, s, soon) {
    const origin = db.origin;
    if (!origin || !acct.mailReady()) return;
    const url = `${origin}/r/${room.cfg.slug}${room.cfg.code && s.code ? '?code=' + s.code : ''}`;
    const title = room.cfg.title + (s.title ? ' - ' + s.title : '');
    const people = (room.cfg.students || []).map((id) => acct.byId(id)).filter((m) => m && m.verified).slice(0, 500);
    for (const m of people) {
      const leave = `${origin}/api/leave?room=${room.cfg.slug}&k=${encodeURIComponent(sign('leave', room.cfg.slug + ':' + m.id, 90 * 24 * 3600e3))}`;
      const text = [
        `Bonjour ${m.name},`, '',
        `${soon ? 'Votre cours commence dans une heure' : 'Rappel : votre cours a lieu bientôt'} : ${title}`,
        `Professeur : ${ownerName(room)}`,
        `Date : ${when(s.at, 'fr-FR')} (heure du Maroc)`,
        `Lien : ${url}`,
        room.cfg.code && s.code ? `Code d'entrée : ${s.code.slice(0, 3)} ${s.code.slice(3)}` : null,
        '', `تذكير: ${title}`, `الوقت: ${when(s.at, 'ar-MA')} (توقيت المغرب)`, `الرابط: ${url}`,
        '', `Pour ne plus recevoir les rappels de ce cours : ${leave}`,
      ].filter((l) => l !== null).join('\n');
      try { await acct.mail(m.email, `${soon ? 'Dans une heure' : 'Rappel'} : ${title}`, text); } catch (e) { console.error('reminder failed', e.message); }
    }
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const t = now();
      for (const room of rooms.values()) {
        if (room.cfg.remind === false || !(room.cfg.students || []).length) continue;
        for (const s of plannedOf(room)) {
          if (!s.r24 && t >= s.at - 24 * 3600e3 && t < s.at - 2 * 3600e3) { s.r24 = true; save(); await remind(room, s, false); }
          else if (!s.r1 && t >= s.at - 3600e3 && t < s.at) { s.r1 = true; s.r24 = true; save(); await remind(room, s, true); }
        }
      }
    } finally { busy = false; }
  }
  setInterval(() => tick().catch(() => {}), Number(env.REMIND_EVERY_MS) || 60e3).unref();

  // ---- attendance: who was in the room during each live, and for how long
  const STEP = Number(env.ATT_STEP_MS) || 10e3;
  setInterval(() => {
    for (const room of rooms.values()) {
      if (!room.live) { if (room.att) closeSheet(room); continue; }
      if (!room.att) room.att = { at: now(), rows: new Map() };
      const seen = new Set();
      for (const ws of room.clients) {
        if (ws.mod) continue;
        const key = ws.member || ws.uid;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = ws.member ? acct.byId(ws.member) : null;
        const row = room.att.rows.get(key) || { name: '', email: '', first: now(), secs: 0 };
        row.name = (m ? m.name : ws.name) || row.name; row.email = m ? m.email : '';
        row.secs += STEP / 1000;
        if (room.att.rows.size < 3000) room.att.rows.set(key, row);
      }
    }
  }, STEP).unref();
  function closeSheet(room) {
    const sheet = room.att; room.att = null;
    if (!sheet || !sheet.rows.size) return;
    const s = plannedOf(room).find((x) => sheet.at >= x.at - 30 * 60e3 && sheet.at < (x.end || x.at + 3 * 3600e3));
    room.cfg.att = [{ at: sheet.at, end: now(), title: room.cfg.liveTitle || (s && s.title) || '', rows: [...sheet.rows.values()].filter((r) => r.name || r.email).sort((a, b) => a.first - b.first) }, ...(room.cfg.att || [])].slice(0, 20);
    save();
    toMods(room, { t: 'att', list: sheets(room) });
  }
  const sheets = (room) => (room.cfg.att || []).map((a) => ({ at: a.at, end: a.end, title: a.title, rows: a.rows }));

  return { feeOf, entry, known, enroll, paidFor, view, sheets, tick, isStudent, hasPaid };
};
