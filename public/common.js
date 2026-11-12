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
// On phones, a field focused by the page itself (not by a tap) gets no keyboard, and on iPhone a tap
// on it afterwards may not bring the keyboard either. So fields are only focused for mouse users.
const TOUCH = matchMedia('(pointer: coarse)').matches;
const focusSoon = (node) => { if (!TOUCH) setTimeout(() => node.focus(), 0); };
// --------------------------------------------------------------- account --
// A viewer's account: name, e-mail and password, opened with a code sent by e-mail.
const account = {
  get token() { return store.get('regam.member') || ''; },
  get name() { return store.get('regam.memberName') || ''; },
  set(token, name) { store.set('regam.member', token); store.set('regam.memberName', name); store.set('regam.name', name); },
  clear() { try { localStorage.removeItem('regam.member'); localStorage.removeItem('regam.memberName'); } catch { /* private mode */ } },
};
const ACCOUNT_ERR = {
  'bad name or email': 'كتب الاسم ديالك وإيميل صحيح.', 'password too short': 'كلمة السر خاصها 8 حروف ولا أكثر.',
  'email already used': 'هاد الإيميل عندو حساب. دخل بكلمة السر ديالك.', 'bad code': 'الكود غالط ولا سالا الوقت ديالو. طلب كود جديد.',
  'bad login': 'الإيميل ولا كلمة السر غالطين.', 'too many requests': 'محاولات بزاف. تسنى شوية وعاود.',
  'mail failed': 'ما قدرناش نصيفطو الإيميل. تأكد من العنوان وعاود.', 'mail not set up': 'التسجيل مازال ما مفعلش فهاد الموقع.',
};
// Opens the sign-in / sign-up window. view: 'login' or 'signup'. The page reloads once signed in.
function openAccount(view = 'login') {
  let dlg = document.getElementById('accountDlg');
  if (dlg) dlg.remove();
  const err = el('p', { class: 'err', hidden: true }), note = el('p', { class: 'muted' });
  const field = (label, props) => { const i = el('input', props); return { i, row: el('label', { class: 'acc-field' }, label, i) }; };
  const name = field(T('الاسم (كيبان للناس)'), { type: 'text', maxlength: 24, autocomplete: 'name' });
  const email = field(T('الإيميل'), { type: 'email', maxlength: 120, autocomplete: 'email', dir: 'ltr', inputmode: 'email', autocapitalize: 'off' });
  const pass = field(T('كلمة السر'), { type: 'password', minlength: 8, maxlength: 200, dir: 'ltr' });
  const code = field(T('الكود اللي وصلك فالإيميل'), { type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', dir: 'ltr', class: 'acc-code' });
  const submit = el('button', { class: 'btn primary', type: 'submit' });
  const links = el('p', { class: 'acc-links' });
  const title = el('h2', {});
  const form = el('form', { class: 'acc-form' }, title, note, name.row, email.row, pass.row, code.row, err, el('div', { class: 'dlg-actions' }, submit, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('إلغاء'))), links);
  dlg = el('dialog', { id: 'accountDlg', class: 'dlg' }, form);
  document.body.append(dlg);
  const linkTo = (text, v) => el('button', { class: 'acc-link', type: 'button', onclick: () => show(v) }, text);
  const post = async (what, body) => {
    const r = await fetch('/api/member/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang: LANG }) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  };
  const fail = (r) => { err.hidden = false; err.textContent = T(ACCOUNT_ERR[r.data.error] || 'ما قدرناش نديرو هاد العملية. عاود من بعد شوية.'); };
  const done = (r) => { account.set(r.data.token, r.data.name); location.reload(); };
  let mode = view;
  function show(v, text = '') {
    mode = v; err.hidden = true; note.textContent = text; note.hidden = !text;
    title.textContent = T({ login: 'الدخول', signup: 'إنشاء حساب', code: 'فعل الحساب ديالك', forgot: 'نسيتي كلمة السر؟', reset: 'كلمة سر جديدة' }[v]);
    submit.textContent = T({ login: 'دخل للحساب', signup: 'صيفط ليا الكود', code: 'فعل الحساب', forgot: 'صيفط ليا الكود', reset: 'بدل كلمة السر ودخل' }[v]);
    name.row.hidden = v !== 'signup';
    email.row.hidden = v === 'code' || v === 'reset';
    pass.row.hidden = v === 'code' || v === 'forgot';
    code.row.hidden = v !== 'code' && v !== 'reset';
    pass.i.autocomplete = v === 'login' ? 'current-password' : 'new-password';
    name.i.required = v === 'signup'; email.i.required = !email.row.hidden; pass.i.required = !pass.row.hidden; code.i.required = !code.row.hidden;
    links.replaceChildren(...(v === 'login' ? [linkTo(T('ما عنديش حساب: نسجل'), 'signup'), linkTo(T('نسيت كلمة السر'), 'forgot')]
      : v === 'signup' ? [linkTo(T('عندي حساب: ندخل'), 'login')]
        : v === 'code' ? [el('button', { class: 'acc-link', type: 'button', onclick: async () => { const r = await post('login', { email: email.i.value, password: pass.i.value }); if (r.data.error === 'unverified') show('code', T('صيفطنا ليك كود جديد. شوف الإيميل ديالك (وحتى Spam).')); else fail(r); } }, T('صيفط كود جديد'))]
          : [linkTo(T('رجع للدخول'), 'login')]));
    focusSoon(v === 'signup' ? name.i : v === 'code' || v === 'reset' ? code.i : email.i);
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true; err.hidden = true;
    try {
      const em = email.i.value.trim();
      if (mode === 'signup') {
        const r = await post('signup', { name: name.i.value, email: em, password: pass.i.value });
        if (r.ok) show('code', T('صيفطنا كود ل {email}. شوف الإيميل ديالك (وحتى Spam) وكتب الكود هنا.', { email: em })); else fail(r);
      } else if (mode === 'code') {
        const r = await post('verify', { email: em, code: code.i.value });
        if (r.ok) done(r); else fail(r);
      } else if (mode === 'login') {
        const r = await post('login', { email: em, password: pass.i.value });
        if (r.ok) done(r);
        else if (r.data.error === 'unverified') show('code', T('الحساب ديالك مازال ما تفعلش. صيفطنا ليك كود جديد فالإيميل.'));
        else fail(r);
      } else if (mode === 'forgot') {
        await post('forgot', { email: em });
        pass.i.value = '';
        show('reset', T('إلا كان هاد الإيميل عندو حساب، راه وصلو كود. كتب الكود وكلمة السر الجديدة.'));
      } else if (mode === 'reset') {
        const r = await post('reset', { email: em, code: code.i.value, password: pass.i.value });
        if (r.ok) done(r); else fail(r);
      }
    } catch { fail({ data: {} }); }
    submit.disabled = false;
  };
  addPasswordEyes(dlg);
  show(view);
  dlg.showModal();
  if (TOUCH && document.activeElement && dlg.contains(document.activeElement)) document.activeElement.blur();
}
// The link in the e-mail (…?e=<address>&v=<code>) validates the account in one tap.
(async function verifyByLink() {
  const q = new URLSearchParams(location.search), e = q.get('e'), v = q.get('v');
  if (!e || !v) return;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/api/member/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, code: v }) });
    if (r.ok) { const d = await r.json(); account.set(d.token, d.name); location.reload(); return; }
  } catch { /* fall through to the notice */ }
  if (!account.token) alert(T('هاد الرابط ما بقاش صالح. دخل بالإيميل وكلمة السر ديالك، ولا طلب كود جديد.'));
})();
// The help assistant: a bubble in the corner; the visitor asks, the site's AI answers in private.
function mountAssistant() {
  if (document.getElementById('aiBubble')) return;
  const log = el('div', { class: 'ai-log', role: 'log', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', maxlength: 500, placeholder: T('كتب السؤال ديالك…'), 'aria-label': T('كتب السؤال ديالك…'), autocomplete: 'off' });
  const sendBtn = el('button', { class: 'btn primary', type: 'submit' }, T('إرسال'));
  const form = el('form', { class: 'ai-form' }, input, sendBtn);
  const panel = el('div', { class: 'ai-panel', hidden: true, role: 'dialog', 'aria-label': T('المساعد الذكي') },
    el('div', { class: 'ai-head' }, el('strong', {}, '🤖 ' + T('المساعد الذكي')), el('button', { class: 'ai-x', type: 'button', 'aria-label': T('إغلاق'), onclick: () => toggle(false) }, '✕')), log, form);
  const bubble = el('button', { id: 'aiBubble', class: 'ai-bubble', type: 'button', 'aria-expanded': 'false', 'aria-label': T('المساعد الذكي'), title: T('المساعد الذكي') }, '🤖');
  document.body.append(panel, bubble);
  const history = [];
  const say = (role, text) => { const b = el('p', { class: 'ai-msg ' + role, dir: 'auto' }, text); log.append(b); log.scrollTop = log.scrollHeight; return b; };
  function toggle(on) {
    panel.hidden = !on; bubble.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on && !log.children.length) say('assistant', T('مرحبا. أنا المساعد ديال الموقع. سولني على التسجيل، الدخول للقاعة، كود الدخول ولا مواعيد اللايفات.'));
    if (on) focusSoon(input);
  }
  bubble.onclick = () => toggle(panel.hidden);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || sendBtn.disabled) return;
    input.value = ''; say('user', q); history.push({ role: 'user', content: q });
    sendBtn.disabled = true;
    const wait = say('assistant wait', '…');
    try {
      const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-8) }) });
      if (!r.ok) throw new Error(r.status);
      const text = (await r.json()).text || '';
      wait.textContent = text; wait.classList.remove('wait'); history.push({ role: 'assistant', content: text });
    } catch (err) {
      wait.textContent = T(String(err.message) === '429' ? 'سولتي بزاف فوقت قصير. تسنى شوية وعاود.' : 'المساعد ما متوفرش دابا. عاود من بعد شوية.'); wait.classList.add('err');
      history.pop();
    }
    sendBtn.disabled = false; log.scrollTop = log.scrollHeight;
  };
}
// The account corner of the page header: "sign in / sign up", or the person's name and "sign out".
async function mountAccount(host, site) {
  if (account.token) {
    const r = await fetch('/api/member/me', { headers: { Authorization: 'Bearer ' + account.token } }).catch(() => null);
    if (r && r.status === 401) { account.clear(); location.reload(); return; }     // the account was removed, or the session ended
  }
  if (!account.token && !(site && site.accounts)) return;
  const box = el('span', { class: 'acc-box' });
  if (account.token) box.append(el('span', { class: 'acc-name' }, account.name), el('button', { class: 'btn small', type: 'button', onclick: () => { account.clear(); location.reload(); } }, T('خروج')));
  else box.append(el('button', { class: 'btn small', type: 'button', onclick: () => openAccount('login') }, T('دخول')), el('button', { class: 'btn small primary', type: 'button', onclick: () => openAccount('signup') }, T('تسجيل')));
  host.append(box);
}

function createLink({ name = '', token = '', room = '' } = {}) {
  const handlers = {};
  const link = {
    uid: myUid(), name, token, ws: null, ready: false,
    on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return link; },
    send(obj) { if (link.ws && link.ws.readyState === 1) link.ws.send(JSON.stringify(obj)); },
    code: '',
    hello() { link.send({ t: 'hello', uid: link.uid, name: link.name, token: link.token, mt: account.token, code: link.code, room, color: Number(store.get('regam.color')) || 0 }); },
    setName(n) { link.name = n; store.set('regam.name', n); link.send({ t: 'name', name: n }); },
  };
  const emit = (ev) => (handlers[ev.t] || []).forEach((fn) => fn(ev));
  let delay = 1000;
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    link.ws = ws;
    ws.onopen = () => { delay = 1000; link.hello(); };
    ws.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === 'batch') d.ev.forEach(emit);
      else {
        if (d.t === 'init') { link.ready = true; link.door = ''; }
        if (['wait', 'signin', 'code', 'refused'].includes(d.t)) link.door = d.t;       // at the door, not in the room yet
        if (d.t === 'full') delay = 30000;          // the room is full: try again later, not at once
        emit(d);
      }
    };
    ws.onclose = () => {
      link.ready = false; emit({ t: 'offline' });
      setTimeout(connect, delay + Math.random() * 500);
      delay = Math.min(delay * 2, Math.max(delay, 15000));
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
  const more = el('button', { class: 'more', hidden: true, type: 'button', onclick: () => { stick = true; scroll(); } }, T('رسائل جديدة ↓'));
  const note = el('div', { class: 'note', hidden: true });
  const input = el('input', { type: 'text', maxlength: 300, placeholder: T('اكتب تعليق…'), autocomplete: 'off', enterkeyhint: 'send', 'aria-label': T('تعليق') });
  // each person may pick the colour of their own comments
  let myColor = Number(store.get('regam.color')) || 0;
  const swatches = el('div', { class: 'swatches', hidden: true, role: 'group', 'aria-label': T('لون الكتابة') });
  const colorBtn = el('button', { type: 'button', class: 'color-btn c' + myColor, title: T('لون الكتابة'), 'aria-label': T('لون الكتابة'), 'aria-expanded': 'false',
    onclick: () => { swatches.hidden = !swatches.hidden; colorBtn.setAttribute('aria-expanded', String(!swatches.hidden)); } });
  for (let c = 0; c < 9; c++) {
    swatches.append(el('button', { type: 'button', class: 'swatch c' + c, 'aria-label': `${T('لون الكتابة')} ${c + 1}`, 'aria-pressed': String(c === myColor), onclick: () => {
      myColor = c; store.set('regam.color', String(c));
      link.send({ t: 'color', c });
      colorBtn.className = 'color-btn c' + c;
      swatches.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-pressed', String(i === c)));
      swatches.hidden = true; colorBtn.setAttribute('aria-expanded', 'false');
      input.focus();
    } }));
  }
  // dictation: speak instead of typing (where the browser can do it)
  let spoken = '';
  const voice = makeDictation((fin, interim) => { if (fin) spoken += fin.trim() + ' '; input.value = (spoken + interim).slice(0, 300); },
    (on) => { micBtn.setAttribute('aria-pressed', String(on)); if (on) spoken = input.value ? input.value.trim() + ' ' : ''; else input.focus(); });
  const micBtn = el('button', { type: 'button', class: 'mic-btn', hidden: !voice, title: T('الكتابة بالصوت'), 'aria-label': T('الكتابة بالصوت'), 'aria-pressed': 'false', onclick: () => voice && voice.toggle() });
  micBtn.innerHTML = MIC_ICON;
  const form = el('form', { class: 'composer', onsubmit: submit }, colorBtn, input, micBtn, el('button', { type: 'submit', class: 'btn primary' }, T('إرسال')));
  // The panel folds away so the picture keeps the room; a counter shows what arrived meanwhile.
  const unread = el('span', { class: 'chat-unread', hidden: true }, '0');
  const head = el('button', { class: 'chat-head', type: 'button', 'aria-expanded': 'false', onclick: () => setOpen(root.classList.contains('collapsed')) },
    el('span', {}, T('التعليقات')), unread, el('span', { class: 'chat-chevron', 'aria-hidden': 'true' }));
  root.append(head, pinned, el('div', { class: 'msgs-wrap' }, list, more), note, swatches, form);
  let missed = 0;
  function setOpen(open) {
    root.classList.toggle('collapsed', !open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    store.set('regam.chat', open ? 'open' : 'closed');
    if (open) { missed = 0; unread.hidden = true; stick = true; requestAnimationFrame(scroll); }
  }

  let stick = true, noteTimer = null;
  list.addEventListener('scroll', () => {
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (stick) more.hidden = true;
  });
  function scroll() { list.scrollTop = list.scrollHeight; more.hidden = true; }
  function say(text, ms = 4000) {
    if (root.classList.contains('collapsed') && ms !== 0) setOpen(true);   // a message for this person: show it
    note.textContent = text; note.hidden = false;
    clearTimeout(noteTimer);
    if (ms) noteTimer = setTimeout(() => { note.hidden = true; }, ms);
  }

  function row(m) {
    const r = el('div', { class: 'msg' + (m.mod ? ' host' : '') + (m.ai ? ' ai' : '') + (m.uid === link.uid ? ' mine' : ''), 'data-id': m.id, 'data-uid': m.uid },
      el('span', { class: 'who' }, m.ai ? '🤖 ' + T('المساعد الذكي') : m.name), ' ', el('span', { class: 'txt' + (m.c ? ' c' + m.c : '') }, m.text));
    if (mod && !m.mod) {
      r.append(el('span', { class: 'tools' },
        el('button', { type: 'button', title: T('حذف التعليق'), onclick: () => link.send({ t: 'del', id: m.id }) }, T('حذف')),
        el('button', { type: 'button', title: T('حظر صاحب التعليق'), onclick: () => { if (confirm(T('تحظر "{name}"؟ ما غاديش يبقى يقدر يكتب.', { name: m.name }))) link.send({ t: 'ban', uid: m.uid }); } }, T('حظر'))));
    }
    return r;
  }
  function add(m) {
    list.append(row(m));
    while (list.childElementCount > 300) list.firstElementChild.remove();
    if (stick) scroll(); else more.hidden = false;
    if (root.classList.contains('collapsed')) { missed++; unread.textContent = missed > 99 ? '99+' : String(missed); unread.hidden = false; }
  }

  async function submit(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (banned) return say(T('تم حظرك من التعليق فهاد اللايف.'));
    if (!link.name && askName) { const n = await askName(); if (!n) return; }
    if (link.door) return say(T('تقدر تعلق ملي تدخل للقاعة.'));
    if (!link.ready) return say(T('الاتصال مقطوع، كنعاود نتصل…'));
    if (voice) voice.stop();
    link.send({ t: 'msg', text });
    input.value = ''; spoken = '';
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
    .on('banned', (d) => { banned = d.on; if (d.on) say(T('تم حظرك من التعليق فهاد اللايف.'), 0); })
    .on('err', (d) => {
      if (d.code === 'slow') say(T('تسنى {n} ثواني قبل التعليق الجاي.', { n: d.wait }));
      if (d.code === 'banned') say(T('تم حظرك من التعليق فهاد اللايف.'), 0);
    })
    .on('offline', () => say(T('الاتصال مقطوع، كنعاود نتصل…'), 0));
  setOpen(store.get('regam.chat') === 'open');          // folded unless the person opened it before
  return { say, focus: () => input.focus(), open: () => setOpen(true) };
}

// ------------------------------------------------------------- dictation --
// Speech to text, provided by the browser (Chrome, Edge, Safari). Returns null
// where it does not exist, so the buttons can stay hidden.
const MIC_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
function makeDictation(onText, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let rec = null, on = false;
  function start() {
    rec = new SR();
    rec.lang = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-US' }[LANG] || 'ar-MA';
    rec.interimResults = true; rec.continuous = true;
    rec.onresult = (e) => {
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
      onText(fin, interim);
    };
    rec.onend = () => { on = false; onState(false); };
    rec.onerror = () => {};                    // "onend" follows and resets the button
    try { rec.start(); on = true; onState(true); } catch { on = false; onState(false); }
  }
  return { toggle() { if (on) rec.stop(); else start(); }, stop() { if (on) rec.stop(); }, get on() { return on; } };
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
// A step that never answers is turned into an error after a while, so nothing stays stuck.
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, no) => setTimeout(() => { const e = new Error(what + ' timeout'); e.name = 'Timeout'; no(e); }, ms))]);
async function rtcNegotiate(pc, kind, path, token) {
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);
  const r = await fetch(`/api/rtc/${kind}/${path}?room=${encodeURIComponent(window.REGAM_ROOM || '')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: 'Bearer ' + token }, body: pc.localDescription.sdp,
  });
  if (r.status !== 201) { const e = new Error(`rtc ${kind}/${path} -> ${r.status}`); e.status = r.status; throw e; }
  await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
}
function rtcClose(pc, kind, path, token) {
  if (pc) pc.close();
  fetch(`/api/rtc/${kind}/${path}?room=${encodeURIComponent(window.REGAM_ROOM || '')}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, keepalive: true }).catch(() => {});
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

// ------------------------------------------------------------- reactions --
// One row of reactions with a counter under each, plus the emoji floating over
// the video. Viewers can tap them (canSend); the studio only watches.
const REACTIONS = [['👍', 'إعجاب'], ['🤗', 'تعاطف'], ['❤️', 'قلب'], ['😂', 'ضحك'], ['🤭', 'مفاجأة'], ['😳', 'خجل'], ['🤔', 'تفكير']];
function mountReactions(row, floatBox, link, { canSend = false, totalEl = null } = {}) {
  const counts = REACTIONS.map(() => 0);      // totals confirmed by the server
  const sent = REACTIONS.map(() => 0);        // my own taps not yet confirmed
  const nums = [];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const short = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
  // The reactions are folded into one button; a tap opens the box to pick one (or, in the
  // studio, to see how many of each).
  const openNum = el('span', { class: 'react-n' }, '0');
  const opener = el('button', { class: 'react-open', type: 'button', 'aria-expanded': 'false', 'aria-label': T('التفاعلات'), title: T('التفاعلات') },
    el('span', { class: 'react-e', 'aria-hidden': 'true' }, '👍'), el('span', { class: 'react-e react-e2', 'aria-hidden': 'true' }, '❤️'), openNum);
  const wrap = el('div', { class: 'react-wrap' });
  row.replaceWith(wrap);
  row.classList.add('react-box'); row.hidden = true;
  wrap.append(opener, row);
  const setOpen = (on) => { row.hidden = !on; opener.setAttribute('aria-expanded', on ? 'true' : 'false'); };
  opener.onclick = () => setOpen(row.hidden);
  document.addEventListener('pointerdown', (e) => { if (!row.hidden && !wrap.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  function paint() {
    let total = 0;
    nums.forEach((node, k) => { const v = counts[k] + sent[k]; total += v; node.textContent = short(v); });
    openNum.textContent = short(total);
    if (totalEl) totalEl.textContent = short(total);
  }
  function float(k) {
    if (calm || document.hidden || !floatBox || floatBox.childElementCount > 28) return;
    const h = el('span', { class: 'float-heart' }, REACTIONS[k][0]);
    h.style.setProperty('--x', `${Math.round(Math.random() * 60 - 30)}px`);
    h.style.setProperty('--s', (0.8 + Math.random() * 0.7).toFixed(2));
    floatBox.append(h);
    h.addEventListener('animationend', () => h.remove());
  }
  REACTIONS.forEach(([emoji, label], k) => {
    const num = el('span', { class: 'react-n' }, '0');
    nums.push(num);
    const props = { class: 'react', 'aria-label': T(label), title: T(label) };
    if (canSend) {
      props.type = 'button';
      props.onclick = () => {
        if (!link.ready) return;
        link.send({ t: 'react', k });
        sent[k]++;
        paint(); float(k);
        setOpen(false);
      };
    }
    row.append(el(canSend ? 'button' : 'span', props, el('span', { class: 'react-e', 'aria-hidden': 'true' }, emoji), num));
  });
  link.on('init', (d) => { (d.reacts || []).forEach((c, k) => { counts[k] = c; }); sent.fill(0); paint(); })
    .on('likes', (d) => {
      let shown = 0;
      (d.r || []).forEach((n, k) => {            // what the other viewers just sent
        const others = Math.max(0, n - sent[k]);
        sent[k] = Math.max(0, sent[k] - n);
        for (let i = 0; i < others && shown < 8; i++, shown++) setTimeout(() => float(k), shown * 110);
      });
      (d.c || []).forEach((c, k) => { counts[k] = c; });
      paint();
    });
}

// ------------------------------------------------------- password fields --
// An eye button in every password field: show what was typed, or hide it again.
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="eye-off" d="M4 4l16 16"/></svg>';
function addPasswordEyes(root = document) {
  for (const input of root.querySelectorAll('input[type="password"]')) {
    const wrap = el('span', { class: 'pw-wrap' });
    input.replaceWith(wrap);
    const btn = el('button', { type: 'button', class: 'pw-eye', 'aria-label': T('بين كلمة السر'), title: T('بين كلمة السر'), 'aria-pressed': 'false' });
    btn.innerHTML = EYE;
    btn.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      const label = T(show ? 'خبي كلمة السر' : 'بين كلمة السر');
      btn.setAttribute('aria-label', label); btn.title = label;
      input.focus();
    };
    wrap.append(input, btn);
  }
}
addPasswordEyes();

// --------------------------------------------------------- who is watching --
// The viewer counter is a button: it opens the list of names in the room.
function mountWho(link) {
  const counter = document.querySelector('.viewers');
  if (!counter) return;
  const btn = el('button', { type: 'button', class: 'viewers who-btn', title: T('شكون كيتفرج'), 'aria-label': T('شكون كيتفرج') });
  btn.append(...counter.childNodes);
  counter.replaceWith(btn);
  const list = el('ul', { class: 'who-list' });
  const extra = el('p', { class: 'muted' });
  const dlg = el('dialog', { class: 'dlg who-dlg' }, el('h2', {}, T('شكون كيتفرج')), list, extra,
    el('div', { class: 'dlg-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('سد'))));
  document.body.append(dlg);
  let timer = null;
  const ask = () => link.send({ t: 'who' });
  btn.onclick = () => { ask(); if (!dlg.open) dlg.showModal(); clearInterval(timer); timer = setInterval(ask, 4000); };
  dlg.addEventListener('close', () => clearInterval(timer));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // a click outside closes it
  link.on('who', (d) => {
    list.replaceChildren(...d.people.sort((x, y) => (y.host ? 1 : 0) - (x.host ? 1 : 0) || x.name.localeCompare(y.name))
      .map((p) => el('li', { class: p.host ? 'is-host' : '' }, el('span', {}, p.name), p.host ? el('span', { class: 'badge off' }, T('صاحب اللايف')) : null)));
    const bits = [];
    if (d.more) bits.push(T('و {n} آخرين', { n: d.more }));
    if (d.anon) bits.push(T('{n} متابع بلا اسم', { n: d.anon }));
    extra.textContent = bits.join(' · '); extra.hidden = bits.length === 0;
  });
}
