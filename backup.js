// REGAM Live - backups. Everything the site must not lose (teachers, rooms, viewers' accounts, calendar,
// settings) is one file, db.json. This module keeps a copy of it per day on the server, sends a copy by
// e-mail on a schedule (so one exists outside the server), and puts a copy back when asked.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function backup({ db, dataDir, dbFile, freeze, mail, mailReady, siteTitle }) {
  db.backup = db.backup || {};                 // { email, every: 'off' | 'day' | 'week', lastMail, lastError }
  const DIR = path.join(dataDir, 'backups');
  fs.mkdirSync(DIR, { recursive: true });
  const KEEP = 30, DAY = 24 * 3600e3;
  const today = () => new Date().toISOString().slice(0, 10);
  const files = () => fs.readdirSync(DIR).filter((f) => /^db-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();

  // One file per day, rewritten through the day: yesterday's and older ones stay as they were.
  function snapshot() {
    try {
      const f = path.join(DIR, `db-${today()}.json`);
      fs.writeFileSync(f + '.tmp', JSON.stringify(db)); fs.renameSync(f + '.tmp', f);
      for (const old of files().slice(0, -KEEP)) fs.unlinkSync(path.join(DIR, old));
    } catch (e) { console.error('backup failed', e.message); }
  }
  // The copy that travels by e-mail carries no key that opens something else: the mailbox password,
  // the AI key and the PayPal secret are left out (they are typed again after a restore). Passwords of accounts are never stored in clear.
  function portable() {
    const copy = JSON.parse(JSON.stringify(db));
    if (copy.mail) delete copy.mail.pass;
    if (copy.ai) delete copy.ai.key;
    if (copy.pay) delete copy.pay.secret;
    return JSON.stringify(copy);
  }
  async function sendNow() {
    if (!db.backup.email || !mailReady()) return 'bad mail settings';
    try {
      await mail(db.backup.email, `${siteTitle} - sauvegarde ${today()}`,
        `Sauvegarde de ${siteTitle} du ${today()}.\nGardez ce message. Pour remettre les données : Administration > Sauvegarde > Restaurer, avec le fichier joint.\n\n`
        + `Backup of ${siteTitle}, ${today()}. Keep this message. To put the data back: Administration > Backup > Restore, with the attached file.`,
        [{ filename: `regam-live-${today()}.json`, content: portable(), contentType: 'application/json' }]);
      db.backup.lastMail = Date.now(); db.backup.lastError = '';
      return '';
    } catch (e) { db.backup.lastError = String((e && e.message) || e).slice(0, 160); return 'mail failed: ' + db.backup.lastError; }
  }
  let busy = false;
  async function tick() {
    snapshot();
    const every = db.backup.every === 'day' ? DAY : db.backup.every === 'week' ? 7 * DAY : 0;
    if (!every || busy || Date.now() - (db.backup.lastMail || 0) < every - 3600e3) return;
    if (Date.now() - (db.backup.lastTry || 0) < 6 * 3600e3) return;       // a mailbox that refuses is not asked every hour
    busy = true; db.backup.lastTry = Date.now();
    try { await sendNow(); } finally { busy = false; }
  }
  setTimeout(tick, 5000).unref();
  setInterval(tick, 3600e3).unref();

  const adminView = () => {
    const list = files();
    return { email: db.backup.email || '', every: db.backup.every || 'off', lastMail: db.backup.lastMail || 0, lastError: db.backup.lastError || '',
      count: list.length, last: list.length ? list[list.length - 1].slice(3, 13) : '', mailReady: mailReady() };
  };
  function adminSet(b) {
    const email = String(b.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,}$/.test(email)) return 'bad email';
    db.backup.email = email;
    db.backup.every = email && ['day', 'week'].includes(b.every) ? b.every : 'off';
    return '';
  }
  const download = () => JSON.stringify(db);
  // Puts a backup back: checks it looks like one, keeps what is being replaced, writes it, and the server
  // restarts on it (Docker starts it again by itself). Keys missing from a mailed copy are kept from now.
  function restore(text) {
    let next;
    try { next = JSON.parse(text); } catch { return 'not a backup'; }
    if (!next || typeof next !== 'object' || !Array.isArray(next.users) || !Array.isArray(next.rooms) || !next.rooms.length
      || !next.rooms.every((r) => r && typeof r.slug === 'string' && /^[a-z0-9-]+$/.test(r.slug))) return 'not a backup';
    if (next.mail && !next.mail.pass && db.mail && db.mail.pass && next.mail.user === db.mail.user) next.mail.pass = db.mail.pass;
    if (next.ai && !next.ai.key && db.ai && db.ai.key) next.ai.key = db.ai.key;
    if (next.pay && !next.pay.secret && db.pay && db.pay.secret && next.pay.clientId === db.pay.clientId) next.pay.secret = db.pay.secret;
    freeze();                                             // nothing from the running site is written over it
    fs.writeFileSync(path.join(DIR, `before-restore-${Date.now()}.json`), JSON.stringify(db));
    fs.writeFileSync(dbFile + '.tmp', JSON.stringify(next)); fs.renameSync(dbFile + '.tmp', dbFile);
    setTimeout(() => process.exit(0), 500);
    return '';
  }
  return { adminView, adminSet, sendNow, download, restore, snapshot };
};
