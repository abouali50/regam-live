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
          r.live ? el('span', { class: 'viewers' }, el('span', { class: 'dot' }), String(r.viewers)) : null))))));
  }
  load();
  setInterval(load, 10000);
})();
