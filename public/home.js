// REGAM Live - front page: what is on air now, and all the rooms folded behind one button, picked by topic.
'use strict';
(function () {
  const box = $('#rooms');
  async function load() {
    let data;
    try { data = await fetch('/api/rooms').then((r) => r.json()); } catch { return; }
    siteClock.set(data.now, data.tz);
    document.title = data.site;
    $('#noRooms').hidden = data.rooms.length > 0;
    // the calendar: every planned session of every room, soonest first
    const loc = LANG === 'ar' ? 'ar-MA' : LANG;
    const planned = data.rooms.flatMap((r) => (r.sessions || []).map((s) => ({ ...s, room: r }))).sort((a, b) => a.at - b.at).slice(0, 12);
    $('#agenda').hidden = planned.length === 0;
    $('#agendaList').replaceChildren(...planned.map((s) => el('li', {},
      el('span', { class: 'agenda-day' }, siteClock.at(s.at).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })),
      el('span', { class: 'agenda-time', dir: 'ltr' }, siteClock.at(s.at).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) + (s.end ? ' – ' + siteClock.at(s.end).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : '')),
      el('span', { class: 'agenda-what' }, el('strong', {}, s.room.title), s.title ? ' · ' + s.title : ''),
      el('span', { class: 'agenda-acts' },
        el('a', { class: 'btn small', href: `/api/ics?room=${encodeURIComponent(s.room.slug)}&id=${s.id}` }, T('زيدو للأجندة')),
        el('a', { class: 'btn small primary', href: '/r/' + s.room.slug }, T('دخل للقاعة'))))));
    // rooms on air right now are shown at once; all the others stay folded behind one button
    const when = (r) => siteClock.at(r.next.at).toLocaleString(loc, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const byRank = (x, y) => (y.live - x.live) || (y.viewers - x.viewers) || x.title.localeCompare(y.title);
    const live = data.rooms.filter((r) => r.live).sort(byRank);
    $('#liveNow').hidden = live.length === 0;
    $('#liveRooms').replaceChildren(...live.map((r) => el('a', { class: 'room-card is-live', href: '/r/' + r.slug },
      el('span', { class: 'badge on' }, T('مباشر')),
      el('strong', { class: 'room-name' }, r.title),
      r.liveTitle ? el('span', { class: 'room-now' }, r.liveTitle) : null,
      el('span', { class: 'room-by' }, r.host),
      el('span', { class: 'viewers' }, el('span', { class: 'dot' }), String(r.viewers)),
      el('span', { class: 'room-enter' }, (r.locked ? '🔒 ' : '') + T('دخل للقاعة')))));
    $('#roomsLabel').textContent = T('القاعات ({n})', { n: data.rooms.length });
    // the list of all the rooms is for the people who run the site (address …/rooms?all): a visitor reaches a live by its link
    $('#roomsToggle').hidden = !new URLSearchParams(location.search).has('all');
    const topics = [...new Set(data.rooms.map((r) => r.topic || ''))].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)));
    if (topic !== null && !topics.includes(topic)) topic = null;
    $('#topicChips').hidden = topics.length < 2;
    $('#topicChips').replaceChildren(...[null, ...topics].map((t) => el('button', { class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(t === topic), onclick: () => { topic = t; load(); } },
      t === null ? T('الكل') : t || T('قاعات أخرى'))));
    box.replaceChildren(...data.rooms.filter((r) => topic === null || (r.topic || '') === topic).sort(byRank)
      .map((r) => el('a', { class: 'room-row' + (r.live ? ' is-live' : ''), href: '/r/' + r.slug },
        el('span', { class: 'room-row-main' }, el('strong', { class: 'room-name' }, r.title),
          el('span', { class: 'room-by' }, [r.host, r.topic, r.fee ? T(r.fee.days === 1 ? '{amount} $ / نهار' : '{amount} $ / شهر', { amount: r.fee.amount }) : T('مجانا')].filter(Boolean).join(' · ')),
          !r.live && r.next ? el('span', { class: 'room-next' }, T('اللايف الجاي: {when}', { when: when(r) })) : null),
        el('span', { class: 'badge ' + (r.live ? 'on' : 'off') }, T(r.live ? 'مباشر' : 'غير مباشر')),
        el('span', { class: 'room-enter' }, (r.locked ? '🔒 ' : '') + T('دخل')))));
  }
  let topic = null;                                // the topic picked in the rooms panel (null: all)
  $('#roomsToggle').onclick = () => {
    const open = $('#roomsPanel').hidden;
    $('#roomsPanel').hidden = !open;
    $('#roomsToggle').setAttribute('aria-expanded', String(open));
    if (open) $('#roomsPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  // professional accounts: what each plan gives
  fetch('/api/plans').then((r) => r.json()).then((d) => {
    if (!d.plans || !d.plans.length) return;
    $('#proPlans').replaceChildren(...d.plans.map((p) => el('li', { class: 'plan-card' },
      el('h3', {}, p.name),
      el('p', { class: 'plan-price' }, p.price === 0 ? T('فابور') : el('span', {}, p.price + ' $ ', el('small', {}, T(p.yearly ? 'فالعام' : 'فالشهر')))),
      el('p', {}, '👥 ' + T('حتى ل {n} مشارك', { n: p.capacity })),
      el('p', {}, '⏱ ' + (p.minutes ? T('كل لايف حتى ل {m} دقيقة', { m: p.minutes }) : T('مدة اللايف بلا حد'))),
      el('a', { class: 'btn primary', href: '/teach' }, T(p.price === 0 ? 'ابدا فابور' : 'اختار هاد العرض')))));
    $('#proBox').hidden = false;
  }).catch(() => {});
  // the account corner, and the invitation to sign up for people who have no account yet
  fetch('/api/site').then((r) => r.json()).then((site) => {
    mountAccount(document.querySelector('.top .meta'), site);
    if (site.assistant) mountAssistant();
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
