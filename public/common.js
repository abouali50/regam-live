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
// Line icons, drawn in the theme's gold (the same family everywhere, instead of emoji).
const ICONS = {
  picture: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5a1.5 1.5 0 1 0 .01 0',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3', calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  record: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', globe: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3c3.5 3 3.5 15 0 18M12 3c-3.5 3-3.5 15 0 18',
  users: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM2 20c0-4 3-6 7-6s7 2 7 6M16.5 11a3 3 0 1 0 0-6M18 14c2.5.6 4 2.6 4 6', door: 'M6 21V3h10v18M4 21h16M13 12h.01',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  tools: 'M14.5 5.5a4.5 4.5 0 0 0 5.6 5.6L11 20.2a2.2 2.2 0 0 1-3.1-3.1l9.1-9.1a4.5 4.5 0 0 1-2.5-2.5z', eye: 'M2 12s4-7 10-7s10 7 10 7s-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z',
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', ICONS[name] || ''); svg.append(path);
  return svg;
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
// A person's picture: their photo when they have one, else the first letter of their name on a colour of their own.
function avatar(name, av, size = 32) {
  const n = String(name || '?').trim(), hue = [...n].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7);
  const box = el('span', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:hsl(${hue} 55% 38%)`, 'aria-hidden': 'true', 'data-l': [...n][0] ? [...n][0].toUpperCase() : '?' });      // the letter is drawn by the style sheet, so it never mixes with the text around
  if (av) box.append(el('img', { src: '/media/avatar/' + av, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }));
  return box;
}
// Face ID / fingerprint (passkeys): the device keeps the key, the site checks a signature. No password is typed.
const passkey = {
  can: () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create),
  b64: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  bin: (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
  post: async (what, body, token) => { const r = await fetch('/api/member/passkey/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) }); return { ok: r.ok, data: await r.json().catch(() => ({})) }; },
  async add() {                                  // this device, for the account that is signed in
    const o = (await passkey.post('options', {}, account.token)).data;
    if (!o.challenge) return false;
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: passkey.bin(o.challenge), rp: { id: o.rpId, name: o.rpName }, user: { id: passkey.bin(o.userId), name: o.userName, displayName: o.displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], attestation: 'none', timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      excludeCredentials: (o.exclude || []).map((id) => ({ type: 'public-key', id: passkey.bin(id) })),
    } });
    const r = cred.response;
    return (await passkey.post('add', { state: o.state, id: cred.id, clientDataJSON: passkey.b64(r.clientDataJSON), publicKey: passkey.b64(r.getPublicKey()), alg: r.getPublicKeyAlgorithm(), label: navigator.platform || '' }, account.token)).ok;
  },
  async login() {                                // returns { token, name } or null
    const o = (await passkey.post('start')).data;
    if (!o.challenge) return null;
    const cred = await navigator.credentials.get({ publicKey: { challenge: passkey.bin(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60000 } });
    const r = cred.response;
    const res = await passkey.post('login', { state: o.state, id: cred.id, clientDataJSON: passkey.b64(r.clientDataJSON), authenticatorData: passkey.b64(r.authenticatorData), signature: passkey.b64(r.signature) });
    return res.ok ? res.data : null;
  },
};
// The profile of the signed-in person: photo, name, e-mail, way out.
async function openProfile() {
  let dlg = document.getElementById('profileDlg');
  if (dlg) dlg.remove();
  const auth = { Authorization: 'Bearer ' + account.token };
  const me = await fetch('/api/member/me', { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!me) return;
  const note = el('p', { class: 'muted', role: 'status' });
  const keyOff = el('button', { class: 'acc-link', id: 'keyOff', type: 'button', hidden: !me.keys, onclick: async () => { if ((await passkey.post('remove', {}, account.token)).ok) { me.keys = 0; keyOff.hidden = true; note.textContent = T('تحيد Face ID / البصمة من الحساب ديالك.'); } } }, T('حيد Face ID / البصمة'));
  const pic = el('span', { class: 'profile-pic' });
  const paint = () => pic.replaceChildren(avatar(me.name, me.av ? `${me.id}?v=${me.av}` : '', 112));
  paint();
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  file.onchange = async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    note.textContent = T('كنرفعو الصورة…');
    try {
      // the picture is cut to a square and made small here, before it leaves the phone
      const url = URL.createObjectURL(f), img = new Image();
      img.src = url; await img.decode(); URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = c.height = 320;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      const r = await fetch('/api/avatar', { method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: blob });
      if (!r.ok) throw new Error('refused');
      me.av = (await r.json()).av; store.set('regam.memberAv', `${me.id}?v=${me.av}`);
      paint(); note.textContent = T('تبدلات الصورة ديالك.'); changed = true;
    } catch { note.textContent = T('ما قدرناش نخدمو بهاد الصورة. جرب صورة أخرى.'); }
  };
  let changed = false;
  const name = el('input', { type: 'text', maxlength: 24, value: me.name, autocomplete: 'name' });
  dlg = el('dialog', { id: 'profileDlg', class: 'dlg profile-dlg' },
    el('h2', {}, T('البروفايل ديالي')),
    el('div', { class: 'profile-top' }, pic, el('div', { class: 'profile-btns' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => file.click() }, T('بدل الصورة')),
      el('button', { class: 'btn', type: 'button', onclick: async () => { await fetch('/api/avatar', { method: 'DELETE', headers: auth }); me.av = 0; store.set('regam.memberAv', ''); paint(); changed = true; note.textContent = T('تحيدات الصورة.'); } }, T('حيد الصورة')))),
    file,
    el('label', { class: 'acc-field' }, T('الاسم (كيبان للناس)'), name),
    el('p', { class: 'muted', dir: 'ltr' }, me.email),
    passkey.can() ? el('div', { class: 'profile-key' },
      el('button', { class: 'btn', id: 'keyAdd', type: 'button', onclick: async () => {
        try { const ok = await passkey.add(); if (ok) me.keys = (me.keys || 0) + 1; note.textContent = T(ok ? 'تفعل Face ID / البصمة فهاد الجهاز. المرة الجاية دخل بلا كلمة السر.' : 'ما تفعلش. عاود جرب.'); }
        catch (e) { note.textContent = T(e && e.name === 'InvalidStateError' ? 'هاد الجهاز مفعل من قبل.' : 'ما تفعلش. عاود جرب.'); }
        keyOff.hidden = !me.keys;
      } }, '🔐 ' + T('فعل Face ID / البصمة فهاد الجهاز')),
      keyOff) : null,
    note,
    el('div', { class: 'dlg-actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const n = name.value.trim();
        if (n && n !== me.name) {
          const r = await fetch('/api/member/rename', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
          if (!r.ok) { note.textContent = T('كتب اسم فيه جوج حروف ولا أكثر.'); return; }
          account.set(account.token, n); changed = true;
        }
        dlg.close();
      } }, T('حفظ')),
      el('button', { class: 'btn', type: 'button', onclick: () => { account.clear(); location.reload(); } }, T('خروج')),
      el('a', { class: 'btn danger', href: '/legal' }, T('حذف الحساب ديالي'))));
  dlg.addEventListener('close', () => { if (changed) location.reload(); });      // the room is told the new name and photo on the way back in
  document.body.append(dlg);
  dlg.showModal();
}
// The people in the room, gathered behind one button: a list, one under the other, with their pictures.
function mountPeople(btn, link) {
  let dlg = null, timer = null;
  const ROLE = { host: '🎙️ ' + T('الأستاذ'), helper: '🛡️ ' + T('مساعد'), stage: '🎥 ' + T('على المنصة'), point: '☝️ ' + T('نقطة نظام'), hand: '✋ ' + T('رافع يدو') };
  const list = el('ul', { class: 'people-list who-list' }), title = el('h2', {}), more = el('p', { class: 'muted' });
  link.on('people', (d) => {
    title.textContent = T('الحاضرين ({n})', { n: d.total });
    list.replaceChildren(...d.list.map((p) => el('li', {}, avatar(p.name, p.av, 36), el('span', { class: 'people-name', dir: 'auto' }, p.name), p.role ? el('span', { class: 'people-role' }, ROLE[p.role]) : null)));
    more.hidden = !d.nameless;
    more.textContent = T('و {n} آخرين بلا اسم', { n: d.nameless });
  });
  btn.onclick = () => {
    if (!dlg) {
      dlg = el('dialog', { class: 'dlg people-dlg who-dlg' }, title, list, more, el('div', { class: 'dlg-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('سد'))));
      dlg.addEventListener('close', () => clearInterval(timer));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // a click outside closes it
      document.body.append(dlg);
    }
    link.send({ t: 'people' });
    clearInterval(timer); timer = setInterval(() => link.send({ t: 'people' }), 5000);
    dlg.showModal();
  };
}
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
  const keyBtn = el('button', { class: 'btn acc-key', id: 'keyLogin', type: 'button', hidden: true, onclick: async () => {
    err.hidden = true;
    try { const d = await passkey.login(); if (d) { account.set(d.token, d.name); location.reload(); } else { err.hidden = false; err.textContent = T('ما لقيناش حساب بهاد Face ID / البصمة. دخل بكلمة السر، ومن بعد فعلها من البروفايل.'); } }
    catch { /* the person closed the system's window */ }
  } }, '🔐 ' + T('دخل ب Face ID / البصمة'));
  const form = el('form', { class: 'acc-form' }, title, note, keyBtn, name.row, email.row, pass.row, code.row, err, el('div', { class: 'dlg-actions' }, submit, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('إلغاء'))), links);
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
    keyBtn.hidden = v !== 'login' || !passkey.can();
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
  if (account.token) {
    const me = await fetch('/api/member/me', { headers: { Authorization: 'Bearer ' + account.token } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    box.append(el('button', { class: 'acc-me', type: 'button', title: T('البروفايل ديالي'), 'aria-label': T('البروفايل ديالي'), onclick: openProfile }, avatar(account.name, me && me.av ? `${me.id}?v=${me.av}` : '', 30), el('span', { class: 'acc-name' }, account.name)),
      el('button', { class: 'btn small', type: 'button', onclick: () => { account.clear(); location.reload(); } }, T('خروج')));
  }
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
        if (['wait', 'signin', 'code', 'refused', 'pay', 'closed'].includes(d.t)) link.door = d.t;       // at the door, not in the room yet
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
      m.ai ? null : avatar(m.name, m.av, 22), el('span', { class: 'who' }, m.ai ? '🤖 ' + T('المساعد الذكي') : m.name), ' ', el('span', { class: 'txt' + (m.c ? ' c' + m.c : '') }, m.text));
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

