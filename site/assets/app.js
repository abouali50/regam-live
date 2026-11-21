/* REGAM Academy. Static, local-first navigation. No tracking or remote requests. */
(() => {
  'use strict';

  const LOCALES = window.REGAM_LOCALES || { ar: window.REGAM_DATA };
  let savedLanguage = 'ar';
  try { savedLanguage = localStorage.getItem('regam-maths-language') || 'ar'; } catch {}
  let LANG = new URLSearchParams(location.search).get('lang') || savedLanguage;
  if (!['ar', 'fr', 'en'].includes(LANG) || !LOCALES[LANG]) LANG = 'ar';
  let DATA = LOCALES[LANG];
  window.REGAM_DATA = DATA;
  const t = (key, values = {}) => {
    const message = window.REGAM_I18N?.[LANG]?.[key] ?? window.REGAM_I18N?.ar?.[key] ?? key;
    return String(message).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  };
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  const app = document.getElementById('app');
  if (!DATA || !Array.isArray(DATA.lessons) || !Array.isArray(DATA.tracks)) {
    app.innerHTML = `<main class="loading-error"><h1>REGAM Academy</h1><p>${t('loadError')}</p></main>`;
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
    home: '/', book: '/search', star: '/favorites', sources: '/sources', videos: '/videos',
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
  const trackShort = track => track?.id === 'sm' ? 'SM A / B' : (track?.id === 'pc' ? 'PC / SVT' : track?.name || '');
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
  const icon = (name, className = '') => `<svg class="icon icon-${name} ${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;

  // Curriculum files are authored, trusted site content. Search/user strings are escaped.
  function rich(value) {
    if (value == null) return '';
    if (LANG === 'en' && typeof value === 'string') value = value.replaceAll('\\mathrm{PGCD}', '\\gcd').replaceAll('\\mathrm{PPCM}', '\\operatorname{lcm}');
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
    const done = DATA.lessons.filter(l => arr(l.tracks).some(track => completed(track, l.id))).length;
    const nav = [['home','/','grid','myLibrary',null],['search','/search','book','allLessons',DATA.lessons.length],['videos','/videos','video','videoLibrary',countVideos(DATA.lessons)],['favorites','/favorites','star','myFavorites',state.favorites.size]];
    document.getElementById('sidebar').innerHTML = `<a class="brand" href="#/" aria-label="REGAM Academy"><span class="brand-mark" aria-hidden="true">∑</span><span><span class="brand-name">REGAM</span><span class="brand-sub">ACADEMY</span></span></a><nav aria-label="${t('mainNavigation')}"><div class="side-nav">${nav.map(([type,url,symbol,label,count])=>`<a class="side-link ${current.type===type?'active':''}" href="#${url}">${icon(symbol)}<span>${t(label)}</span>${count!=null?`<span class="count">${count}</span>`:''}</a>`).join('')}</div><div class="side-section-label">${t('chooseTrack')}</div>${DATA.tracks.map(track=>`<a class="side-track ${current.track===track.id?'active':''}" href="${routeLink(paths.track(track.id))}"><span class="track-monogram">${track.id==='sm'?'SM':'PC'}</span><span><strong>${esc(track.name)}</strong><small>${trackShort(track)}</small></span></a>`).join('')}<div class="side-section-label">${t('curriculum')}</div><a class="side-link ${current.type==='sources'?'active':''}" href="#/sources">${icon('sources')}<span>${t('curriculum')}</span></a></nav><div class="side-bottom"><div class="local-progress"><div class="local-progress-label"><span>${t('reviewedLessons')}</span><span class="mono">${done}/${DATA.lessons.length}</span></div><div class="progress-line" role="progressbar" aria-label="${t('reviewedLessons')}" aria-valuemin="0" aria-valuemax="${DATA.lessons.length}" aria-valuenow="${done}"><i style="width:${Math.round(done/DATA.lessons.length*100)}%"></i></div><p>${t(storageAvailable?'localSaved':'localUnavailable')}</p></div></div>`;
    updateDrawerAccessibility();
  }

  function footer() { return `<footer class="site-footer"><span class="footer-name">REGAM ACADEMY</span><span>${t('footer')}</span><a href="#/sources">${t('curriculum')}</a></footer>`; }

  function breadcrumb(items) {
    return `<nav class="breadcrumbs" aria-label="${t('pagePath')}">${[{label:t('library'),path:'/'},...items].map((item,i)=>`${i?icon('chevron'):''}${item.path?`<a href="${routeLink(item.path)}">${esc(item.label)}</a>`:`<span aria-current="page">${esc(item.label)}</span>`}`).join('')}</nav>`;
  }

  function graph() {
    return `<div class="graph-card"><div class="graph-top"><span>${t('graphHeading')}</span><span class="tiny-chip">${esc(domainTitle("analyse"))}</span></div><svg class="function-graph" viewBox="0 0 390 305" role="img" aria-labelledby="curve-title curve-desc"><title id="curve-title">${t('graphTitle')}</title><desc id="curve-desc">${t('graphDescription')}</desc><g stroke="#a8c6c324" stroke-width="1"><path d="M20 80H355M20 140H355M20 200H355M170 35V280M270 35V280"/></g><g stroke="#bdd3d170" stroke-width="1.3"><path d="M20 260H360M70 285V28"/><path d="m354 256 6 4-6 4M66 34l4-6 4 6"/></g><g fill="#afcbca" font-family="Arial,sans-serif" font-size="11"><text x="58" y="278">0</text><text x="166" y="278">1</text><text x="267" y="278">2</text><text x="365" y="264" font-style="italic">x</text><text x="63" y="22" font-style="italic">y</text></g><path d="M20 125 Q170 395 320 125" fill="none" stroke="#85dac1" stroke-width="3.5" stroke-linecap="round"/><path d="M113 260H227" stroke="#e8c482" stroke-width="2" stroke-dasharray="5 5"/><circle cx="170" cy="260" r="5.5" fill="#e8c482" stroke="#123d44" stroke-width="3"/><g fill="#e8c482" font-family="Georgia,serif" font-size="16" font-style="italic"><text x="246" y="89">f(x) = (x − 1)²</text><text x="147" y="230">f′(1) = 0</text></g></svg><div class="graph-bottom"><strong>${t('graphMotto')}</strong><span>${t('graphFootnote')}</span></div></div>`;
  }

  function renderHome() {
    const lastLesson = state.last && lessonById(state.last.lesson);
    const resume = lastLesson && arr(lastLesson.tracks).includes(state.last.track) ? `<a class="continue-card" href="${routeLink(paths.lesson(state.last.track,lastLesson.id,state.last.tab||'cours'))}"><span class="icon-box">${icon('book')}</span><span><small>${t('resume')}</small><strong>${esc(lastLesson.title)}</strong></span>${icon('arrow')}</a>` : '';
    const featured = ['formes-indeterminees','limites','derivation'].map(id=>lessonById(id)).filter(Boolean);
    return `${resume}<section class="hero"><div class="hero-copy"><div class="page-eyebrow"><span class="dot"></span>${t('moroccanBac')}</div><h1>${t('heroTitle')}<br><em>${t('heroEmphasis')}</em></h1><p>${t('heroIntro')}</p><div class="hero-actions"><a class="button" href="#/videos">${icon('play')}${t('browseVideos')}<span class="button-count">${countVideos(DATA.lessons)}</span></a><a class="button secondary" href="#/search">${t('browseCourses')}${icon('arrow')}</a></div><div class="hero-tags">${[['book','structuredLessons'],['sheet','reviewSheets'],['pen','correctedExercises'],['video','videoExplanations']].map(([symbol,key])=>`<span class="tag">${icon(symbol)}${t(key)}</span>`).join('')}</div></div>${graph()}</section><section aria-labelledby="tracks-title"><div class="section-heading"><div><h2 id="tracks-title">${t('tracksTitle')}</h2><p>${t('tracksIntro')}</p></div></div><div class="track-grid">${DATA.tracks.map(track=>{ const lessons=lessonsFor(track.id);return `<a class="track-card ${track.id}" href="${routeLink(paths.track(track.id))}"><div class="track-card-top"><span class="track-chip">${t('bacYear')} · ${trackShort(track)}</span><span class="track-card-symbol" aria-hidden="true">${track.id==='sm'?'∑':'∫'}</span></div><h3>${esc(track.name)}</h3><p class="track-ar">${esc(track.description)}</p><div class="track-card-bottom"><span class="counts">${t('lessonCount',{n:lessons.length})} · ${t('exerciseCount',{n:countExercises(lessons)})}</span><span class="arrow-button" aria-hidden="true">${icon('arrow')}</span></div></a>`;}).join('')}</div></section><section class="featured-videos" aria-labelledby="featured-videos-title"><div class="section-heading"><div><h2 id="featured-videos-title">${t('featuredVideos')}</h2><p>${t('videoPractice')}</p></div><a class="text-accent" href="#/videos">${t('videoLibrary')}${icon('chevron')}</a></div><div class="video-grid featured-grid">${featured.map(l=>videoCard(l.videos[0],l,true)).join('')}</div></section><section class="learning-path" aria-label="${t('learningMethod')}">${[['stepUnderstand','stepUnderstandBody'],['stepSummary','stepSummaryBody'],['stepPractice','stepPracticeBody'],['stepVideo','stepVideoBody']].map(([head,body],i)=>`<div class="path-step"><span class="step-no">0${i+1}</span><div><strong>${t(head)}</strong><span>${t(body)}</span></div></div>`).join('')}</section>`;
  }

  function renderDomainCards(track, selected) {
    const lessons=lessonsFor(track.id);
    return `<div class="domain-grid">${DATA.domains.filter(d=>lessons.some(l=>l.domain===d.id)).map(d=>`<a class="domain-card ${selected===d.id?'active':''}" href="${routeLink(paths.domain(track.id,d.id))}"><span class="domain-symbol" aria-hidden="true">${domainSymbol(d.id)}</span><strong>${esc(d.title)}</strong><span>${t('lessonCount',{n:lessons.filter(l=>l.domain===d.id).length})}</span></a>`).join('')}</div>`;
  }

  function favoriteButton(lesson) { const label=t(favorite(lesson.id)?'removeFavorite':'addFavorite');return `<button class="favorite-button" type="button" data-favorite="${esc(lesson.id)}" aria-pressed="${favorite(lesson.id)}" aria-label="${label}: ${esc(lesson.title)}" title="${label}">${icon('star')}</button>`; }

  function lessonCard(lesson, track, index=0, showTrack=false) {
    const url=routeLink(paths.lesson(track,lesson.id)), videos=arr(lesson.videos).filter(v=>v.src);
    return `<article class="lesson-card"><div class="lesson-card-top"><span class="lesson-index">${String(index+1).padStart(2,'0')} / ${esc(domainTitle(lesson.domain))}</span>${favoriteButton(lesson)}</div><a href="${url}"><h3>${esc(lesson.title)}</h3></a>${showTrack?`<div class="search-match-track">${lesson.tracks.map(id=>esc(trackShort(trackById(id)))).join(' · ')}</div>`:''}<div class="lesson-card-footer"><div class="lesson-card-meta">${lesson.duration?`<span>${icon('clock')}${lesson.duration} ${t('minuteShort')}</span>`:''}<span>${icon('pen')}${t('exerciseCount',{n:lesson.exercises.length})}</span>${completed(track,lesson.id)?`<span class="completed-label">${icon('circleCheck')}${t('reviewed')}</span>`:''}</div><a class="lesson-link" href="${url}">${t('openLesson')}${icon('arrow')}</a></div>${videos.length?`<a class="course-video-link" href="${routeLink(paths.lesson(track,lesson.id,'videos'))}">${icon('play')}${t('watchLessonVideo')}<span>${videos.length}</span></a>`:''}</article>`;
  }

  function filterLessons(lessons, track) {
    if (state.filter === 'favorites') return lessons.filter(l => favorite(l.id));
    if (state.filter === 'remaining') return lessons.filter(l => !completed(track || availableTrack(l), l.id));
    if (state.filter === 'completed') return lessons.filter(l => completed(track || availableTrack(l), l.id));
    return lessons;
  }

  function toolbar(count) { return `<div class="catalog-toolbar"><div class="filter-pills" role="group" aria-label="${t('filterLessons')}">${[['all','all'],['remaining','remaining'],['completed','completed'],['favorites','favorites']].map(([id,key])=>`<button class="filter-pill ${state.filter===id?'active':''}" data-filter="${id}" type="button" aria-pressed="${state.filter===id}">${t(key)}</button>`).join('')}</div><span class="toolbar-count">${t('listCount',{n:count})}</span></div>`; }

  function empty(title, body, action) {
    return `<section class="empty-state">${icon('book')}<h2>${esc(title)}</h2><p>${esc(body)}</p>${action || ''}</section>`;
  }

  function renderTrack(route) {
    const track=trackById(route.track);if(!track)return notFound();
    const all=lessonsFor(track.id),domain=route.domain&&DATA.domains.find(d=>d.id===route.domain);
    if(route.domain&&!domain)return notFound();
    const scoped=domain?all.filter(l=>l.domain===domain.id):all, visible=filterLessons(scoped,track.id);
    const crumbs=[{label:trackShort(track),path:domain?paths.track(track.id):null}];if(domain)crumbs.push({label:domain.title});
    let content='';
    if(!visible.length)content=empty(t('noFilteredLessons'),t('tryFilter'),`<button class="button secondary" data-filter="all" type="button">${t('allLessons')}</button>`);
    else if(domain||state.filter!=='all')content=`<div class="lesson-grid">${visible.map((l,i)=>lessonCard(l,track.id,i)).join('')}</div>`;
    else content=DATA.domains.filter(d=>visible.some(l=>l.domain===d.id)).map(d=>`<section class="catalog-section"><div class="catalog-section-title"><h2><span aria-hidden="true">${domainSymbol(d.id)}</span>${esc(d.title)}</h2><a href="${routeLink(paths.domain(track.id,d.id))}">${t('viewDomain')}${icon('chevron')}</a></div><div class="lesson-grid">${visible.filter(l=>l.domain===d.id).map((l,i)=>lessonCard(l,track.id,i)).join('')}</div></section>`).join('');
    return `${breadcrumb(crumbs)}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${trackShort(track)}</div><h1 class="fr-title">${esc(domain?domain.title:track.name)}</h1><p>${esc(domain?t('selectDomain'):track.description)}</p></div><span class="small-badge">${t('lessonCount',{n:scoped.length})} · ${t('videoCount',{n:countVideos(scoped)})}</span></div>${renderDomainCards(track,route.domain)}${toolbar(visible.length)}${content}`;
  }

  function exampleHTML(example) { if(!example)return '';return `<div class="example"><div class="example-heading">${icon('pen')}<span>${esc(example.title||t('workedExample'))}</span></div><div class="example-content">${example.statement?`<div class="example-statement prose">${rich(example.statement)}</div>`:''}${stepsHTML(example.steps)}${example.answer!=null?`<div class="answer-box"><strong>${t('result')}</strong>${rich(example.answer)}</div>`:''}</div></div>`; }

  function stepsHTML(steps) {
    return arr(steps).length ? `<ol class="solution-steps">${steps.map(step => `<li>${rich(step)}</li>`).join('')}</ol>` : '';
  }

  function pitfallsHTML(lesson) { return arr(lesson.pitfalls).length?`<aside class="pitfalls"><h2>${icon('info')}${t('pitfalls')}</h2><ul>${lesson.pitfalls.map(p=>`<li>${rich(p)}</li>`).join('')}</ul></aside>`:''; }

  function courseHTML(lesson) {
    const sections=arr(lesson.sections),video=arr(lesson.videos).find(v=>v.src),track=availableTrack(lesson);
    return `<div class="lesson-layout"><div class="lesson-body">${lesson.intro?`<div class="intro-panel prose">${rich(lesson.intro)}</div>`:''}${video?`<section class="inline-course-video" aria-label="${t('videoLessonHeading')}"><div class="section-heading"><h2>${t('videoLessonHeading')}</h2><a class="text-accent" href="${routeLink(paths.lesson(track,lesson.id,'videos'))}">${t('allLessonVideos')}${icon('chevron')}</a></div>${videoCard(video,lesson)}</section>`:''}<section class="goals"><h2>${t('goals')}</h2><ul>${arr(lesson.goals).map(goal=>`<li>${icon('check')}<span>${rich(goal)}</span></li>`).join('')}</ul>${arr(lesson.prerequisites).length?`<div class="prerequisites"><strong>${t('prerequisites')}</strong> · ${lesson.prerequisites.map(p=>prerequisiteHTML(p,lesson)).join(LANG==='ar'?'، ':', ')}</div>`:''}</section>${sections.map((section,i)=>`<section class="course-section" id="lesson-section-${i}"><div class="section-title-row"><span class="section-number">${String(i+1).padStart(2,'0')}</span><h2>${esc(section.title)}</h2></div><div class="prose">${rich(section.body)}</div>${exampleHTML(section.example)}${arr(section.examples).map(exampleHTML).join('')}</section>`).join('')}${pitfallsHTML(lesson)}</div>${sections.length>2?`<aside class="lesson-toc" aria-label="${t('lessonContents')}"><div class="overline">${t('lessonContents')}</div>${sections.map((s,i)=>`<button type="button" data-scrollto="lesson-section-${i}"><span class="toc-number">${String(i+1).padStart(2,'0')}</span>${esc(s.title)}</button>`).join('')}</aside>`:''}</div>`;
  }

  function summaryHTML(lesson) { return `<div class="summary-top"><div><h2>${t('summaryTitle')}</h2><p>${t('summaryIntro')}</p></div><button class="button secondary small" type="button" data-print>${icon('print')}${t('printSummary')}</button></div><div class="summary-grid">${arr(lesson.summary).map((item,i)=>`<div class="summary-item"><span class="summary-no">${String(i+1).padStart(2,'0')}</span><div class="prose">${rich(item)}</div></div>`).join('')}</div>${pitfallsHTML(lesson)}`; }

  function exercisesHTML(lesson) {
    const exercises=arr(lesson.exercises);
    return `<p class="exercise-count-note">${t('practiceIntro')}</p>${exercises.map((ex,i)=>`<article class="exercise-card"><div class="exercise-header"><h2>${esc(ex.title||t('exercise',{n:i+1}))}</h2>${ex.level?`<span class="exercise-level">${esc(ex.level)}</span>`:''}</div><div class="exercise-content"><div class="prose">${rich(ex.statement)}</div>${ex.hint?`<details class="hint-details"><summary>${icon('bulb')}${t('hint')}</summary><div class="hint prose">${rich(ex.hint)}</div></details>`:''}<details class="solution-details"><summary>${icon('pen')}${t('showSolution')}</summary><div class="solution-inner">${stepsHTML(ex.steps||ex.correction?.steps)}${ex.answer!=null||ex.correction?.answer!=null?`<div class="answer-box"><strong>${t('finalAnswer')}</strong>${rich(ex.answer??ex.correction.answer)}</div>`:''}</div></details></div></article>`).join('')}${!exercises.length?empty(t('startWithExamples'),t('reviewExamples')):''}${quizHTML(lesson)}`;
  }

  function quizHTML(lesson) { const quiz=arr(lesson.quiz);return quiz.length?`<section class="quiz-section"><h2>${t('checkUnderstanding')}</h2>${quiz.map((q,i)=>`<form class="quiz-card" data-quiz="${i}" data-lesson="${esc(lesson.id)}"><h3>${rich(q.question)}</h3><div class="quiz-options">${arr(q.choices).map((choice,ci)=>`<label class="quiz-option"><input type="radio" name="answer" value="${ci}" required><span>${rich(choice)}</span></label>`).join('')}</div><div class="quiz-actions"><button class="button small" type="submit">${t('checkAnswer')}${icon('check')}</button></div><div class="quiz-feedback" role="status" hidden></div></form>`).join('')}</section>`:''; }

  function videoDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const seconds = Math.round(value);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return value ? String(value) : '';
  }

  function videoCard(video, lesson, showCourse=false) {
    if(!video?.src)return '';
    const tracks=arr(video.tracks),target=routeLink(paths.lesson(availableTrack(lesson),lesson.id,'videos'));
    return `<article class="video-card" data-video-card><div class="video-stage ${video.silent?'landscape':'portrait'}"><video controls playsinline preload="none" ${video.poster?`poster="${esc(safeURL(video.poster))}"`:''} aria-label="${esc(video.title)}"><source src="${esc(safeURL(video.src))}" type="video/mp4">${tracks.map(track=>`<track kind="subtitles" src="${esc(safeURL(track.src))}" srclang="${esc(track.language)}" label="${esc(track.label)}" ${track.language===LANG?'default':''}>`).join('')}${t('videoUnsupported')}</video></div><div class="video-card-info">${showCourse?`<a class="video-course-link" href="${target}">${esc(lesson.title)}${icon('chevron')}</a>`:''}<h2>${esc(video.title)}</h2><span class="video-format-label">${icon(video.silent?'sheet':'video')}${t(video.silent?'silentLabel':'darijaAudio')}</span><p>${t(video.silent?'silentNote':'captionNote')}</p><p class="video-load-error" role="status" hidden>${t('videoError')}</p><div class="video-card-meta">${video.duration?`<span class="mono">${icon('clock')}${videoDuration(video.duration)}</span>`:''}<a href="${esc(safeURL(video.src))}" target="_blank" rel="noopener">${t('openVideo')}${icon('external')}</a><a href="${esc(safeURL(video.src))}" download>${t('downloadVideo')}${icon('download')}</a></div>${arr(video.transcript).length?`<details class="video-transcript"><summary>${t('transcript')}</summary><ol>${video.transcript.map(segment=>`<li>${segment.note?`<strong>${esc(segment.note)}</strong>`:''}<p>${esc(segment.text)}</p>${segment.equation?`<div class="math-block">${rich('\\['+segment.equation+'\\]')}</div>`:''}</li>`).join('')}</ol></details>`:''}</div></article>`;
  }

  function videosHTML(lesson) {
    const videos=arr(lesson.videos).filter(v=>v.src);
    if(!videos.length)return empty(t('videoWrittenOnly'),t('videoNotAttached'));
    return `<p class="video-info-note">${t('videoPractice')}</p><div class="video-grid">${videos.map(v=>videoCard(v,lesson)).join('')}</div>`;
  }

  function renderVideos(route) {
    const lessons=route.track?lessonsFor(route.track):DATA.lessons;
    return `${breadcrumb([{label:t('videoLibrary')}])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${t('videoExplanations')}</div><h1>${t('videoLibrary')}</h1><p>${t('videoLibraryIntro')}</p></div><span class="small-badge">${t('videoCount',{n:countVideos(lessons)})}</span></div><div class="video-filters"><label for="video-track">${t('chooseTrack')}</label><select id="video-track"><option value="">${t('allTracks')}</option>${DATA.tracks.map(track=>`<option value="${track.id}" ${route.track===track.id?'selected':''}>${esc(track.name)}</option>`).join('')}</select></div><div class="video-grid">${lessons.flatMap(lesson=>arr(lesson.videos).map(video=>videoCard(video,lesson,true))).join('')}</div>`;
  }

  function lessonFooter(lesson, track) {
    const list=lessonsFor(track.id),index=list.findIndex(l=>l.id===lesson.id),previous=list[index-1],next=list[index+1],done=completed(track.id,lesson.id);
    return `<section class="lesson-finish"><div><strong>${t(done?'reviewDone':'reviewQuestion')}</strong><small>${t('reviewHelp')}</small></div><button class="button ${done?'secondary':''}" type="button" data-complete="${esc(lesson.id)}" data-track="${track.id}" aria-pressed="${done}">${icon(done?'circleCheck':'check')}${t(done?'markRemaining':'markReviewed')}</button></section><nav class="lesson-next" aria-label="${t('successiveLessons')}">${previous?`<a href="${routeLink(paths.lesson(track.id,previous.id))}"><small>${t('previousLesson')}</small><strong>${esc(previous.title)}</strong></a>`:''}${next?`<a href="${routeLink(paths.lesson(track.id,next.id))}"><small>${t('nextLesson')}</small><strong>${esc(next.title)}</strong></a>`:`<a href="${routeLink(paths.track(track.id))}"><small>${t('keepLearning')}</small><strong>${t('returnCourses')}</strong></a>`}</nav>`;
  }

  function renderLesson(route) {
    const track=trackById(route.track),lesson=lessonById(route.lesson);
    if(!track||!lesson||!lesson.tracks.includes(track.id))return notFound();
    const tab=['cours','resume','exercices','videos'].includes(route.tab)?route.tab:'cours';
    state.last={track:track.id,lesson:lesson.id,tab};persist();document.title=`${lesson.title} | REGAM Academy`;
    const content={cours:courseHTML,resume:summaryHTML,exercices:exercisesHTML,videos:videosHTML}[tab](lesson);
    const tabs=[['cours','courseTab','book',null],['resume','summaryTab','sheet',null],['exercices','exercisesTab','pen',lesson.exercises.length],['videos','videos','video',lesson.videos.length]];
    return `${breadcrumb([{label:trackShort(track),path:paths.track(track.id)},{label:domainTitle(lesson.domain),path:paths.domain(track.id,lesson.domain)},{label:lesson.title}])}<div class="print-only">REGAM Academy · ${esc(track.name)} · ${esc(lesson.title)}</div><header class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${esc(domainTitle(lesson.domain))}</div><h1 class="fr-title">${esc(lesson.title)}</h1><div class="lesson-meta"><span>${icon('book')}${trackShort(track)}</span>${lesson.duration?`<span>${icon('clock')}${t('revisionDuration',{n:lesson.duration})}</span>`:''}<span>${icon('pen')}${t('exerciseCount',{n:lesson.exercises.length})}</span>${lesson.level?`<span>${esc(lesson.level)}</span>`:''}</div></div><div class="lesson-heading-actions">${favoriteButton(lesson)}<button class="icon-button" type="button" data-print title="${t('printSummary')}" aria-label="${t('printSummary')}">${icon('print')}</button></div></header><nav class="lesson-tabs" aria-label="${t('lessonParts')}">${tabs.map(([id,key,symbol,count])=>`<a class="lesson-tab ${tab===id?'active':''} ${id==='videos'?'video-tab':''}" href="${routeLink(paths.lesson(track.id,lesson.id,id))}" ${tab===id?'aria-current="page"':''}>${icon(symbol)}${t(key)}${count!=null?`<span class="tab-count">${count}</span>`:''}</a>`).join('')}</nav><div id="lesson-tab-panel">${content}</div>${lessonFooter(lesson,track)}`;
  }

  function searchLessons(query) {
    const terms=normalize(query).split(/\s+/).filter(Boolean);
    return DATA.lessons.filter(lesson=>{
      const variants=Object.values(LOCALES).map(data=>data.lessons.find(l=>l.id===lesson.id)).filter(Boolean);
      const haystack=normalize([lesson.id,domainTitle(lesson.domain),...variants.flatMap(l=>[l.title,l.titleAr,...arr(l.tags)])].join(' '));
      return terms.every(term=>haystack.includes(term));
    });
  }

  function renderSearch(route) {
    const query=route.query||'',visible=filterLessons(searchLessons(query));
    return `${breadcrumb([{label:t('allLessons')}])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${t('fullLibrary')}</div><h1>${t('searchTitle')}</h1><p>${t('searchIntro')}</p></div></div><form class="search-page-form" id="search-page-form" role="search"><label class="sr-only" for="page-search">${t('searchCourses')}</label><input id="page-search" name="q" type="search" value="${esc(query)}" placeholder="${t('searchPlaceholder')}" autocomplete="off"><button class="button" type="submit">${icon('search')}${t('search')}</button></form>${toolbar(visible.length)}${visible.length?`<div class="lesson-grid">${visible.map((l,i)=>lessonCard(l,availableTrack(l),i,true)).join('')}</div>`:empty(t('noSearchResults'),t('searchHelp'))}`;
  }

  function renderFavorites() { const lessons=DATA.lessons.filter(l=>favorite(l.id));return `${breadcrumb([{label:t('favorites')}])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${t('organizedRevision')}</div><h1>${t('myFavorites')}</h1><p>${t('favoritesIntro')}</p></div><span class="small-badge">${t('lessonCount',{n:lessons.length})}</span></div>${lessons.length?`<div class="lesson-grid">${lessons.map((l,i)=>lessonCard(l,availableTrack(l),i,true)).join('')}</div>`:empty(t('noFavorites'),t('favoritesHelp'),`<a class="button" href="#/search">${t('browseCourses')}${icon('arrow')}</a>`)}`; }

  function renderSources() { return `${breadcrumb([{label:t('curriculum')}])}<div class="page-title-row"><div><div class="page-eyebrow"><span class="dot"></span>${t('independentContent')}</div><h1>${t('curriculum')}</h1><p>${t('sourcesIntro')}</p></div></div><div class="sources-intro prose">${rich(DATA.meta.curriculumNote)}<p class="muted">${t('contentUpdated')}: ${esc(DATA.meta.updated)}</p></div>${arr(DATA.sources).map(source=>`<article class="source-card"><h2>${esc(source.title||source.name||t('source'))}</h2>${source.dateNote?`<p>${esc(source.dateNote)}</p>`:''}${source.description||source.note?`<p>${esc(source.description||source.note)}</p>`:''}${source.url?`<a href="${esc(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">${t('openSource')}${icon('external')}</a>`:''}</article>`).join('')}<p class="source-domain-note">${t('privacy')}</p>`; }

  function notFound() { document.title=`${t('notFound')} | REGAM Academy`;return empty(t('notFound'),t('notFoundBody'),`<a class="button" href="#/">${t('backLibrary')}${icon('arrow')}</a>`); }

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
    if (parts[0] === 'videos') return { type: 'videos', track: ['pc','sm'].includes(new URLSearchParams(query).get('track')) ? new URLSearchParams(query).get('track') : '' };
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
    document.title = `REGAM Academy | ${t('pageTitle')}`;
    const main = document.getElementById('main-content');
    const views = { home: renderHome, videos: renderVideos, track: renderTrack, lesson: renderLesson, search: renderSearch, favorites: renderFavorites, sources: renderSources, notfound: notFound };
    main.innerHTML = views[route.type](route) + footer();
    mathIn(main);
    renderSidebar();
    closeDrawer();
    if (options.keepScroll) window.scrollTo({ top: y, behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function updateThemeButton() { const dark=document.documentElement.dataset.theme==='dark',button=document.getElementById('theme-button');button.innerHTML=icon(dark?'sun':'moon');button.setAttribute('aria-label',t(dark?'dayMode':'nightMode'));button.title=t(dark?'dayMode':'nightMode'); }

  function updateDrawerAccessibility() {
    const mobile = window.matchMedia('(max-width: 780px)').matches;
    const sidebar = document.getElementById('sidebar');
    const open = sidebar.classList.contains('is-open');
    sidebar.inert = mobile && !open;
    document.querySelector('.app-shell').inert = mobile && open;
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
    const results=searchLessons(query),list=results.slice(0,12);
    document.getElementById('search-dialog-results').innerHTML=list.length?list.map(lesson=>`<a class="search-result" href="${routeLink(paths.lesson(availableTrack(lesson),lesson.id))}"><span class="result-symbol" aria-hidden="true">${domainSymbol(lesson.domain)}</span><span><strong>${esc(lesson.title)}</strong><small>${lesson.tracks.map(id=>trackShort(trackById(id))).join(' / ')}</small></span>${icon('arrow')}</a>`).join(''):`<p class="search-dialog-note">${t('noSearchResults')}</p>`;
    document.getElementById('search-dialog-count').textContent=query?t('listCount',{n:results.length}):t('chooseSearch');
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

  app.innerHTML = `<aside class="sidebar" id="sidebar" aria-label="${t('libraryNavigation')}"></aside><div class="drawer-scrim" id="drawer-scrim" aria-hidden="true"></div><div class="app-shell"><header class="topbar"><button class="icon-button mobile-menu" id="menu-button" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="${t('openMenu')}">${icon('menu')}</button><span class="topbar-label">${t('topbar')}</span><button class="search-launch" id="search-launch" type="button">${icon('search')}<span>${t('launchSearch')}</span><kbd>⌘ K</kbd></button><label class="language-control"><span class="sr-only" id="language-label">${t('language')}</span><select id="language-select" aria-labelledby="language-label"><option value="ar">العربية الفصحى</option><option value="fr">Français</option><option value="en">English</option></select></label><button class="icon-button" id="theme-button" type="button"></button></header><main class="main-wrap" id="main-content" tabindex="-1"></main></div><dialog class="search-dialog" id="search-dialog" aria-labelledby="search-dialog-label"><form id="dialog-search-form"><div class="search-dialog-top">${icon('search')}<label class="sr-only" id="search-dialog-label" for="dialog-search">${t('searchDialogLabel')}</label><input type="search" id="dialog-search" placeholder="${t('searchDialogPlaceholder')}" autocomplete="off"><button class="icon-button" type="button" id="close-search" aria-label="${t('closeSearch')}">${icon('close')}</button></div></form><div class="search-dialog-results" id="search-dialog-results"></div><div class="search-dialog-footer"><span id="search-dialog-count"></span><span id="search-keyboard-help">${t('searchKeyboard')}</span></div></dialog>`;

  function refreshChrome() {
    document.documentElement.lang=LANG;
    document.documentElement.dir=LANG==='ar'?'rtl':'ltr';
    document.querySelector('.skip-link').textContent=t('skip');
    document.querySelector('.topbar-label').textContent=t('topbar');
    document.querySelector('#search-launch span').textContent=t('launchSearch');
    document.getElementById('sidebar').setAttribute('aria-label',t('libraryNavigation'));
    document.getElementById('menu-button').setAttribute('aria-label',t('openMenu'));
    document.getElementById('language-label').textContent=t('language');
    document.getElementById('language-select').value=LANG;
    document.getElementById('dialog-search').placeholder=t('searchDialogPlaceholder');
    document.getElementById('search-dialog-label').textContent=t('searchDialogLabel');
    document.getElementById('close-search').setAttribute('aria-label',t('closeSearch'));
    document.getElementById('search-keyboard-help').textContent=t('searchKeyboard');
    const description=document.querySelector('meta[name="description"]');
    if(description)description.content=t('heroIntro');
    updateThemeButton();
  }

  document.getElementById('language-select').addEventListener('change',event=>{
    const next=event.target.value;
    if(!LOCALES[next])return;
    LANG=next;DATA=LOCALES[next];window.REGAM_DATA=DATA;
    document.querySelector('.toast')?.remove();
    try { localStorage.setItem('regam-maths-language',LANG); } catch {}
    const url=new URL(location.href);url.searchParams.set('lang',LANG);history.replaceState(null,'',url);
    document.getElementById('search-dialog').close();
    refreshChrome();renderRoute({keepScroll:true});
  });
  document.addEventListener('change',event=>{if(event.target.id==='video-track')location.hash='#/videos'+(event.target.value?'?track='+encodeURIComponent(event.target.value):'');});
  document.addEventListener('error',event=>{
    const target=event.target;
    if(target?.tagName==='VIDEO'||target?.tagName==='SOURCE'){
      const message=target.closest('[data-video-card]')?.querySelector('.video-load-error');
      if(message)message.hidden=false;
    }
  },true);
  refreshChrome();

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
  document.getElementById('drawer-scrim').addEventListener('click', () => { closeDrawer(); document.getElementById('menu-button').focus(); });
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
      toast(saved ? (state.favorites.has(id) ? t('savedFavorite') : t('removedFavorite')) : t('localUnavailable'));
      return;
    }
    const completeTarget = event.target.closest('[data-complete]');
    if (completeTarget) {
      const key = progressKey(completeTarget.dataset.track, completeTarget.dataset.complete);
      state.progress[key] = !state.progress[key];
      const saved = persist();
      renderRoute({ keepScroll: true });
      toast(saved ? (state.progress[key] ? t('savedReviewed') : t('resetReviewed')) : t('localUnavailable'));
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
      feedback.innerHTML = `<strong>${good ? t('quizCorrect') : t('quizRetry')}</strong>${question.explanation ? `<div>${rich(question.explanation)}</div>` : ''}`;
      mathIn(feedback);
    }
  });
})();
