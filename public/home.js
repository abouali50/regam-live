// REGAM Live - front page: the rooms, grouped by topic, live ones first.
'use strict';
(function () {
  const box = $('#rooms');
  async function load() {
    let data;
    try { data = await fetch('/api/rooms').then((r) => r.json()); } catch { return; }
    document.title = data.site;
    $('#noRooms').hidden = data.rooms.length > 0;
    const groups = new Map();
    for (const r of data.rooms) {
      const key = r.topic || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const hasLive = (k) => groups.get(k).some((r) => r.live);
    // topics with a live room first, then by name, rooms without a topic last
    const order = [...groups.keys()].sort((x, y) => (hasLive(y) - hasLive(x)) || (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)));
    box.replaceChildren(...order.map((topic) => el('section', { class: 'room-group' },
      el('h2', {}, topic || T('قاعات أخرى')),
      el('div', { class: 'room-grid' }, ...groups.get(topic)
        .sort((x, y) => (y.live - x.live) || (y.viewers - x.viewers) || x.title.localeCompare(y.title))
        .map((r) => el('a', { class: 'room-card' + (r.live ? ' is-live' : ''), href: '/r/' + r.slug },
          el('span', { class: 'badge ' + (r.live ? 'on' : 'off') }, T(r.live ? 'مباشر' : 'غير مباشر')),
          el('strong', { class: 'room-name' }, r.title),
          r.live && r.liveTitle ? el('span', { class: 'room-now' }, r.liveTitle) : null,
          el('span', { class: 'room-by' }, r.host),
          r.live ? el('span', { class: 'viewers' }, el('span', { class: 'dot' }), String(r.viewers)) : null,
          !r.live && r.next ? el('span', { class: 'room-next' }, T('اللايف الجاي: {when}', { when: new Date(r.next.at).toLocaleString(LANG === 'ar' ? 'ar-MA' : LANG, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })) : null,
          el('span', { class: 'room-enter' }, (r.locked ? '🔒 ' : '') + T('دخل للقاعة'))))))));
  }
  // "join with a code", like a meeting number: the code leads to its room
  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#joinCode').value.replace(/\D/g, ''), err = $('#joinErr');
    err.hidden = true;
    const r = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => null);
    if (r && r.ok) { location.href = '/r/' + (await r.json()).slug + '?code=' + code; return; }
    err.hidden = false;
    err.textContent = T(r && r.status === 429 ? 'محاولات بزاف. تسنى عشر دقايق وعاود.' : 'الكود غالط. شوف الدعوة وعاود.');
  };
  // the account corner, and the invitation to sign up for people who have no account yet
  fetch('/api/site').then((r) => r.json()).then((site) => {
    mountAccount(document.querySelector('.top .meta'), site);
    if (account.token) { $('#heroHello').hidden = false; $('#heroHello').textContent = T('مرحبا {name}', { name: account.name }); }
    else if (site.accounts) {
      $('#heroActions').hidden = false;
      $('#heroUp').onclick = () => openAccount('signup');
      $('#heroIn').onclick = () => openAccount('login');
    }
  }).catch(() => {});
  load();
  setInterval(load, 10000);
})();
