// REGAM Live - administration: teachers and rooms.
'use strict';
(async function () {
  const token = sessionStorage.getItem('regam.studio') || '';
  const say = (t) => { $('#adminMsg').textContent = t; };
  const api = (path, opts = {}) => fetch('/api/admin' + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  const ERR = {
    'login already used': 'هاد اسم الدخول مستعمل.', 'password too short': 'كلمة السر خاصها 8 حروف ولا أكثر.',
    'bad name or login': 'اسم الدخول: 3 حروف ولا أكثر، حروف لاتينية وأرقام.', 'teacher still has rooms': 'هاد الأستاذ باقي عندو قاعات. بدل الأستاذ ديالها ولا حذفها أولا.',
    'bad mail settings': 'عمر السيرفر، العنوان وكلمة السر ديال الإيميل أولا.',
    'the last room cannot be deleted': 'ما يمكنش تحذف آخر قاعة.', 'title and teacher are required': 'خاص اسم القاعة والأستاذ.',
  };
  async function done(res, okText) {
    if (res.ok) { say(okText); await load(); return true; }
    const e = await res.json().catch(() => ({}));
    say(T(ERR[e.error] || 'ما قدرناش نديرو هاد العملية.'));
    return false;
  }

  async function load() {
    const res = await api('');
    if (res.status === 401 || res.status === 403) { location.replace('/studio'); return; }
    const data = await res.json();
    const owners = [{ id: 'admin', name: T('المدير (أنا)') }, ...data.users.filter((u) => u.active)];
    const ownerSel = (current, onchange) => el('select', { 'aria-label': T('الأستاذ'), onchange },
      ...owners.concat(data.users.filter((u) => !u.active && u.id === current)).map((o) => el('option', { value: o.id, selected: o.id === current }, o.name)));
    $('#roomForm').elements.ownerId.replaceChildren(...owners.map((o) => el('option', { value: o.id }, o.name)));
    $('#topics').replaceChildren(...[...new Set(data.rooms.map((r) => r.topic).filter(Boolean))].map((t) => el('option', { value: t })));

    $('#teachUrl').textContent = location.host + '/teach';
    const planOf = (id) => data.plans.find((p) => p.id === id);
    const day = (ms) => new Date(ms).toLocaleDateString(LANG === 'ar' ? 'ar-MA' : LANG, { year: 'numeric', month: 'short', day: 'numeric' });
    const setUser = (body, okText) => api('/user', { method: 'POST', body: JSON.stringify(body) }).then((r) => done(r, okText));
    data.users.sort((x, y) => (y.pending - x.pending));
    $('#noUsers').hidden = data.users.length > 0;
    $('#users').replaceChildren(...data.users.map((u) => el('li', { class: (u.active && !u.expired ? '' : 'is-off') + (u.pending ? ' is-pending' : '') },
      el('span', { class: 'admin-main-cell' }, el('strong', {}, u.name), el('span', { class: 'muted', dir: 'ltr' }, u.login),
        u.pending ? el('span', { class: 'badge wait' }, T('طلب جديد')) : u.expired ? el('span', { class: 'badge off' }, T('سالا الاشتراك')) : u.active ? null : el('span', { class: 'badge off' }, T('موقوف')),
        u.contact ? el('span', { class: 'muted', dir: 'auto' }, u.contact) : null,
        u.pending && u.wantRoom ? el('span', { class: 'muted' }, T('القاعة: {room}', { room: u.wantRoom + (u.wantTopic ? ' · ' + u.wantTopic : '') })) : null,
        planOf(u.planId) ? el('span', { class: 'muted' }, T('{name}: حتى ل {n} متابع، {price} دولار فالشهر', { name: planOf(u.planId).name, n: planOf(u.planId).capacity, price: planOf(u.planId).price })) : null,
        u.paidUntil ? el('span', { class: u.expired ? 'err' : 'muted' }, T('مخلص حتى ل {date}', { date: day(u.paidUntil) })) : null),
      el('span', { class: 'rec-actions' },
        u.pending
          ? el('button', { class: 'btn primary', type: 'button', onclick: () => { if (confirm(T('وصل الخلاص ديال "{name}"؟ غادي يتفعل الحساب والقاعة لمدة شهر.', { name: u.name }))) setUser({ id: u.id, months: 1 }, T('تفعل الحساب وتحلات القاعة.')); } }, T('وصل الخلاص: فعل'))
          : el('button', { class: 'btn', type: 'button', onclick: () => setUser({ id: u.id, active: !u.active }, T(u.active ? 'توقف الحساب.' : 'تفعل الحساب.')) }, T(u.active ? 'وقف' : 'فعل')),
        u.pending ? null : el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تزيد شهر ل "{name}"؟', { name: u.name }))) setUser({ id: u.id, months: 1 }, T('تزاد شهر.')); } }, T('زيد شهر')),
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const p = prompt(T('كلمة السر الجديدة (8 حروف ولا أكثر):'));
          if (p) api('/user', { method: 'POST', body: JSON.stringify({ id: u.id, password: p }) }).then((r) => done(r, T('تبدلات كلمة السر.')));
        } }, T('كلمة سر جديدة')),
        el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تحذف الأستاذ "{name}"؟', { name: u.name }))) api('/user?id=' + u.id, { method: 'DELETE' }).then((r) => done(r, T('تحذف الأستاذ.'))); } }, T('حذف'))))));

    showSettings(data);
    showAi(data.ai);
    showBackup(data.backup);
    showAccounts(data.accounts);
    $('#roomList').replaceChildren(...data.rooms.map((r) => el('li', {},
      el('span', { class: 'admin-main-cell' },
        el('strong', {}, r.title), r.topic ? el('span', { class: 'muted' }, r.topic) : null,
        r.live ? el('span', { class: 'badge on' }, T('مباشر')) : null,
        el('a', { class: 'room-url', href: data.rooms.length === 1 && !data.accounts.mailReady ? '/' : '/r/' + r.slug, target: '_blank', rel: 'noopener', dir: 'ltr' }, location.host + (data.rooms.length === 1 && !data.accounts.mailReady ? '/' : '/r/' + r.slug))),
      el('span', { class: 'rec-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const n = prompt(T('العدد الأقصى ديال المتابعين (0 = بلا حد):'), String(r.capacity || 0));
          if (n !== null && /^\d+$/.test(n.trim())) api('/room', { method: 'POST', body: JSON.stringify({ slug: r.slug, capacity: Number(n) }) }).then((res) => done(res, T('تبدل العدد الأقصى.')));
        } }, r.capacity ? T('حتى ل {n} متابع', { n: r.capacity }) : T('بلا حد')),
        ownerSel(r.ownerId, (e) => api('/room', { method: 'POST', body: JSON.stringify({ slug: r.slug, ownerId: e.target.value }) }).then((res) => done(res, T('تبدل الأستاذ ديال القاعة.')))),
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const t = prompt(T('الاسم الجديد ديال القاعة:'), r.title);
          if (t) api('/room', { method: 'POST', body: JSON.stringify({ slug: r.slug, title: t }) }).then((res) => done(res, T('تبدل اسم القاعة.')));
        } }, T('بدل الاسم')),
        el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تحذف القاعة "{name}"؟ التسجيلات ديالها كيبقاو فالسيرفر.', { name: r.title }))) api('/room?slug=' + r.slug, { method: 'DELETE' }).then((res) => done(res, T('تحذفات القاعة.'))); } }, T('حذف'))))));
  }

  // ---- the AI assistant: its key, what it knows, where it answers
  function showAi(a) {
    const f = $('#aiForm').elements;
    $('#aiState').textContent = T(a.ready ? 'المساعد خدام.' : 'المساعد ما خدامش: دخل المفتاح أولا.');
    $('#aiState').className = a.ready ? 'ok-text' : 'err';
    if ($('#aiForm').contains(document.activeElement)) return;
    f.model.replaceChildren(...a.models.map((m) => el('option', { value: m }, m)));
    f.model.value = a.model; f.about.value = a.about; f.chat.checked = a.chat; f.help.checked = a.help;
    f.key.placeholder = a.hasKey ? '••••••••' : 'sk-ant-…';
  }
  $('#aiForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    api('/settings', { method: 'POST', body: JSON.stringify({ ai: { key: f.key.value.trim(), model: f.model.value, about: f.about.value, chat: f.chat.checked, help: f.help.checked } }) })
      .then((r) => { f.key.value = ''; document.activeElement.blur(); return done(r, T('تحفظ. جرب المساعد دابا.')); });
  };
  $('#aiTest').onclick = async () => {
    say(T('كنجربو المساعد…'));
    const r = await api('/aitest', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    say(r.ok ? T('المساعد جاوب: كلشي خدام.') : T('المساعد ما جاوبش. تأكد من المفتاح ومن الرصيد فالحساب ديال Anthropic.') + (d.error ? ' — ' + d.error : ''));
  };
  addPasswordEyes($('#aiForm'));

  // ---- viewer accounts: who needs one, the mailbox that sends the codes, the people signed up
  const PRESET = { gmail: ['smtp.gmail.com', 465], hostinger: ['smtp.hostinger.com', 465] };
  function showAccounts(a) {
    const f = $('#mailForm').elements;
    $('#accessSel').value = a.access;
    $('#mailState').textContent = T(a.mailReady ? 'الإيميل مركب: التسجيل خدام.' : 'مازال ما ركبتيش الإيميل: التسجيل ما خدامش حتى تركبو.');
    $('#mailState').className = a.mailReady ? 'ok-text' : 'err';
    if (!$('#mailForm').contains(document.activeElement)) {
      f.host.value = a.mail.host || PRESET.gmail[0]; f.port.value = a.mail.port || 465; f.user.value = a.mail.user;
      f.kind.value = Object.keys(PRESET).find((k) => PRESET[k][0] === f.host.value) || 'other';
      f.pass.placeholder = a.mail.hasPass ? '••••••••' : '';
    }
    $('#memberCount').textContent = T('المسجلين: {n} (منهم {v} مفعلين)', { n: a.members.total, v: a.members.verified });
    $('#members').replaceChildren(...a.members.list.map((m) => el('li', { class: m.verified ? '' : 'is-off' },
      el('span', { class: 'admin-main-cell' }, el('strong', {}, m.name), el('span', { class: 'muted', dir: 'ltr' }, m.email), m.verified ? null : el('span', { class: 'badge off' }, T('ما مفعلش'))),
      el('span', { class: 'rec-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تحذف الحساب ديال "{name}"؟', { name: m.name }))) api('/member?id=' + m.id, { method: 'DELETE' }).then((r) => done(r, T('تحذف الحساب.'))); } }, T('حذف'))))));
  }
  $('#mailForm').elements.kind.onchange = (e) => { const p = PRESET[e.target.value]; if (p) { $('#mailForm').elements.host.value = p[0]; $('#mailForm').elements.port.value = p[1]; } };
  $('#accessForm').onsubmit = async (e) => {
    e.preventDefault();
    const want = $('#accessSel').value;
    const res = await api('/settings', { method: 'POST', body: JSON.stringify({ access: want }) });
    if (await done(res, T('تحفظ.')) && $('#accessSel').value !== want) say(T('ركب الإيميل أولا: بلا بيه حتى واحد ما يقدر يسجل.'));
  };
  $('#mailForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    api('/settings', { method: 'POST', body: JSON.stringify({ mail: { host: f.host.value, port: Number(f.port.value), user: f.user.value, from: f.user.value, pass: f.pass.value.replace(/\s+/g, '') } }) })
      .then((r) => { f.pass.value = ''; return done(r, T('تحفظ الإيميل. جربو دابا برسالة تجريبية.')); });
  };
  $('#mailTest').onsubmit = async (e) => {
    e.preventDefault();
    say(T('كنصيفطو…'));
    const r = await api('/mailtest', { method: 'POST', body: JSON.stringify({ to: e.target.elements.to.value }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) await load();
    say(r.ok ? T('تصيفطات الرسالة. شوف الإيميل ديالك (وحتى Spam).') + ($('#accessSel').value === 'watch' ? ' ' + T('من دابا، خاص كل واحد يسجل باش يدخل.') : '') : T('ما تصيفطاتش الرسالة. تأكد من العنوان وكلمة السر ديال الإيميل.') + (d.error ? ' — ' + d.error : ''));
  };
  addPasswordEyes($('#mailForm'));

  // ---- backups
  function showBackup(b) {
    const when = (ms) => new Date(ms).toLocaleString(LANG === 'ar' ? 'ar-MA' : LANG, { dateStyle: 'medium', timeStyle: 'short' });
    $('#bakState').textContent = [
      b.count ? T('فالسيرفر: {n} نسخة، الأخيرة ديال {day}.', { n: b.count, day: b.last }) : T('مازال ما كاينة حتى نسخة فالسيرفر.'),
      b.lastMail ? T('آخر نسخة تصيفطات فالإيميل: {when}.', { when: when(b.lastMail) }) : T('مازال ما تصيفطات حتى نسخة فالإيميل.'),
      b.mailReady ? '' : T('ركب الإيميل الفوق أولا باش النسخ يتصيفطو.'),
      b.lastError ? T('آخر محاولة فشلات: {why}', { why: b.lastError }) : '',
    ].filter(Boolean).join(' ');
    const f = $('#bakForm').elements;
    if (document.activeElement !== f.email) f.email.value = b.email;
    f.every.value = b.every;
  }
  $('#bakForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    api('/backup', { method: 'POST', body: JSON.stringify({ email: f.email.value, every: f.every.value }) }).then((r) => done(r, T('تحفظ.')));
  };
  $('#bakSend').onclick = async () => {
    const f = $('#bakForm').elements;
    if (!f.email.value) { say(T('كتب الإيميل اللي غادي توصلو النسخة أولا.')); return; }
    say(T('كنصيفطو…'));
    await api('/backup', { method: 'POST', body: JSON.stringify({ email: f.email.value, every: f.every.value }) });
    const r = await api('/backupsend', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    await load();
    say(r.ok ? T('تصيفطات النسخة. شوف الإيميل ديالك (وحتى Spam).') : T('ما تصيفطاتش النسخة.') + (d.error ? ' — ' + d.error : ''));
  };
  $('#bakGet').onclick = async () => {
    const r = await api('/backup');
    if (!r.ok) { say(T('ما قدرناش نديرو هاد العملية.')); return; }
    const a = el('a', { href: URL.createObjectURL(await r.blob()), download: `regam-live-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    say(T('تحملات النسخة. خبيها فبلاصة آمنة: فيها الحسابات والإعدادات كاملين.'));
  };
  $('#bakRestore').onclick = async () => {
    const file = $('#bakFile').files[0];
    if (!file) { say(T('اختار ملف النسخة أولا.')); return; }
    if (!confirm(T('هادشي غادي يبدل كلشي باللي فهاد النسخة: الحسابات، القاعات والبرنامج. اللايفات الخدامين غادي يتقطعو. تكمل؟'))) return;
    const r = await api('/restore', { method: 'POST', body: await file.text() });
    if (!r.ok) { say(T('هاد الملف ماشي نسخة ديال REGAM Live.')); return; }
    say(T('رجعات النسخة. الموقع كيعاود يشعل، تسنى شوية…'));
    setTimeout(() => location.reload(), 8000);
  };

  // ---- plans and payment instructions
  let plans = [];
  const savePlans = (list, okText) => api('/settings', { method: 'POST', body: JSON.stringify({ plans: list }) }).then((r) => done(r, okText));
  function showSettings(data) {
    plans = data.plans;
    $('#planList').replaceChildren(...plans.map((p) => el('li', {},
      el('span', { class: 'admin-main-cell' }, el('strong', {}, p.name), el('span', { class: 'muted' }, T('{name}: حتى ل {n} متابع، {price} دولار فالشهر', { name: p.name, n: p.capacity, price: p.price }))),
      el('span', { class: 'rec-actions' }, el('button', { class: 'btn', type: 'button', onclick: () => savePlans(plans.filter((x) => x !== p), T('تحذف العرض.')) }, T('حذف'))))));
    if (document.activeElement !== $('#payText')) $('#payText').value = data.payInfo;
  }
  $('#planForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (await savePlans([...plans, { name: f.name.value, price: Number(f.price.value), capacity: Number(f.capacity.value) }], T('تزاد العرض.'))) e.target.reset();
  };
  $('#payForm').onsubmit = (e) => { e.preventDefault(); api('/settings', { method: 'POST', body: JSON.stringify({ payInfo: $('#payText').value }) }).then((r) => done(r, T('تحفظات طريقة الخلاص.'))); };

  $('#userForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (await done(await api('/user', { method: 'POST', body: JSON.stringify({ name: f.name.value, login: f.login.value, password: f.password.value }) }), T('تزاد الأستاذ. عطيه اسم الدخول وكلمة السر.'))) e.target.reset();
  };
  $('#roomForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (await done(await api('/room', { method: 'POST', body: JSON.stringify({ title: f.title.value, topic: f.topic.value, ownerId: f.ownerId.value }) }), T('تزادت القاعة.'))) { f.title.value = ''; }
  };
  load();
})();
