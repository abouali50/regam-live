// REGAM Live - shared client code: connection, chat panel, WebRTC helpers.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid);
  return n;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
function myUid() {
  let id = store.get('regam.uid');
  if (!/^[a-z0-9]{12,40}$/.test(id || '')) {
    id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => (b % 36).toString(36)).join('');
    store.set('regam.uid', id);
  }
  return id;
}

// ---------------------------------------------------------------- socket --
// One WebSocket with automatic reconnect. on(type, fn) to listen.
function createLink({ name = '', token = '' } = {}) {
  const handlers = {};
  const link = {
    uid: myUid(), name, token, ws: null, ready: false,
    on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return link; },
    send(obj) { if (link.ws && link.ws.readyState === 1) link.ws.send(JSON.stringify(obj)); },
    setName(n) { link.name = n; store.set('regam.name', n); link.send({ t: 'name', name: n }); },
  };
  const emit = (ev) => (handlers[ev.t] || []).forEach((fn) => fn(ev));
  let delay = 1000;
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    link.ws = ws;
    ws.onopen = () => { delay = 1000; ws.send(JSON.stringify({ t: 'hello', uid: link.uid, name: link.name, token: link.token })); };
    ws.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === 'batch') d.ev.forEach(emit);
      else { if (d.t === 'init') link.ready = true; emit(d); }
    };
    ws.onclose = () => {
      link.ready = false; emit({ t: 'offline' });
      setTimeout(connect, delay + Math.random() * 500);
      delay = Math.min(delay * 2, 15000);
    };
  }
  connect();
  return link;
}

// ------------------------------------------------------------------ chat --
function mountChat(root, link, { askName } = {}) {
  let mod = false, banned = false;
  const pinned = el('div', { class: 'pinned', hidden: true });
  const list = el('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  const more = el('button', { class: 'more', hidden: true, type: 'button', onclick: () => { stick = true; scroll(); } }, 'رسائل جديدة ↓');
  const note = el('div', { class: 'note', hidden: true });
  const input = el('input', { type: 'text', maxlength: 300, placeholder: 'اكتب تعليق…', autocomplete: 'off', enterkeyhint: 'send', 'aria-label': 'تعليق' });
  const form = el('form', { class: 'composer', onsubmit: submit }, input, el('button', { type: 'submit', class: 'btn primary' }, 'إرسال'));
  root.append(el('div', { class: 'chat-head' }, 'التعليقات'), pinned, el('div', { class: 'msgs-wrap' }, list, more), note, form);

  let stick = true, noteTimer = null;
  list.addEventListener('scroll', () => {
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (stick) more.hidden = true;
  });
  function scroll() { list.scrollTop = list.scrollHeight; more.hidden = true; }
  function say(text, ms = 4000) {
    note.textContent = text; note.hidden = false;
    clearTimeout(noteTimer);
    if (ms) noteTimer = setTimeout(() => { note.hidden = true; }, ms);
  }

  function row(m) {
    const r = el('div', { class: 'msg' + (m.mod ? ' host' : '') + (m.uid === link.uid ? ' mine' : ''), 'data-id': m.id, 'data-uid': m.uid },
      el('span', { class: 'who' }, m.name), el('span', { class: 'txt' }, m.text));
    if (mod && !m.mod) {
      r.append(el('span', { class: 'tools' },
        el('button', { type: 'button', title: 'حذف التعليق', onclick: () => link.send({ t: 'del', id: m.id }) }, 'حذف'),
        el('button', { type: 'button', title: 'حظر صاحب التعليق', onclick: () => { if (confirm(`تحظر "${m.name}"؟ ما غاديش يبقى يقدر يكتب.`)) link.send({ t: 'ban', uid: m.uid }); } }, 'حظر')));
    }
    return r;
  }
  function add(m) {
    list.append(row(m));
    while (list.childElementCount > 300) list.firstElementChild.remove();
    if (stick) scroll(); else more.hidden = false;
  }

  async function submit(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (banned) return say('تم حظرك من التعليق فهاد اللايف.');
    if (!link.name && askName) { const n = await askName(); if (!n) return; }
    if (!link.ready) return say('الاتصال مقطوع، كنعاود نتصل…');
    link.send({ t: 'msg', text });
    input.value = '';
  }

  link.on('init', (d) => {
    mod = d.mod; banned = d.banned;
    list.replaceChildren(...d.history.map(row));
    pinned.textContent = d.pinned; pinned.hidden = !d.pinned;
    note.hidden = true; stick = true; scroll();
  })
    .on('msg', (d) => add(d.m))
    .on('del', (d) => { const n = list.querySelector(`[data-id="${d.id}"]`); if (n) n.remove(); })
    .on('purge', (d) => list.querySelectorAll(`[data-uid="${d.uid}"]`).forEach((n) => n.remove()))
    .on('pin', (d) => { pinned.textContent = d.text; pinned.hidden = !d.text; })
    .on('banned', (d) => { banned = d.on; if (d.on) say('تم حظرك من التعليق فهاد اللايف.', 0); })
    .on('err', (d) => {
      if (d.code === 'slow') say(`تسنى ${d.wait} ثواني قبل التعليق الجاي.`);
      if (d.code === 'banned') say('تم حظرك من التعليق فهاد اللايف.', 0);
    })
    .on('offline', () => say('الاتصال مقطوع، كنعاود نتصل…', 0));
  return { say, focus: () => input.focus() };
}

// ---------------------------------------------------------------- webrtc --
function iceGathered(pc, timeout = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeout);
  });
}
// Sends our offer to the server (WHIP = publish, WHEP = watch) and applies the answer.
async function rtcNegotiate(pc, kind, path, token) {
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);
  const r = await fetch(`/api/rtc/${kind}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: 'Bearer ' + token }, body: pc.localDescription.sdp,
  });
  if (r.status !== 201) { const e = new Error(`rtc ${kind}/${path} -> ${r.status}`); e.status = r.status; throw e; }
  await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
}
function rtcClose(pc, kind, path, token) {
  if (pc) pc.close();
  fetch(`/api/rtc/${kind}/${path}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, keepalive: true }).catch(() => {});
}
// Put H.264 first when the browser offers it (plays everywhere, cheap to relay).
function preferH264(transceiver) {
  try {
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps || !transceiver.setCodecPreferences) return;
    const h264 = caps.codecs.filter((c) => /h264/i.test(c.mimeType));
    if (h264.length) transceiver.setCodecPreferences([...h264, ...caps.codecs.filter((c) => !/h264/i.test(c.mimeType))]);
  } catch { /* keep browser defaults */ }
}
// Watch a path in real time. Retries while the publisher is not there yet.
async function rtcWatch(path, token, { video = true, audio = true, tries = 8 } = {}) {
  for (let i = 0; ; i++) {
    const pc = new RTCPeerConnection();
    if (video) pc.addTransceiver('video', { direction: 'recvonly' });
    if (audio) pc.addTransceiver('audio', { direction: 'recvonly' });
    const stream = new MediaStream();
    pc.ontrack = (e) => stream.addTrack(e.track);
    try { await rtcNegotiate(pc, 'whep', path, token); return { pc, stream }; }
    catch (e) {
      pc.close();
      if (i >= tries - 1 || (e.status && e.status !== 404 && e.status !== 502)) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}
