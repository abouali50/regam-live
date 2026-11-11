// REGAM Live - administration: teachers and rooms.
'use strict';
(async function () {
  const token = sessionStorage.getItem('regam.studio') || '';
  const say = (t) => { $('#adminMsg').textContent = t; };
  const api = (path, opts = {}) => fetch('/api/admin' + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  const ERR = {
    'login already used': 'هاد اسم الدخول مستعمل.', 'password too short': 'كلمة السر خاصها 8 حروف ولا أكثر.',
    'bad name or login': 'اسم الدخول: 3 حروف ولا أكثر، حروف لاتينية وأرقام.', 'teacher still has rooms': 'هاد الأستاذ باقي عندو قاعات. بدل الأستاذ ديالها ولا حذفها أولا.',
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

    $('#noUsers').hidden = data.users.length > 0;
    $('#users').replaceChildren(...data.users.map((u) => el('li', { class: u.active ? '' : 'is-off' },
      el('span', { class: 'admin-main-cell' }, el('strong', {}, u.name), el('span', { class: 'muted', dir: 'ltr' }, u.login),
        u.active ? null : el('span', { class: 'badge off' }, T('موقوف'))),
      el('span', { class: 'rec-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => api('/user', { method: 'POST', body: JSON.stringify({ id: u.id, active: !u.active }) }).then((r) => done(r, T(u.active ? 'توقف الحساب.' : 'تفعل الحساب.'))) }, T(u.active ? 'وقف' : 'فعل')),
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const p = prompt(T('كلمة السر الجديدة (8 حروف ولا أكثر):'));
          if (p) api('/user', { method: 'POST', body: JSON.stringify({ id: u.id, password: p }) }).then((r) => done(r, T('تبدلات كلمة السر.')));
        } }, T('كلمة سر جديدة')),
        el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تحذف الأستاذ "{name}"؟', { name: u.name }))) api('/user?id=' + u.id, { method: 'DELETE' }).then((r) => done(r, T('تحذف الأستاذ.'))); } }, T('حذف'))))));

    $('#roomList').replaceChildren(...data.rooms.map((r) => el('li', {},
      el('span', { class: 'admin-main-cell' },
        el('strong', {}, r.title), r.topic ? el('span', { class: 'muted' }, r.topic) : null,
        r.live ? el('span', { class: 'badge on' }, T('مباشر')) : null,
        el('a', { class: 'room-url', href: data.rooms.length === 1 ? '/' : '/r/' + r.slug, target: '_blank', rel: 'noopener', dir: 'ltr' }, location.host + (data.rooms.length === 1 ? '/' : '/r/' + r.slug))),
      el('span', { class: 'rec-actions' },
        ownerSel(r.ownerId, (e) => api('/room', { method: 'POST', body: JSON.stringify({ slug: r.slug, ownerId: e.target.value }) }).then((res) => done(res, T('تبدل الأستاذ ديال القاعة.')))),
        el('button', { class: 'btn', type: 'button', onclick: () => {
          const t = prompt(T('الاسم الجديد ديال القاعة:'), r.title);
          if (t) api('/room', { method: 'POST', body: JSON.stringify({ slug: r.slug, title: t }) }).then((res) => done(res, T('تبدل اسم القاعة.')));
        } }, T('بدل الاسم')),
        el('button', { class: 'btn', type: 'button', onclick: () => { if (confirm(T('تحذف القاعة "{name}"؟ التسجيلات ديالها كيبقاو فالسيرفر.', { name: r.title }))) api('/room?slug=' + r.slug, { method: 'DELETE' }).then((res) => done(res, T('تحذفات القاعة.'))); } }, T('حذف'))))));
  }

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
