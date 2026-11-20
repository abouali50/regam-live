/* REGAM Academy. Static, local-first navigation. No tracking or remote requests. */
(() => {
  'use strict';

  const DATA = window.REGAM_DATA;
  const app = document.getElementById('app');
  if (!DATA || !Array.isArray(DATA.lessons) || !Array.isArray(DATA.tracks)) {
    app.innerHTML = '<main class="loading-error"><h1>REGAM Academy</h1><p>ملف الدروس ما تحمّلش. تأكد أن مجلد <code>data</code> موجود حدا <code>index.html</code>، ومن بعد عاود حلّ الصفحة.</p></main>';
    return;
  }

  const arr = value => Array.isArray(value) ? value : [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const slug = value => encodeURIComponent(String(value));
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase().trim();
  const safeURL = value => /^(https?:\/\/|(?:\.?\.?\/)?[a-zA-Z0-9_/-])/.test(String(value || '')) && !/^(javascript|data|vbscript):/i.test(String(value)) ? String(value) : '#';
  const storageKey = 'regam-maths-learning-v1';
  let storageAvailable = true;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { storageAvailable = false; }
  const state = {
    favorites: new Set(arr(stored.favorites).filter(id => DATA.lessons.some(l => l.id === id))),
    progress: stored.progress && typeof stored.progress === 'object' && !Array.isArray(stored.progress) ? stored.progress : {},
    last: stored.last && typeof stored.last === 'object' ? stored.last : null,
    filter: 'all', filterRoute: '', route: null,
  };

  const paths = {
    home: '/', book: '/search', star: '/favorites', sources: '/sources',
    track: track => `/track/${slug(track)}`,
    domain: (track, domain) => `/track/${slug(track)}/domain/${slug(domain)}`,
    lesson: (track, lesson, tab = 'cours') => `/track/${slug(track)}/lesson/${slug(lesson)}/${tab}`,
  };
  const routeLink = path => '#' + path;
  const trackById = id => DATA.tracks.find(t => t.id === id);
  const lessonById = id => DATA.lessons.find(l => l.id === id);
  const domainById = id => arr(DATA.domains).find(d => d.id === id) || { id, title: id, titleAr: id };
  const lessonsFor = track => DATA.lessons.filter(l => arr(l.tracks).includes(track));
  const progressKey = (track, lesson) => `${track}:${lesson}`;
  const completed = (track, lesson) => Boolean(state.progress[progressKey(track, lesson)]);
  const favorite = lesson => state.favorites.has(lesson);
  const countExercises = lessons => lessons.reduce((sum, l) => sum + arr(l.exercises).length, 0);
  const countVideos = lessons => lessons.reduce((sum, l) => sum + arr(l.videos).filter(v => v.src).length, 0);
  const domainSymbol = id => ({ analyse: '∫', algebre: 'ℂ', geometrie: '△', probabilites: 'P' })[id] || '∑';
  const domainTitle = id => { const d = domainById(id); return d.titleAr || d.title || id; };
  const trackLabel = track => track?.nameAr || track?.name || '';
  const trackShort = track => track?.id === 'sm' ? 'Sciences Maths' : (track?.id === 'pc' ? 'PC / SVT' : track?.name || '');
  const availableTrack = lesson => {
    const desired = state.route?.track || state.last?.track;
    return arr(lesson.tracks).includes(desired) ? desired : arr(lesson.tracks)[0] || DATA.tracks[0]?.id;
  };

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ favorites: [...state.favorites], progress: state.progress, last: state.last }));
      storageAvailable = true;
      return true;
    } catch { storageAvailable = false; return false; }
  }

  const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    book: '<path d="M3 4.5c4-1.2 6.7-.7 9 1.1 2.3-1.8 5-2.3 9-1.1v15c-4-1.2-6.7-.7-9 1.1-2.3-1.8-5-2.3-9-1.1z"/><path d="M12 5.6v15"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    chevron: '<path d="m14 6-6 6 6 6"/>',
    play: '<path d="m9 5 10 7-10 7z"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    pen: '<path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15z"/>',
    sheet: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
    sources: '<path d="M8 3H4v18h16V7h-4M8 3h8v6H8zM8 13h8M8 17h5"/>',
    moon: '<path d="M21 13.2A9 9 0 0 1 10.8 3 9 9 0 1 0 21 13.2z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11v.1"/>',
    bulb: '<path d="M8.5 17h7M9 21h6M8 14c-1.5-1.2-2-2.6-2-4a6 6 0 0 1 12 0c0 1.4-.5 2.8-2 4-.7.7-1 1.2-1 3H9c0-1.8-.3-2.3-1-3z"/>',
    print: '<path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM16 11h1"/>',
    external: '<path d="M14 3h7v7M10 14 21 3M11 3H3v18h18v-8"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  };
  const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;

  // Curriculum files are authored, trusted site content. Search/user strings are escaped.
  function rich(value) {
    if (value == null) return '';
    // Keep authored HTML, but protect TeX from the HTML parser. Otherwise an
    // inequality such as 0<x<1 can become an accidental HTML element.
    if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g, esc);
    if (Array.isArray(value)) return value.map(v => `<p>${rich(v)}</p>`).join('');
    return `${value.title ? `<h3>${esc(value.title)}</h3>` : ''}${rich(value.body || value.html || value.text || value.statement || '')}${value.formula ? `<div class="math-block">${rich(value.formula)}</div>` : ''}`;
  }

  function prerequisiteHTML(item, lesson) {
    const prior = lessonById(item);
    if (!prior) return rich(item);
    const track = availableTrack(lesson);
    const destinationTrack = arr(prior.tracks).includes(track) ? track : arr(prior.tracks)[0];
    return `<a class="text-accent" href="${routeLink(paths.lesson(destinationTrack, prior.id))}">${esc(prior.title)}</a>`;
  }

  function mathIn(element) {
    if (typeof window.renderMathInElement !== 'function') return;
    window.renderMathInElement(element, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'video'],
    });
  }

  function renderSidebar() {
    const current = state.route || {};
    const completedAll = DATA.lessons.filter(l => arr(l.tracks).some(t => completed(t, l.id))).length;
    const percentage = DATA.lessons.length ? Math.round(completedAll / DATA.lessons.length * 100) : 0;
    document.getElementById('sidebar').innerHTML = `
      <a class="brand" href="#/" aria-label="REGAM Academy، الرئيسية">
        <span class="brand-mark" aria-hidden="true">∑</span><span><span class="brand-name">REGAM</span><span class="brand-sub">ACADEMY</span></span>
      </a>
      <nav aria-label="التنقل الرئيسي">
        <div class="side-nav">
          <a class="side-link ${current.type === 'home' ? 'active' : ''}" href="#/">${icon('grid')}<span>المكتبة ديالك</span></a>
          <a class="side-link ${current.type === 'search' ? 'active' : ''}" href="#/search">${icon('book')}<span>جميع الدروس</span><span class="count">${DATA.lessons.length}</span></a>
          <a class="side-link ${current.type === 'favorites' ? 'active' : ''}" href="#/favorites">${icon('star')}<span>دروسي المفضلة</span><span class="count">${state.favorites.size}</span></a>
        </div>
        <div class="side-section-label">اختار المسار ديالك</div>
        ${DATA.tracks.map(t => `<a class="side-track ${current.track === t.id ? 'active' : ''}" href="${routeLink(paths.track(t.id))}"><span class="track-monogram">${t.id === 'sm' ? 'SM' : 'PC'}</span><span><strong>${esc(t.name || t.id)}</strong><small>${esc(t.nameAr || (t.id === 'sm' ? 'العلوم الرياضية A و B' : 'الفيزياء وعلوم الحياة والأرض'))}</small></span></a>`).join('')}
        <div class="side-section-label">باش تقرا على بيّنة</div>
        <a class="side-link ${current.type === 'sources' ? 'active' : ''}" href="#/sources">${icon('sources')}<span>البرنامج والمراجع</span></a>
      </nav>
      <div class="side-bottom"><div class="local-progress"><div class="local-progress-label"><span>دروس علّمتيها كمراجَعة</span><span class="mono">${completedAll}/${DATA.lessons.length}</span></div><div class="progress-line" role="progressbar" aria-label="الدروس المراجعة" aria-valuemin="0" aria-valuemax="${DATA.lessons.length || 1}" aria-valuenow="${completedAll}"><i style="width:${percentage}%"></i></div><p>${storageAvailable ? 'التقدم والمفضلة محفوظين فهاد المتصفح فقط.' : 'التقدم متاح فهاد الجلسة. الحفظ المحلي ما متاحش.'}</p></div><div class="side-footnote">MATHÉMATIQUES · BAC MAROC</div></div>`;
    updateDrawerAccessibility();
  }

  function footer() {
    return `<footer class="site-footer"><span class="footer-name">REGAM ACADEMY</span><span>فهم، تطبيق، ومراجعة على حساب إيقاعك.</span><a href="#/sources">البرنامج والمراجع</a></footer>`;
  }

  function breadcrumb(items) {
    const all = [{ label: 'المكتبة', path: '/' }, ...items];
    return `<nav class="breadcrumbs" aria-label="مسار الصفحة">${all.map((item, i) => `${i ? icon('chevron') : ''}${item.path ? `<a href="${routeLink(item.path)}">${esc(item.label)}</a>` : `<span aria-current="page">${esc(item.label)}</span>`}`).join('')}</nav>`;
  }

  function graph() {
    return `<div class="graph-card"><div class="graph-top"><span>COMPRENDRE LA COURBE</span><span class="tiny-chip">ANALYSE</span></div><svg class="function-graph" viewBox="0 0 390 305" role="img" aria-labelledby="curve-title curve-desc"><title id="curve-title">منحنى الدالة f(x) = (x − 1)²</title><desc id="curve-desc">قطع مكافئ رأسه في النقطة (1، 0). المماس عند x = 1 أفقي.</desc><g stroke="#a8c6c324" stroke-width="1"><path d="M20 80H355M20 140H355M20 200H355M170 35V280M270 35V280"/></g><g stroke="#bdd3d170" stroke-width="1.3"><path d="M20 260H360M70 285V28"/><path d="m354 256 6 4-6 4M66 34l4-6 4 6"/></g><g fill="#afcbca" font-family="Arial,sans-serif" font-size="11"><text x="58" y="278">0</text><text x="166" y="278">1</text><text x="267" y="278">2</text><text x="365" y="264" font-style="italic">x</text><text x="63" y="22" font-style="italic">y</text></g><path d="M20 125 Q170 395 320 125" fill="none" stroke="#85dac1" stroke-width="3.5" stroke-linecap="round"/><path d="M113 260H227" stroke="#e8c482" stroke-width="2" stroke-dasharray="5 5"/><circle cx="170" cy="260" r="5.5" fill="#e8c482" stroke="#123d44" stroke-width="3"/><g fill="#e8c482" font-family="Georgia,serif" font-size="16" font-style="italic"><text x="246" y="89">f(x) = (x − 1)²</text><text x="147" y="230">f′(1) = 0</text></g></svg><div class="graph-bottom"><strong>La méthode avant la réponse.</strong><span>خطوة مفهومة، نتيجة واضحة.</span></div></div>`;
  }

  function renderHome() {
    let resume = '';
    const lastLesson = state.last && lessonById(state.last.lesson);
    if (lastLesson && arr(lastLesson.tracks).includes(state.last.track)) {
      resume = `<a class="continue-card" href="${routeLink(paths.lesson(state.last.track, lastLesson.id, state.last.tab || 'cours'))}"><span class="icon-box">${icon('book')}</span><span><small>كمل من آخر درس فتحتيه</small><strong>${esc(lastLesson.title)}</strong></span>${icon('arrow')}</a>`;
    }
    return `${resume}<section class="hero"><div class="hero-copy"><div class="page-eyebrow"><span class="dot"></span><span>المقرر المغربي · الثانية باكالوريا</span></div><h1>المات كتوضح،<br><em>خطوة بخطوة.</em></h1><p>اختار المسار ديالك، فهم الدرس بمثال، وخدم التمارين حتى تولّي الطريقة واضحة. الشرح بالدارجة والمصطلحات الرياضية بالفرنسية.</p><div class="hero-tags"><span class="tag">${icon('book')}دروس منظمة</span><span class="tag">${icon('sheet')}خلاصات للمراجعة</span><span class="tag">${icon('pen')}تمارين مصححة</span><span class="tag">${icon('video')}شرح بالفيديو</span></div></div>${graph()}</section>
      <section aria-labelledby="tracks-title"><div class="section-heading"><div><h2 id="tracks-title">من هنا كتبدا الرحلة ديالك</h2><p>كل مسار عندو الدروس والتمارين المناسبة ليه.</p></div><span class="section-kicker">CHOISIS TON PARCOURS</span></div><div class="track-grid">${DATA.tracks.map(track => {
        const lessons = lessonsFor(track.id);
        return `<a class="track-card ${track.id === 'sm' ? 'sm' : 'pc'}" href="${routeLink(paths.track(track.id))}"><div class="track-card-top"><span class="track-chip">2ᵉ année bac ${track.id === 'sm' ? '· A / B' : '· PC / SVT'}</span><span class="track-card-symbol" aria-hidden="true">${track.id === 'sm' ? '∑' : '∫'}</span></div><h3>${esc(track.name)}</h3><p class="track-ar">${esc(track.nameAr || track.description || '')}</p><div class="track-card-bottom"><span class="counts">${lessons.length} درس <span aria-hidden="true">·</span> ${countExercises(lessons)} تمرين مصحح</span><span class="arrow-button" aria-hidden="true">${icon('arrow')}</span></div></a>`;
      }).join('')}</div></section>
      <section class="learning-path" aria-label="طريقة الاستفادة من كل درس"><div class="path-step"><span class="step-no">01</span><div><strong>فهم الدرس</strong><span>الفكرة، القاعدة، والمثال.</span></div></div><div class="path-step"><span class="step-no">02</span><div><strong>شدّ الخلاصة</strong><span>النقط اللي خاصك تتذكر.</span></div></div><div class="path-step"><span class="step-no">03</span><div><strong>جرّب بيدك</strong><span>خدم قبل ما تفتح التصحيح.</span></div></div><div class="path-step"><span class="step-no">04</span><div><strong>شوف الخطوات</strong><span>رجع للفيديو فالوقت اللي تحتاج.</span></div></div></section>
      <p class="source-domain-note">الدروس مرتبة حسب المسار. الأعداد العقدية كاينة فـ <strong>Algèbre</strong>، و <strong>l’étude de fonction</strong> فـ <strong>Analyse</strong>. <a class="text-accent" href="#/sources">شوف خريطة البرنامج والمراجع ${icon('chevron')}</a></p>`;
  }

  function renderDomainCards(track, selected) {
    const lessons = lessonsFor(track.id);
    return `<div class="domain-grid">${arr(DATA.domains).filter(d => lessons.some(l => l.domain === d.id)).map(d => `<a class="domain-card ${selected === d.id ? 'active' : ''}" href="${routeLink(paths.domain(track.id, d.id))}"><span class="domain-symbol" aria-hidden="true">${domainSymbol(d.id)}</span><strong>${esc(d.title)}</strong><span>${esc(d.titleAr || '')} · ${lessons.filter(l => l.domain === d.id).length} دروس</span></a>`).join('')}</div>`;
  }

  function favoriteButton(lesson) {
    return `<button class="favorite-button" type="button" data-favorite="${esc(lesson.id)}" aria-pressed="${favorite(lesson.id)}" aria-label="${favorite(lesson.id) ? 'حيد من المفضلة' : 'زيد للمفضلة'}: ${esc(lesson.title)}" title="${favorite(lesson.id) ? 'حيد من المفضلة' : 'زيد للمفضلة'}">${icon('star')}</button>`;
  }

  function lessonCard(lesson, track, index = 0, showTrack = false) {
    const link = routeLink(paths.lesson(track, lesson.id));
    const videoCount = arr(lesson.videos).filter(v => v.src).length;
    return `<article class="lesson-card"><div class="lesson-card-top"><span class="lesson-index">${String(index + 1).padStart(2, '0')} / ${esc(domainById(lesson.domain).title)}</span>${favoriteButton(lesson)}</div><a href="${link}"><h3>${esc(lesson.title)}</h3><p class="lesson-ar">${esc(lesson.titleAr || '')}</p></a>${showTrack ? `<div class="search-match-track">${arr(lesson.tracks).map(id => esc(trackShort(trackById(id)))).join(' · ')}</div>` : ''}<div class="lesson-card-footer"><div class="lesson-card-meta">${lesson.duration ? `<span>${icon('clock')}${esc(lesson.duration)} د</span>` : ''}<span>${icon('pen')}${arr(lesson.exercises).length} تمارين</span>${videoCount ? `<span>${icon('video')}${videoCount}</span>` : ''}${completed(track, lesson.id) ? `<span class="completed-label">${icon('circleCheck')}تراجع</span>` : ''}</div><a class="lesson-link" href="${link}">افتح الدرس ${icon('arrow')}</a></div></article>`;
  }

  function filterLessons(lessons, track) {
    if (state.filter === 'favorites') return lessons.filter(l => favorite(l.id));
    if (state.filter === 'remaining') return lessons.filter(l => !completed(track || availableTrack(l), l.id));
    if (state.filter === 'completed') return lessons.filter(l => completed(track || availableTrack(l), l.id));
    return lessons;
  }

  function toolbar(count) {
    return `<div class="catalog-toolbar"><div class="filter-pills" role="group" aria-label="تصفية الدروس">${[['all', 'الكل'], ['remaining', 'باقي نراجع'], ['completed', 'تراجعو'], ['favorites', 'المفضلة']].map(([id, label]) => `<button class="filter-pill ${state.filter === id ? 'active' : ''}" data-filter="${id}" type="button" aria-pressed="${state.filter === id}">${label}</button>`).join('')}</div><span class="toolbar-count">${count} ${count === 1 ? 'درس' : 'دروس'} فهاد اللائحة</span></div>`;
  }

  function empty(title, body, action) {
    return `<section class="empty-state">${icon('book')}<h2>${esc(title)}</h2><p>${esc(body)}</p>${action || ''}</section>`;
  }

  function renderTrack(route) {
    const track = trackById(route.track);
    if (!track) return notFound();
    const all = lessonsFor(track.id);
    const domain = route.domain && domainById(route.domain);
    const scoped = route.domain ? all.filter(l => l.domain === route.domain) : all;
    const visible = filterLessons(scoped, track.id);
    const crumbs = [{ label: trackShort(track), path: route.domain ? paths.track(track.id) : null }];
    if (domain) crumbs.push({ label: domain.title, path: null });
    return `${breadcrumb(crumbs)}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${esc(trackLabel(track))}</div><h1 class="fr-title">${esc(domain ? domain.title : track.name)}</h1><p>${esc(domain ? domain.titleAr || '' : track.description || 'اختار المحور، ومن بعد الدرس. كل صفحة كتجمع الشرح والخلاصة والتطبيق باش تبقى الفكرة مترابطة.')}</p></div><span class="small-badge">${scoped.length} درس · ${countVideos(scoped)} فيديو</span></div>${renderDomainCards(track, route.domain)}${toolbar(visible.length)}${visible.length ? (route.domain || state.filter !== 'all' ? `<div class="lesson-grid">${visible.map((l, i) => lessonCard(l, track.id, i)).join('')}</div>` : arr(DATA.domains).filter(d => visible.some(l => l.domain === d.id)).map(d => `<section class="catalog-section"><div class="catalog-section-title"><h2><span aria-hidden="true">${domainSymbol(d.id)}</span>${esc(d.title)} <small class="muted" style="font-size:11px;font-weight:400">${esc(d.titleAr || '')}</small></h2><a href="${routeLink(paths.domain(track.id, d.id))}">شوف المحور ${icon('chevron')}</a></div><div class="lesson-grid">${visible.filter(l => l.domain === d.id).map((l, i) => lessonCard(l, track.id, i)).join('')}</div></section>`).join('')) : empty('ما كاين حتى درس بهاد الاختيار', 'جرّب تصفية أخرى باش ترجع تشوف الدروس.', '<button class="button secondary small" type="button" data-filter="all">عرض جميع الدروس</button>')}`;
  }

  function exampleHTML(example) {
    if (!example) return '';
    return `<div class="example"><div class="example-heading">${icon('pen')}<span>${esc(example.title || 'مثال مشروح')}</span></div><div class="example-content">${example.statement ? `<div class="example-statement prose">${rich(example.statement)}</div>` : ''}${stepsHTML(example.steps)}${example.answer != null ? `<div class="answer-box"><strong>النتيجة</strong>${rich(example.answer)}</div>` : ''}</div></div>`;
  }

  function stepsHTML(steps) {
    return arr(steps).length ? `<ol class="solution-steps">${steps.map(step => `<li>${rich(step)}</li>`).join('')}</ol>` : '';
  }

  function pitfallsHTML(lesson) {
    return arr(lesson.pitfalls).length ? `<aside class="pitfalls"><h2>${icon('info')}ردّ بالك من هاد النقط</h2><ul>${lesson.pitfalls.map(p => `<li>${rich(p)}</li>`).join('')}</ul></aside>` : '';
  }

  function courseHTML(lesson) {
    const sections = arr(lesson.sections);
    return `<div class="lesson-layout"><div class="lesson-body">${lesson.intro ? `<div class="intro-panel prose">${rich(lesson.intro)}</div>` : ''}${arr(lesson.goals).length || arr(lesson.prerequisites).length ? `<section class="goals"><h2>من بعد هاد الدرس، تقدر...</h2><ul>${arr(lesson.goals).map(goal => `<li>${icon('check')}<span>${rich(goal)}</span></li>`).join('')}</ul>${arr(lesson.prerequisites).length ? `<div class="prerequisites"><strong>قبل ما تبدا</strong> · ${lesson.prerequisites.map(p => prerequisiteHTML(p, lesson)).join('، ')}</div>` : ''}</section>` : ''}${sections.map((section, i) => `<section class="course-section" id="lesson-section-${i}"><div class="section-title-row"><span class="section-number">${String(i + 1).padStart(2, '0')}</span><h2>${esc(section.title)}</h2></div><div class="prose">${rich(section.body)}</div>${exampleHTML(section.example)}${arr(section.examples).map(exampleHTML).join('')}</section>`).join('')}${pitfallsHTML(lesson)}</div>${sections.length > 2 ? `<aside class="lesson-toc" aria-label="داخل الدرس"><div class="overline">داخل هاد الدرس</div>${sections.map((s, i) => `<button type="button" data-scrollto="lesson-section-${i}"><span class="toc-number">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</button>`).join('')}</aside>` : ''}</div>`;
  }

  function summaryHTML(lesson) {
    return `<div class="summary-top"><div><h2>الخلاصة اللي ترجع ليها</h2><p>راجع القواعد والشروط، ومن بعد جرّب تطبقهم بلا ما تشوف الحل.</p></div><button class="button secondary small" type="button" data-print>${icon('print')}طبع الخلاصة</button></div><div class="summary-grid">${arr(lesson.summary).map((item, i) => `<div class="summary-item"><span class="summary-no">${String(i + 1).padStart(2, '0')}</span><div class="prose">${rich(item)}</div></div>`).join('')}</div>${pitfallsHTML(lesson)}`;
  }

  function exercisesHTML(lesson) {
    const exercises = arr(lesson.exercises);
    return `<p class="exercise-count-note">خدم فالكراسة أولاً. إلا توقفتي، افتح التلميح. التصحيح كيبقى مخبّي حتى تختار تشوفو.</p>${exercises.map((ex, i) => `<article class="exercise-card"><div class="exercise-header"><h2>${esc(ex.title || `تمرين ${i + 1}`)}</h2>${ex.level ? `<span class="exercise-level">${esc(ex.level)}</span>` : ''}</div><div class="exercise-content"><div class="prose">${rich(ex.statement)}</div>${ex.hint ? `<details class="hint-details"><summary>${icon('bulb')}بغيت غير تلميح</summary><div class="hint prose">${rich(ex.hint)}</div></details>` : ''}<details class="solution-details"><summary>${icon('pen')}شوف التصحيح خطوة بخطوة</summary><div class="solution-inner">${stepsHTML(ex.steps || ex.correction?.steps)}${ex.answer != null || ex.correction?.answer != null ? `<div class="answer-box"><strong>الجواب النهائي</strong>${rich(ex.answer ?? ex.correction.answer)}</div>` : ''}</div></details></div></article>`).join('')}${!exercises.length ? empty('الشرح هو نقطة البداية', 'راجع أمثلة الدرس والخلاصة باش ترسخ الطريقة.') : ''}${quizHTML(lesson)}`;
  }

  function quizHTML(lesson) {
    const quiz = arr(lesson.quiz);
    return quiz.length ? `<section class="quiz-section"><h2>تأكد من الفهم ديالك</h2>${quiz.map((q, i) => `<form class="quiz-card" data-quiz="${i}" data-lesson="${esc(lesson.id)}"><h3>${rich(q.question)}</h3><div class="quiz-options">${arr(q.choices).map((choice, ci) => `<label class="quiz-option"><input type="radio" name="answer" value="${ci}" required><span>${rich(choice)}</span></label>`).join('')}</div><div class="quiz-actions"><button class="button small" type="submit">صحّح جوابي ${icon('check')}</button></div><div class="quiz-feedback" role="status" hidden></div></form>`).join('')}</section>` : '';
  }

  function videoDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const seconds = Math.round(value);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return value ? String(value) : '';
  }

  function videosHTML(lesson) {
    const videos = arr(lesson.videos).filter(v => v.src);
    if (!videos.length) return empty('هاد الدرس متوفر بالشرح المكتوب', 'الأمثلة والتمارين المصححة كاينين فهاد الصفحة. ما كاينش فيديو مرفق به حالياً.');
    const formatNote = videos.every(video => video.silent) ? 'هاد الشرح بصري مكتوب بلا تعليق صوتي. تقدر توقف كل خطوة وتبدّل سرعة العرض.' : videos.some(video => video.silent) ? 'نوع الشرح مبيّن تحت كل فيديو: صوتي أو بصري مكتوب بلا تعليق صوتي.' : 'تقدر تتحكم فالسرعة والصوت من المشغّل.';
    return `<p class="video-info-note">شوف المثال مع الكراسة، وقف الفيديو عند كل خطوة وجرّب تكمل بوحدك. ${formatNote}</p><div class="video-grid">${videos.map(video => `<article class="video-card"><div class="video-stage"><video controls playsinline preload="metadata" ${video.poster ? `poster="${esc(safeURL(video.poster))}"` : ''} aria-label="${esc(video.title)}"><source src="${esc(safeURL(video.src))}" type="video/mp4">${arr(video.tracks).map(t => `<track kind="captions" src="${esc(safeURL(t.src))}" srclang="${esc(t.language || 'ar')}" label="${esc(t.label || 'العربية')}">`).join('')}المتصفح ما كيدعمش تشغيل الفيديو. استعمل رابط فتح الفيديو اللي تحت.</video></div><div class="video-card-info"><h2>${esc(video.title)}</h2>${video.description ? `<p>${esc(video.description)}</p>` : ''}<div class="video-card-meta">${video.duration ? `<span class="mono">${icon('clock')} ${esc(videoDuration(video.duration))}</span>` : ''}${video.silent ? '<span>شرح بصري بلا تعليق صوتي</span>' : video.label ? `<span>${esc(video.label)}</span>` : ''}<a href="${esc(safeURL(video.src))}" target="_blank" rel="noopener">فتح الفيديو ${icon('external')}</a></div></div></article>`).join('')}</div>`;
  }

  function lessonFooter(lesson, track) {
    const list = lessonsFor(track.id);
    const index = list.findIndex(l => l.id === lesson.id);
    const previous = list[index - 1];
    const next = list[index + 1];
    return `<section class="lesson-finish"><div><strong>${completed(track.id, lesson.id) ? 'هاد الدرس معلّم كمراجَع.' : 'ساليت المراجعة ديال هاد الدرس؟'}</strong><small>هاد العلامة كتعاونك تنظم خدمتك، والتقدم كيبقى فهاد المتصفح.</small></div><button class="button ${completed(track.id, lesson.id) ? 'secondary' : ''}" type="button" data-complete="${esc(lesson.id)}" data-track="${esc(track.id)}" aria-pressed="${completed(track.id, lesson.id)}">${icon(completed(track.id, lesson.id) ? 'circleCheck' : 'check')}${completed(track.id, lesson.id) ? 'رجّعو للائحة المراجعة' : 'علّم الدرس كمراجَع'}</button></section><nav class="lesson-next" aria-label="الدروس المتتالية">${previous ? `<a href="${routeLink(paths.lesson(track.id, previous.id))}"><small>الدرس السابق</small><strong>${esc(previous.title)}</strong></a>` : ''}${next ? `<a href="${routeLink(paths.lesson(track.id, next.id))}"><small>الدرس الموالي</small><strong>${esc(next.title)}</strong></a>` : `<a href="${routeLink(paths.track(track.id))}"><small>كمل على حساب برنامجك</small><strong>رجع للائحة الدروس</strong></a>`}</nav>`;
  }

  function renderLesson(route) {
    const track = trackById(route.track);
    const lesson = lessonById(route.lesson);
    if (!track || !lesson || !arr(lesson.tracks).includes(track.id)) return notFound();
    const tab = ['cours', 'resume', 'exercices', 'videos'].includes(route.tab) ? route.tab : 'cours';
    state.last = { track: track.id, lesson: lesson.id, tab };
    persist();
    document.title = `${lesson.title} | REGAM Academy`;
    const tabContent = { cours: courseHTML, resume: summaryHTML, exercices: exercisesHTML, videos: videosHTML }[tab](lesson);
    return `${breadcrumb([{ label: trackShort(track), path: paths.track(track.id) }, { label: domainById(lesson.domain).title, path: paths.domain(track.id, lesson.domain) }, { label: lesson.title }])}<div class="print-only">REGAM Academy · ${esc(track.name)} · ${esc(lesson.title)}</div><header class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${esc(domainTitle(lesson.domain))} · ${esc(lesson.titleAr || '')}</div><h1 class="fr-title">${esc(lesson.title)}</h1><div class="lesson-meta"><span>${icon('book')}${esc(trackShort(track))}</span>${lesson.duration ? `<span>${icon('clock')}حوالي ${esc(lesson.duration)} دقيقة للمراجعة</span>` : ''}<span>${icon('pen')}${arr(lesson.exercises).length} تمارين</span>${lesson.level ? `<span>${esc(lesson.level)}</span>` : ''}</div></div><div class="lesson-heading-actions">${favoriteButton(lesson)}<button class="icon-button" type="button" data-print title="طبع خلاصة الدرس" aria-label="طبع خلاصة الدرس">${icon('print')}</button></div></header><nav class="lesson-tabs" aria-label="أجزاء الدرس">${[['cours', 'الدرس', 'book', null], ['resume', 'الخلاصة', 'sheet', null], ['exercices', 'التمارين', 'pen', arr(lesson.exercises).length], ['videos', 'الفيديو', 'video', arr(lesson.videos).filter(v => v.src).length]].map(([id, label, symbol, count]) => `<a class="lesson-tab ${tab === id ? 'active' : ''}" href="${routeLink(paths.lesson(track.id, lesson.id, id))}" ${tab === id ? 'aria-current="page"' : ''}>${icon(symbol)}${label}${count != null ? `<span class="tab-count">${count}</span>` : ''}</a>`).join('')}</nav><div id="lesson-tab-panel">${tabContent}</div>${lessonFooter(lesson, track)}`;
  }

  function searchLessons(query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return DATA.lessons.filter(lesson => {
      const haystack = normalize([lesson.title, lesson.titleAr, domainById(lesson.domain).title, domainTitle(lesson.domain), ...arr(lesson.tags)].join(' '));
      return terms.every(term => haystack.includes(term));
    });
  }

  function renderSearch(route) {
    const query = route.query || '';
    const found = searchLessons(query);
    const visible = filterLessons(found);
    return `${breadcrumb([{ label: 'جميع الدروس' }])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>المكتبة كاملة</div><h1>قلب على الفكرة اللي محتاج</h1><p>كتب اسم الدرس بالعربية أو بالفرنسية. المسار مبيّن تحت كل درس.</p></div></div><form class="search-page-form" id="search-page-form" role="search"><label class="sr-only" for="page-search">البحث فالدروس</label><input id="page-search" name="q" type="search" value="${esc(query)}" placeholder="مثلاً: dérivation، الأعداد العقدية..." autocomplete="off"><button class="button" type="submit">${icon('search')}بحث</button></form>${toolbar(visible.length)}${visible.length ? `<div class="lesson-grid">${visible.map((lesson, i) => lessonCard(lesson, availableTrack(lesson), i, true)).join('')}</div>` : empty('ما لقيناش درس بهاد الكلمات', 'جرّب اسم أقصر، أو قلّب بالعربية أو بالفرنسية.')} `;
  }

  function renderFavorites() {
    const lessons = DATA.lessons.filter(l => favorite(l.id));
    return `${breadcrumb([{ label: 'المفضلة' }])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>مراجعة منظمة</div><h1>دروسي المفضلة</h1><p>نجمعو هنا الدروس اللي علّمتي بالنجمة. هاد اللائحة محفوظة فالمتصفح ديالك.</p></div><span class="small-badge">${lessons.length} دروس</span></div>${lessons.length ? `<div class="lesson-grid">${lessons.map((lesson, i) => lessonCard(lesson, availableTrack(lesson), i, true)).join('')}</div>` : empty('اللائحة ديالك باقية خاوية', 'من لائحة الدروس، كليكي على النجمة حدا أي درس باش ترجع ليه بسهولة.', '<a class="button" href="#/search">شوف الدروس ' + icon('arrow') + '</a>')}`;
  }

  function renderSources() {
    const sources = arr(DATA.sources);
    return `${breadcrumb([{ label: 'البرنامج والمراجع' }])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>محتوى تعليمي مستقل</div><h1>البرنامج والمراجع</h1><p>باش يكون واضح شنو كيتقرا فكل مسار، وشنو هي المراجع اللي اعتمد عليها تنظيم هاد المكتبة.</p></div></div><div class="sources-intro prose">${rich(DATA.meta?.curriculumNote || 'هاد الموقع كيجمع دروساً وتمارين أصلية للرياضيات فالثانية باكالوريا بالمغرب. المساران مفصولان باش تلقى المحتوى المناسب للشعبة ديالك. الدروس ماشي وثائق رسمية، وما كتعوضش التوجيهات ديال الأستاذ والإطار المرجعي المعتمد للامتحان.')} ${DATA.meta?.updated ? `<p class="muted">آخر تحيين للمحتوى: ${esc(DATA.meta.updated)}</p>` : ''}</div>${sources.map(source => `<article class="source-card"><h2>${esc(source.title || source.name || 'مرجع البرنامج')}</h2>${source.dateNote ? `<p>${esc(source.dateNote)}</p>` : ''}${source.description || source.note ? `<p>${esc(source.description || source.note)}</p>` : ''}${source.url ? `<a href="${esc(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">فتح المرجع ${icon('external')}</a>` : ''}</article>`).join('')}<p class="source-domain-note">التقدم والمفضلة كيتحفظو محلياً فالمتصفح. ما كاين حتى حساب طالب ولا إرسال لنقط التمارين. إلا مسحتي بيانات المتصفح، غادي تمسح هاد الاختيارات المحلية.</p>`;
  }

  function notFound() {
    document.title = 'الصفحة غير موجودة | REGAM Academy';
    return empty('هاد الصفحة ما لقيناهاش', 'رجع للمكتبة واختار المسار والدرس من اللائحة.', '<a class="button" href="#/">رجع للمكتبة ' + icon('arrow') + '</a>');
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map(decode);
    if (!parts.length) return { type: 'home' };
    if (parts[0] === 'track' && parts[1]) {
      if (parts[2] === 'lesson' && parts[3]) return { type: 'lesson', track: parts[1], lesson: parts[3], tab: parts[4] || 'cours' };
      if (parts[2] === 'domain' && parts[3]) return { type: 'track', track: parts[1], domain: parts[3] };
      if (!parts[2]) return { type: 'track', track: parts[1] };
    }
    if (parts[0] === 'search') return { type: 'search', query: new URLSearchParams(query).get('q') || '' };
    if (parts[0] === 'favorites') return { type: 'favorites' };
    if (parts[0] === 'sources') return { type: 'sources' };
    return { type: 'notfound' };
  }

  function renderRoute(options = {}) {
    const y = window.scrollY;
    const route = parseRoute();
    state.route = route;
    const filterRoute = location.hash.split('?')[0];
    if (state.filterRoute !== filterRoute) { state.filter = 'all'; state.filterRoute = filterRoute; }
    document.title = 'REGAM Academy | الرياضيات للباك المغربي';
    const main = document.getElementById('main-content');
    const views = { home: renderHome, track: renderTrack, lesson: renderLesson, search: renderSearch, favorites: renderFavorites, sources: renderSources, notfound: notFound };
    main.innerHTML = views[route.type](route) + footer();
    mathIn(main);
    renderSidebar();
    closeDrawer();
    if (options.keepScroll) window.scrollTo({ top: y, behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const button = document.getElementById('theme-button');
    button.innerHTML = icon(dark ? 'sun' : 'moon');
    button.setAttribute('aria-label', dark ? 'فعّل الوضع النهاري' : 'فعّل الوضع الليلي');
    button.title = dark ? 'الوضع النهاري' : 'الوضع الليلي';
  }

  function updateDrawerAccessibility() {
    const mobile = window.matchMedia('(max-width: 780px)').matches;
    const sidebar = document.getElementById('sidebar');
    const open = sidebar.classList.contains('is-open');
    sidebar.inert = mobile && !open;
    sidebar.setAttribute('aria-hidden', String(mobile && !open));
    document.getElementById('menu-button').setAttribute('aria-expanded', String(open));
  }

  function closeDrawer() {
    document.getElementById('sidebar').classList.remove('is-open');
    document.getElementById('drawer-scrim').classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    updateDrawerAccessibility();
  }

  function toggleDrawer() {
    const sidebar = document.getElementById('sidebar');
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    document.getElementById('drawer-scrim').classList.toggle('is-open', open);
    document.body.classList.toggle('no-scroll', open);
    updateDrawerAccessibility();
    if (open) sidebar.querySelector('a')?.focus();
  }

  function searchDialogResults(query) {
    const list = searchLessons(query).slice(0, 12);
    const target = document.getElementById('search-dialog-results');
    target.innerHTML = list.length ? list.map(lesson => `<a class="search-result" href="${routeLink(paths.lesson(availableTrack(lesson), lesson.id))}"><span class="result-symbol" aria-hidden="true">${domainSymbol(lesson.domain)}</span><span><strong>${esc(lesson.title)}</strong><small>${esc(lesson.titleAr || '')} · ${arr(lesson.tracks).map(id => esc(trackShort(trackById(id)))).join(' / ')}</small></span>${icon('arrow')}</a>`).join('') : '<p class="search-dialog-note">ما لقيناش درس بهاد الكلمات. جرّب كلمة أخرى.</p>';
    document.getElementById('search-dialog-count').textContent = query ? `${searchLessons(query).length} نتائج` : 'اختار درس أو كتب باش تقلّب';
  }

  function openSearch() {
    closeDrawer();
    const dialog = document.getElementById('search-dialog');
    const input = document.getElementById('dialog-search');
    searchDialogResults(input.value);
    if (!dialog.open) dialog.showModal();
    input.focus();
    input.select();
  }

  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 3500);
  }

  app.innerHTML = `<aside class="sidebar" id="sidebar" aria-label="المكتبة والمسارات"></aside><div class="drawer-scrim" id="drawer-scrim" aria-hidden="true"></div><div class="app-shell"><header class="topbar"><button class="icon-button mobile-menu" id="menu-button" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="فتح لائحة المسارات">${icon('menu')}</button><span class="topbar-label">فضاء الرياضيات <span class="muted">/</span> الباك المغربي</span><button class="search-launch" id="search-launch" type="button">${icon('search')}<span>قلّب على درس أو فكرة...</span><kbd>⌘ K</kbd></button><button class="icon-button" id="theme-button" type="button" aria-label="الوضع الليلي"></button></header><main class="main-wrap" id="main-content" tabindex="-1"></main></div><dialog class="search-dialog" id="search-dialog" aria-labelledby="search-dialog-label"><form id="dialog-search-form"><div class="search-dialog-top">${icon('search')}<label class="sr-only" id="search-dialog-label" for="dialog-search">قلّب فدروس الرياضيات</label><input type="search" id="dialog-search" placeholder="اسم الدرس بالعربية أو بالفرنسية..." autocomplete="off"><button class="icon-button" type="button" id="close-search" aria-label="سدّ البحث">${icon('close')}</button></div></form><div class="search-dialog-results" id="search-dialog-results"></div><div class="search-dialog-footer"><span id="search-dialog-count"></span><span>Enter للائحة كاملة · Esc للإغلاق</span></div></dialog>`;

  updateThemeButton();
  renderRoute();

  window.addEventListener('hashchange', () => {
    document.getElementById('search-dialog').close();
    renderRoute();
    document.getElementById('main-content').focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 780px)').matches) closeDrawer();
    else updateDrawerAccessibility();
  });
  document.getElementById('menu-button').addEventListener('click', toggleDrawer);
  document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);
  document.getElementById('search-launch').addEventListener('click', openSearch);
  document.getElementById('close-search').addEventListener('click', () => document.getElementById('search-dialog').close());
  document.getElementById('search-dialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.getElementById('dialog-search').addEventListener('input', event => searchDialogResults(event.target.value));
  document.getElementById('theme-button').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('regam-maths-theme', next); } catch { /* Theme still works for this visit. */ }
    updateThemeButton();
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    const drawer = document.getElementById('sidebar');
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) { closeDrawer(); document.getElementById('menu-button').focus(); }
    if (event.key === 'Tab' && drawer.classList.contains('is-open')) {
      const focusable = [...drawer.querySelectorAll('a[href],button:not([disabled])')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  document.addEventListener('click', event => {
    const skip = event.target.closest('.skip-link');
    if (skip) { event.preventDefault(); document.getElementById('main-content').focus(); return; }
    const favoriteTarget = event.target.closest('[data-favorite]');
    if (favoriteTarget) {
      const id = favoriteTarget.dataset.favorite;
      if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
      const saved = persist();
      renderRoute({ keepScroll: true });
      toast(saved ? (state.favorites.has(id) ? 'تزاد الدرس للمفضلة.' : 'تحيّد الدرس من المفضلة.') : 'تبدلات المفضلة فهاد الجلسة. الحفظ المحلي ما متاحش.');
      return;
    }
    const completeTarget = event.target.closest('[data-complete]');
    if (completeTarget) {
      const key = progressKey(completeTarget.dataset.track, completeTarget.dataset.complete);
      state.progress[key] = !state.progress[key];
      const saved = persist();
      renderRoute({ keepScroll: true });
      toast(saved ? (state.progress[key] ? 'تسجّل الدرس كمراجَع فهاد المتصفح.' : 'رجع الدرس للائحة المراجعة.') : 'التقدم تبدّل فهاد الجلسة. الحفظ المحلي ما متاحش.');
      return;
    }
    const filterTarget = event.target.closest('[data-filter]');
    if (filterTarget) { state.filter = filterTarget.dataset.filter; renderRoute({ keepScroll: true }); return; }
    const scrollTarget = event.target.closest('[data-scrollto]');
    if (scrollTarget) { document.getElementById(scrollTarget.dataset.scrollto)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); return; }
    if (event.target.closest('[data-print]') && state.route?.type === 'lesson') {
      if (state.route.tab !== 'resume') {
        location.hash = routeLink(paths.lesson(state.route.track, state.route.lesson, 'resume'));
        window.setTimeout(() => window.print(), 250);
      } else window.print();
    }
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id === 'search-page-form' || form.id === 'dialog-search-form') {
      event.preventDefault();
      const value = form.id === 'search-page-form' ? document.getElementById('page-search').value : document.getElementById('dialog-search').value;
      document.getElementById('search-dialog').close();
      location.hash = '#/search?q=' + encodeURIComponent(value.trim());
      return;
    }
    if (form.matches('[data-quiz]')) {
      event.preventDefault();
      const question = lessonById(form.dataset.lesson)?.quiz?.[Number(form.dataset.quiz)];
      if (!question) return;
      const selected = new FormData(form).get('answer');
      if (selected == null) return;
      const index = Number(selected);
      const right = Number(question.correct);
      const good = index === right;
      form.querySelectorAll('.quiz-option').forEach((label, i) => { label.classList.toggle('correct', i === right); label.classList.toggle('incorrect', i === index && !good); });
      const feedback = form.querySelector('.quiz-feedback');
      feedback.hidden = false;
      feedback.className = 'quiz-feedback ' + (good ? 'good' : 'retry');
      feedback.innerHTML = `<strong>${good ? 'صحيح، الفكرة واضحة.' : 'جرّب تفهم علاش هاد الاختيار ما مناسبش.'}</strong>${question.explanation ? `<div>${rich(question.explanation)}</div>` : ''}`;
      mathIn(feedback);
    }
  });
})();
