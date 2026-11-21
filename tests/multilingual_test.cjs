/* Integration checks for the delivered, bundled three-language academy.
 * Run: node tests/multilingual_test.cjs
 * Uses the real HTML, app, translations, KaTeX, bundled courses and local files.
 * No resources are fetched. jsdom checks DOM behaviour, not pixels or playback.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'site');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const read = relative => fs.readFileSync(path.join(site, relative), 'utf8');
const languages = ['ar', 'fr', 'en'];
const learningKey = 'regam-maths-learning-v1';
const languageKey = 'regam-maths-language';
const html = read('index.html');
const scripts = [
  'assets/vendor/katex.min.js', 'assets/vendor/auto-render.min.js',
  'data/courses.js', 'assets/i18n.js', 'assets/app.js',
].map(file => [file, read(file)]);
const counters = { locales: 0, routes: 0, quizSubmissions: 0, formulae: 0, transcriptFormulae: 0, mediaFiles: 0, captionCues: 0, narratedFiles: 0, narrationFilterChecks: 0 };
const checkedMedia = new Set();
const audioProbes = new Map();
const windows = new Set();

function makeApp({ url = 'https://academy.invalid/#/', saved = {}, mobile = false, blockStorage = false } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(String(error)));
  console.on('error', error => errors.push(String(error)));
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: console });
  const w = dom.window;
  windows.add(w);
  let narrow = mobile;
  w.matchMedia = query => ({
    matches: query.includes('max-width') ? narrow : false,
    media: query, addEventListener() {}, removeEventListener() {},
  });
  w.scrollTo = () => {};
  w.print = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (blockStorage) {
    Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled by test'); } });
  } else {
    for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  }
  for (const [file, source] of scripts) {
    w.eval(source);
    if (file === 'data/courses.js') {
      assert(w.REGAM_LOCALES, 'courses.js has not yet been rebuilt with REGAM_LOCALES');
      for (const lang of languages) assert(w.REGAM_LOCALES[lang], `Missing bundled locale ${lang}`);
    }
  }
  return {
    w, d: w.document, errors,
    data: lang => w.REGAM_LOCALES[lang],
    messages: () => w.REGAM_I18N[w.document.documentElement.lang],
    setMobile(value) { narrow = value; w.dispatchEvent(new w.Event('resize')); },
    close() { w.close(); windows.delete(w); },
  };
}

function textWithoutMath(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,.katex,video,track,source,.language-control option').forEach(el => el.remove());
  return clone.textContent;
}

function assertChrome(app, lang) {
  const { d } = app;
  const messages = app.w.REGAM_I18N[lang];
  assert.equal(d.documentElement.lang, lang);
  assert.equal(d.documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr');
  assert.equal(d.getElementById('language-select').value, lang);
  assert.equal(d.querySelector('.skip-link').textContent, messages.skip);
  assert.equal(d.querySelector('.topbar-label').textContent, messages.topbar);
  assert.equal(d.querySelector('#search-launch span').textContent, messages.launchSearch);
  assert.equal(d.getElementById('sidebar').getAttribute('aria-label'), messages.libraryNavigation);
  assert.equal(d.getElementById('language-label').textContent, messages.language);
  assert.equal(d.getElementById('dialog-search').placeholder, messages.searchDialogPlaceholder);
  assert.equal(d.getElementById('search-dialog-label').textContent, messages.searchDialogLabel);
  assert.equal(d.getElementById('close-search').getAttribute('aria-label'), messages.closeSearch);
  assert.equal(d.querySelector('meta[name="description"]').content, messages.heroIntro);
  assert.equal(d.querySelector('.site-footer > span:nth-child(2)').textContent, messages.footer);
  for (const [href, key] of [['#/','myLibrary'], ['#/search','allLessons'], ['#/videos','videoLibrary'], ['#/favorites','myFavorites']]) {
    const label = d.querySelector(`.side-nav a[href="${href}"] > span:not(.count)`);
    assert.equal(label?.textContent, messages[key], `Localized navigation ${key}/${lang}`);
  }
  if (lang !== 'ar') {
    for (const selector of ['#main-content', '#sidebar', '.topbar', '.skip-link', '.toast']) {
      const node = d.querySelector(selector);
      if (node) assert(!/[\u0600-\u06ff]/u.test(textWithoutMath(node)), `Arabic residue in ${lang} ${selector}`);
    }
  }
}

function assertRendered(app, route) {
  const main = app.d.getElementById('main-content');
  assert(main?.textContent.trim().length > 10, `Empty route ${route}`);
  assert.equal(main.querySelectorAll('.katex-error').length, 0, `KaTeX error on ${route}`);
  assert(!/\[object Object\]/.test(main.textContent), `Unresolved object value on ${route}`);
  const walker = app.d.createTreeWalker(main, app.w.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) assert(walker.currentNode.nodeValue.trim() !== 'undefined', `Unresolved standalone value on ${route}`);
  assert(!/\\\(|\\\[/.test(textWithoutMath(main)), `Unrendered mathematical delimiter on ${route}`);
  assert(!main.querySelector('x, x2, x3, alpha, infty'), `Math parsed as an HTML element on ${route}`);
  assertChrome(app, app.d.documentElement.lang);
  counters.routes++;
  return main;
}

function visit(app, route) {
  app.w.history.replaceState(null, '', '#' + route);
  app.w.dispatchEvent(new app.w.HashChangeEvent('hashchange'));
  return assertRendered(app, route);
}

async function clickRoute(app, element, expected) {
  assert(element, `Missing link to ${expected}`);
  const before = app.w.location.hash;
  const target = element.getAttribute('href');
  if (before !== target) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No hash navigation to ${expected}`)), 1500);
      app.w.addEventListener('hashchange', () => { clearTimeout(timer); resolve(); }, { once: true });
      element.click();
    });
  } else element.click();
  assert.equal(app.w.location.hash, '#' + expected, 'Actual link navigation');
  return assertRendered(app, expected);
}

function changeLanguage(app, lang) {
  const previousHash = app.w.location.hash;
  const previousQuery = new URL(app.w.location.href).searchParams.get('ref');
  const select = app.d.getElementById('language-select');
  select.value = lang;
  select.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  assert.equal(app.w.location.hash, previousHash, 'Switching language must preserve route and route query');
  assert.equal(new URL(app.w.location.href).searchParams.get('ref'), previousQuery, 'Preserve unrelated URL parameters');
  assert.equal(new URL(app.w.location.href).searchParams.get('lang'), lang);
  assertChrome(app, lang);
}

function snapshot(app) {
  return Object.fromEntries([languageKey, learningKey, 'regam-maths-theme'].map(key => [key, app.w.localStorage.getItem(key)]).filter(([,value]) => value !== null));
}

function checkFormulae(value, app, location) {
  if (typeof value === 'string') {
    const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
    for (const match of value.matchAll(pattern)) {
      assert.doesNotThrow(() => app.w.katex.renderToString(match[1] ?? match[2] ?? match[3], { throwOnError: true, strict: 'ignore' }), `Invalid math at ${location}`);
      counters.formulae++;
    }
  } else if (Array.isArray(value)) value.forEach((item, index) => checkFormulae(item, app, `${location}.${index}`));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) checkFormulae(item, app, `${location}.${key}`);
}

function checkMedia(relative) {
  assert(relative && !/^(?:https?:|data:|javascript:)/i.test(relative), `Media must remain local: ${relative}`);
  const absolute = path.resolve(site, relative);
  assert(absolute.startsWith(site + path.sep), `Media path escapes site: ${relative}`);
  if (checkedMedia.has(relative)) return;
  checkedMedia.add(relative);
  assert(fs.existsSync(absolute), `Missing delivered media file ${relative}`);
  const bytes = fs.readFileSync(absolute);
  assert(bytes.length > 16, `Empty media file ${relative}`);
  if (relative.endsWith('.mp4')) assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', `Invalid MP4 header ${relative}`);
  if (/\.jpe?g$/i.test(relative)) assert.equal(bytes.readUInt16BE(0), 0xffd8, `Invalid JPEG header ${relative}`);
  if (relative.endsWith('.vtt')) {
    const text = bytes.toString('utf8');
    assert(/^\uFEFF?WEBVTT|^WEBVTT/.test(text), `Invalid VTT header ${relative}`);
    const cues = [...text.matchAll(/^(\d\d):(\d\d):(\d\d\.\d+) --> (\d\d):(\d\d):(\d\d\.\d+)/gm)];
    assert(cues.length, `No caption cues in ${relative}`);
    let previous = -1;
    for (const cue of cues) {
      const start = Number(cue[1]) * 3600 + Number(cue[2]) * 60 + Number(cue[3]);
      const end = Number(cue[4]) * 3600 + Number(cue[5]) * 60 + Number(cue[6]);
      assert(start >= previous && end > start, `Invalid caption timing in ${relative}`);
      previous = start;
    }
    if (/\/(?:fr|en)\//.test(relative)) assert(!/[\u0600-\u06ff]/u.test(text), `Untranslated captions ${relative}`);
    counters.captionCues += cues.length;
  }
  counters.mediaFiles++;
}

function checkNarrationMedia(video) {
  if (!audioProbes.has(video.src)) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', path.join(site, video.src)], { encoding: 'utf8', timeout: 20000 });
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, `ffprobe failed for ${video.src}: ${probe.stderr}`);
    const info = JSON.parse(probe.stdout);
    assert(info.streams.some(stream => stream.codec_type === 'video'), `No video stream in ${video.src}`);
    assert(info.streams.some(stream => stream.codec_type === 'audio'), `Narrated asset has no audio stream: ${video.src}`);
    assert(Number(info.format.duration) > 0, `Invalid narrated duration in ${video.src}`);
    audioProbes.set(video.src, info);
    counters.narratedFiles++;
  }
}

function assertPlayers(app, expectedVideos, container = app.d.getElementById('main-content')) {
  const cards = [...container.querySelectorAll('[data-video-card]')];
  assert.equal(cards.length, expectedVideos.length);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i], expected = expectedVideos[i], video = card.querySelector('video');
    assert(video, 'Video element present');
    assert(video.hasAttribute('controls') && video.hasAttribute('playsinline'), 'Visible native player controls');
    assert(!video.hasAttribute('muted') && !video.muted && !video.defaultMuted, 'Narration must not be forced muted');
    assert(!video.closest('details,[hidden]'), 'Player must be accessible without opening a disclosure');
    assert.equal(video.getAttribute('aria-label'), expected.title);
    assert.equal(video.querySelector('source').getAttribute('src'), expected.src);
    assert.equal(video.getAttribute('poster'), expected.poster);
    const audioLabels = { ar: 'standardArabicAudio', fr: 'frenchAudio', en: 'englishAudio', ary: 'darijaAudio' };
    assert.equal(card.querySelector('.video-format-label').textContent, app.messages()[expected.silent ? 'silentLabel' : audioLabels[expected.audioLanguage]], 'Audio label follows the actual narration language');
    assert.equal(card.querySelector('a[download]').getAttribute('href'), expected.src);
    assert.equal(card.querySelector('a[target="_blank"]').getAttribute('href'), expected.src);
    for (const relative of [expected.src, expected.poster, ...(expected.tracks || []).map(track => track.src)]) checkMedia(relative);
    const tracks = [...video.querySelectorAll('track')];
    assert.equal(tracks.length, (expected.tracks || []).length);
    const defaults = tracks.filter(track => track.hasAttribute('default'));
    assert.equal(defaults.length, 1, `Exactly one default subtitle track for ${app.d.documentElement.lang}: ${expected.src}`);
    assert.equal(defaults[0].getAttribute('srclang'), app.d.documentElement.lang);
    if (expected.audioLanguage === 'ary') {
      assert.deepEqual(tracks.map(track => track.getAttribute('srclang')).sort(), languages.slice().sort(), 'Original Darija video has all three caption languages');
      assert(card.querySelector('.video-stage').classList.contains('portrait'), 'Original Darija clips retain portrait presentation');
      assert(card.querySelector('.video-description').textContent.includes(app.messages().captionNote));
    } else {
      assert.equal(expected.textLanguage, app.d.documentElement.lang, 'Localized on-screen text matches the selected language');
      assert(expected.transcript?.length > 0, 'Localized video has its written transcript');
      assert(expected.src.startsWith(`media/${app.d.documentElement.lang}/`), 'Localized video uses the selected-language asset');
      assert(card.querySelector('.video-stage').classList.contains('landscape'), 'Localized clips remain landscape, including narrated clips');
      if (!expected.silent) {
        assert.equal(expected.audioLanguage, app.d.documentElement.lang, 'New narration matches the site language');
        assert.equal(expected.narration, 'synthetic');
        assert.equal(expected.aspectRatio, '16:9');
        assert(expected.src.endsWith('/limites-narrated.mp4'), 'Narrated limits use a new URL that cannot reuse a cached silent file');
        assert.notEqual(card.querySelector('.video-format-label').textContent, app.messages().darijaAudio);
        assert(card.querySelector('.video-description').textContent.includes(app.messages().syntheticNarrationNote));
        assert(card.querySelector('.video-description').textContent.includes(app.messages().captionsAvailable));
        assert(!card.querySelector('.video-description').textContent.includes(app.messages().captionNote), 'One-language captions must not be described as three-language captions');
      }
    }
    if (!expected.silent) checkNarrationMedia(expected);
    const transcriptItems = [...card.querySelectorAll('.video-transcript li')];
    assert.equal(transcriptItems.length, (expected.transcript || []).length);
    transcriptItems.forEach((item, index) => {
      const segment = expected.transcript[index];
      assert.equal(item.querySelector('p').textContent, segment.text);
      if (segment.note) assert.equal(item.querySelector('strong').textContent, segment.note);
      if (segment.equation) {
        assert.equal(item.querySelector('annotation[encoding="application/x-tex"]')?.textContent, segment.equation, 'Transcript TeX survives escaping and HTML parsing exactly');
        counters.transcriptFormulae++;
      }
    });
  }
}

function submitQuiz(app, form, index) {
  form.querySelector(`input[value="${index}"]`).checked = true;
  form.dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
  counters.quizSubmissions++;
  return form.querySelector('.quiz-feedback');
}

function checkQuiz(app, lesson) {
  const forms = [...app.d.querySelectorAll('.quiz-card')];
  assert.equal(forms.length, lesson.quiz.length);
  forms.forEach((form, i) => {
    const question = lesson.quiz[i];
    const wrong = (Number(question.correct) + 1) % question.choices.length;
    let feedback = submitQuiz(app, form, wrong);
    assert(!feedback.hidden && feedback.classList.contains('retry'));
    assert.equal(feedback.querySelector('strong').textContent, app.messages().quizRetry);
    assert(form.querySelectorAll('.quiz-option')[wrong].classList.contains('incorrect'));
    assert(form.querySelectorAll('.quiz-option')[question.correct].classList.contains('correct'));
    feedback = submitQuiz(app, form, Number(question.correct));
    assert(!feedback.hidden && feedback.classList.contains('good'));
    assert.equal(feedback.querySelector('strong').textContent, app.messages().quizCorrect);
    assert.equal(form.querySelectorAll('.quiz-option.incorrect').length, 0);
    assert.equal(feedback.querySelectorAll('.katex-error').length, 0);
  });
}

function checkData(app) {
  const all = languages.map(lang => app.data(lang));
  for (const [index, data] of all.entries()) {
    const lang = languages[index];
    assert.equal(data.meta.language, lang);
    assert.equal(data.meta.version, packageVersion, 'Bundled content matches the release version');
    assert.equal(data.lessons.length, 25);
    assert.equal(data.lessons.reduce((n, l) => n + l.sections.length, 0), 133);
    assert.equal(data.lessons.reduce((n, l) => n + l.exercises.length, 0), 75);
    assert.equal(data.lessons.reduce((n, l) => n + l.quiz.length, 0), 43);
    assert.equal(data.lessons.reduce((n, l) => n + l.videos.length, 0), 31);
    const videos = data.lessons.flatMap(lesson => lesson.videos);
    assert.equal(videos.filter(video => video.silent).length, 23);
    assert.equal(videos.filter(video => !video.silent && video.audioLanguage === lang).length, 1);
    assert.equal(videos.filter(video => !video.silent && video.audioLanguage === 'ary').length, 7);
    const voicedLimits = data.lessons.find(lesson => lesson.id === 'limites').videos[0];
    assert.equal(voicedLimits.silent, false);
    assert.equal(voicedLimits.audioLanguage, lang);
    assert.equal(voicedLimits.narration, 'synthetic');
    assert.equal(data.lessons.filter(l => l.tracks.includes('pc')).length, 18);
    assert.equal(data.lessons.filter(l => l.tracks.includes('sm')).length, 23);
    assert.deepEqual(JSON.parse(JSON.stringify(data.lessons.map(l => [l.id, l.domain, l.tracks, l.quiz.map(q => q.correct)]))), JSON.parse(JSON.stringify(all[0].lessons.map(l => [l.id, l.domain, l.tracks, l.quiz.map(q => q.correct)]))), 'Identifiers, tracks and quiz answer indices agree across languages');
    assert.deepEqual(Object.keys(app.w.REGAM_I18N[lang]).sort(), Object.keys(app.w.REGAM_I18N.ar).sort());
    assert(Object.values(app.w.REGAM_I18N[lang]).every(message => typeof message === 'string' && message.trim()));
    for (const match of scripts.find(([file]) => file === 'assets/app.js')[1].matchAll(/\bt\('([^']+)'/g)) {
      assert.equal(typeof app.w.REGAM_I18N[lang][match[1]], 'string', `Missing UI message ${lang}.${match[1]}`);
    }
    if (lang === 'ar') assert(!/(?:^|[^\u0600-\u06ff])(?:هاد|بغينا|كنلقاو|كيساوي|ماشي|دابا)(?=$|[^\u0600-\u06ff])/u.test(JSON.stringify(data)), 'Standard Arabic content must not fall back to Darija prose');
    if (lang !== 'ar') {
      const prose = JSON.parse(JSON.stringify(data));
      // Subtitle menus intentionally name each available language in its native script.
      for (const lesson of prose.lessons) for (const video of lesson.videos) for (const track of video.tracks || []) delete track.label;
      assert(!/[\u0600-\u06ff]/u.test(JSON.stringify(prose)), `Arabic prose remains in bundled ${lang} data`);
    }
    for (const lesson of data.lessons) assert.equal(lesson.title, lesson.titleAr);
    checkFormulae(data, app, lang);
  }
}

async function sweepLocale(lang) {
  const app = makeApp({ url: `https://academy.invalid/?lang=${lang}#/` });
  const data = app.data(lang);
  assertChrome(app, lang);
  const home = assertRendered(app, '/');
  assert.equal(home.querySelectorAll('.featured-videos video').length, 3);
  assert(home.querySelector('.hero-actions a[href="#/videos"]'), 'Video library visible from the hero');
  assert(app.d.querySelector('.side-nav a[href="#/videos"]'), 'Video library visible from navigation');
  await clickRoute(app, home.querySelector('.hero-actions a[href="#/videos"]'), '/videos');
  assertPlayers(app, data.lessons.flatMap(l => l.videos));
  const errorCard = app.d.querySelector('[data-video-card]');
  assert(errorCard.querySelector('.video-load-error').hidden);
  errorCard.querySelector('source').dispatchEvent(new app.w.Event('error'));
  assert(!errorCard.querySelector('.video-load-error').hidden, 'Source failure reveals the recovery message');
  assert.equal(errorCard.querySelector('.video-load-error').textContent, app.messages().videoError);
  for (const track of data.tracks) {
    const catalog = visit(app, `/track/${track.id}`);
    assert.equal(catalog.querySelectorAll('.lesson-card').length, data.lessons.filter(l => l.tracks.includes(track.id)).length);
    for (const domain of data.domains.filter(d => data.lessons.some(l => l.tracks.includes(track.id) && l.domain === d.id))) {
      const main = visit(app, `/track/${track.id}/domain/${domain.id}`);
      assert.equal(main.querySelectorAll('.lesson-card').length, data.lessons.filter(l => l.tracks.includes(track.id) && l.domain === domain.id).length);
    }
  }
  for (const lesson of data.lessons) {
    const track = lesson.tracks[0];
    for (const tab of ['cours', 'resume', 'exercices', 'videos']) {
      const main = visit(app, `/track/${track}/lesson/${lesson.id}/${tab}`);
      assert.equal(main.querySelector('h1').textContent, lesson.title);
      assert.equal(app.d.title, `${lesson.title} | REGAM Academy`);
      const activeTab = main.querySelector('.lesson-tab[aria-current="page"]');
      const expectedKey = { cours: 'courseTab', resume: 'summaryTab', exercices: 'exercisesTab', videos: 'videos' }[tab];
      assert(activeTab.textContent.startsWith(app.messages()[expectedKey]), 'Localized active lesson tab');
      if (tab === 'cours') {
        assert.equal(main.querySelectorAll('.course-section').length, lesson.sections.length);
        assert.equal(main.querySelectorAll('.goals li').length, lesson.goals.length);
        assert.equal(main.querySelectorAll('.inline-course-video video').length, 1);
        assertPlayers(app, [lesson.videos[0]], main.querySelector('.inline-course-video'));
      }
      if (tab === 'exercices') {
        assert.equal(main.querySelectorAll('.solution-details').length, lesson.exercises.length);
        checkQuiz(app, lesson);
      }
      if (tab === 'videos') assertPlayers(app, lesson.videos);
    }
  }
  const limits = visit(app, '/track/pc/lesson/limites/cours');
  assert([...limits.querySelectorAll('annotation')].some(el => el.textContent === 'x<0'), 'Strict inequality survives HTML parsing');
  const study = visit(app, '/track/pc/lesson/etude-fonction/cours');
  assert(study.querySelector('.prerequisites a[href*="/limites/"]'), 'Prerequisite IDs resolve to localized lesson links');
  visit(app, '/sources');
  assert.equal(app.d.querySelectorAll('.source-card').length, data.sources.length);
  const invalid = visit(app, '/track/pc/lesson/structures/cours');
  assert.equal(invalid.querySelector('h2').textContent, app.messages().notFound, 'Track membership enforced');
  const missing = visit(app, '/does-not-exist');
  assert.equal(missing.querySelector('h2').textContent, app.messages().notFound);
  assert.deepEqual(app.errors, [], `Runtime errors for ${lang}`);
  counters.locales++;
  app.close();
}

async function checkInteractions() {
  const app = makeApp({ url: 'https://academy.invalid/?ref=integration#/track/pc/lesson/limites/exercices' });
  assert.equal(app.d.documentElement.lang, 'ar');
  app.d.querySelector('[data-favorite="limites"]').click();
  app.d.querySelector('[data-complete="limites"]').click();
  let stored = JSON.parse(app.w.localStorage.getItem(learningKey));
  assert(stored.favorites.includes('limites') && stored.progress['pc:limites']);
  // Regression: a visible Arabic toast must not survive a switch to French.
  changeLanguage(app, 'fr');
  assert.equal(app.w.localStorage.getItem(languageKey), 'fr');
  assert.equal(app.d.querySelector('h1').textContent, app.data('fr').lessons.find(l => l.id === 'limites').title);
  assert.equal(app.d.querySelector('[data-favorite="limites"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.d.querySelector('[data-complete="limites"]').getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.parse(app.w.localStorage.getItem(learningKey)).last.tab, 'exercices');
  for (const lang of ['en', 'ar', 'fr']) {
    changeLanguage(app, lang);
    assert.equal(app.w.location.hash, '#/track/pc/lesson/limites/exercices');
    checkQuiz(app, app.data(lang).lessons.find(l => l.id === 'limites'));
  }
  const saved = snapshot(app);
  const reloaded = makeApp({ url: 'https://academy.invalid/#/track/pc/lesson/limites/exercices', saved });
  assertChrome(reloaded, 'fr');
  assert.equal(reloaded.d.querySelector('[data-favorite="limites"]').getAttribute('aria-pressed'), 'true');
  assert.equal(reloaded.d.querySelector('[data-complete="limites"]').getAttribute('aria-pressed'), 'true');
  reloaded.close();
  const explicit = makeApp({ url: 'https://academy.invalid/?lang=en#/favorites', saved });
  assertChrome(explicit, 'en');
  assert.equal(explicit.d.querySelectorAll('.lesson-card').length, 1);
  explicit.close();
  visit(app, '/track/sm/lesson/limites/cours');
  assert.equal(app.d.querySelector('[data-complete="limites"]').getAttribute('aria-pressed'), 'false', 'Progress remains specific to the study track');
  assert.equal(app.d.querySelector('[data-favorite="limites"]').getAttribute('aria-pressed'), 'true', 'Favourites remain shared by lesson ID');
  visit(app, '/track/pc');
  app.d.querySelector('[data-filter="completed"]').click();
  assert.equal(app.d.querySelectorAll('.lesson-card').length, 1);
  changeLanguage(app, 'en');
  assert.equal(app.d.querySelectorAll('.lesson-card').length, 1, 'Filter survives language switching');
  assert.equal(app.d.querySelector('[data-filter="completed"]').getAttribute('aria-pressed'), 'true');
  visit(app, '/favorites');
  app.d.querySelector('[data-favorite="limites"]').click();
  assert.equal(app.d.querySelectorAll('.lesson-card').length, 0);
  assert.equal(JSON.parse(app.w.localStorage.getItem(learningKey)).favorites.length, 0);
  // Clear the transient notification before exercising independent UI states.
  app.d.querySelector('.toast')?.remove();
  visit(app, '/videos?track=pc');
  changeLanguage(app, 'fr');
  assert.equal(app.d.getElementById('video-track').value, 'pc');
  assertPlayers(app, app.data('fr').lessons.filter(l => l.tracks.includes('pc')).flatMap(l => l.videos));
  const select = app.d.getElementById('video-track');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Video filter did not navigate')), 1500);
    app.w.addEventListener('hashchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    select.value = 'sm';
    select.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  });
  assert.equal(app.w.location.hash, '#/videos?track=sm');
  assertPlayers(app, app.data('fr').lessons.filter(l => l.tracks.includes('sm')).flatMap(l => l.videos));
  assert.deepEqual(app.errors, []);
  app.close();
}

async function checkNarrationFilters() {
  const app = makeApp({ url: 'https://academy.invalid/?lang=ar#/videos' });
  async function act(action, expectedRoute) {
    if (app.w.location.hash === '#' + expectedRoute) action();
    else await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Narration filter did not navigate to ${expectedRoute}`)), 1500);
      app.w.addEventListener('hashchange', () => { clearTimeout(timer); resolve(); }, { once: true });
      action();
    });
    assert.equal(app.w.location.hash, '#' + expectedRoute);
    assertRendered(app, expectedRoute);
    counters.narrationFilterChecks++;
  }
  const chooseAudio = (audio, route) => act(() => app.d.querySelector(`[data-video-audio="${audio}"]`).click(), route);
  const chooseTrack = (track, route) => act(() => {
    const select = app.d.getElementById('video-track');
    select.value = track;
    select.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  }, route);
  for (const lang of languages) {
    changeLanguage(app, lang);
    visit(app, '/videos');
    const data = app.data(lang);
    const allVideos = data.lessons.flatMap(lesson => lesson.videos);
    for (const [audio, count, key] of [['',31,'allVideos'],['current',1,'currentLanguageNarration'],['narrated',8,'withNarration'],['silent',23,'withoutNarration']]) {
      const button = app.d.querySelector(`[data-video-audio="${audio}"]`);
      assert(button && !button.closest('details,[hidden]'), 'Audio filters are immediately visible');
      assert(button.textContent.startsWith(app.messages()[key]));
      assert.equal(Number(button.querySelector('.count').textContent), count);
    }
    await chooseAudio('current', '/videos?audio=current');
    assert.equal(app.d.querySelector('[data-video-audio="current"]').getAttribute('aria-pressed'), 'true');
    assertPlayers(app, allVideos.filter(video => !video.silent && video.audioLanguage === lang));
    const nextLanguage = languages[(languages.indexOf(lang) + 1) % languages.length];
    changeLanguage(app, nextLanguage);
    assert.equal(app.w.location.hash, '#/videos?audio=current');
    assertPlayers(app, app.data(nextLanguage).lessons.flatMap(lesson => lesson.videos).filter(video => !video.silent && video.audioLanguage === nextLanguage));
    changeLanguage(app, lang);
    await chooseAudio('narrated', '/videos?audio=narrated');
    assertPlayers(app, allVideos.filter(video => !video.silent));
    await chooseAudio('silent', '/videos?audio=silent');
    assertPlayers(app, allVideos.filter(video => video.silent));
    await chooseTrack('pc', '/videos?track=pc&audio=silent');
    assertPlayers(app, data.lessons.filter(lesson => lesson.tracks.includes('pc')).flatMap(lesson => lesson.videos).filter(video => video.silent));
    await chooseAudio('current', '/videos?track=pc&audio=current');
    await chooseTrack('sm', '/videos?track=sm&audio=current');
    assertPlayers(app, allVideos.filter(video => !video.silent && video.audioLanguage === lang));
    const reloaded = makeApp({ url: app.w.location.href, saved: snapshot(app) });
    assert.equal(reloaded.d.querySelector('[data-video-audio="current"]').getAttribute('aria-pressed'), 'true');
    assert.equal(reloaded.d.getElementById('video-track').value, 'sm');
    assertPlayers(reloaded, allVideos.filter(video => !video.silent && video.audioLanguage === lang));
    assert.deepEqual(reloaded.errors, []);
    reloaded.close();
    await chooseAudio('', '/videos?track=sm');
    assertPlayers(app, data.lessons.filter(lesson => lesson.tracks.includes('sm')).flatMap(lesson => lesson.videos));
  }
  visit(app, '/videos?audio=unknown');
  assert.equal(app.d.querySelectorAll('video').length, 31, 'Unknown audio filter falls back to all videos');
  assert.equal(app.d.querySelector('[data-video-audio=""]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(app.errors, []);
  app.close();
}

async function checkSearch() {
  const app = makeApp();
  const targetId = 'derivation';
  for (const displayLanguage of languages) {
    changeLanguage(app, displayLanguage);
    for (const queryLanguage of languages) {
      const query = app.data(queryLanguage).lessons.find(l => l.id === targetId).title;
      visit(app, '/search');
      app.d.getElementById('page-search').value = query;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Search form did not navigate')), 1500);
        app.w.addEventListener('hashchange', () => { clearTimeout(timer); resolve(); }, { once: true });
        app.d.getElementById('search-page-form').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
      });
      const main = assertRendered(app, app.w.location.hash);
      assert.equal(app.d.getElementById('page-search').value, query);
      assert(main.querySelector(`a[href*="/lesson/${targetId}/"]`), `${displayLanguage} search finds ${queryLanguage} course title`);
      const otherLanguage = languages[(languages.indexOf(displayLanguage) + 1) % languages.length];
      changeLanguage(app, otherLanguage);
      assert.equal(app.d.getElementById('page-search').value, query, 'Search query survives an actual change of language');
      assert(app.d.querySelector(`a[href*="/lesson/${targetId}/"]`), 'Cross-language result survives switching the interface');
      changeLanguage(app, displayLanguage);
    }
    visit(app, '/search?q=derivation');
    assert(app.d.querySelector(`a[href*="/lesson/${targetId}/"]`), 'Accent-insensitive French search');
    app.d.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    assert(app.d.getElementById('search-dialog').open);
    const input = app.d.getElementById('dialog-search');
    input.value = app.data('fr').lessons.find(l => l.id === targetId).title;
    input.dispatchEvent(new app.w.Event('input', { bubbles: true }));
    const result = app.d.querySelector(`#search-dialog-results a[href*="/lesson/${targetId}/"]`);
    const destination = result.getAttribute('href').slice(1);
    await clickRoute(app, result, destination);
    assert(!app.d.getElementById('search-dialog').open);
  }
  visit(app, '/search?q=' + encodeURIComponent('<img src=x onerror="window.hacked=true">'));
  assert.equal(app.w.hacked, undefined);
  assert.equal(app.d.querySelector('#main-content img'), null);
  assert.equal(app.d.getElementById('page-search').value, '<img src=x onerror="window.hacked=true">');
  assert.deepEqual(app.errors, []);
  app.close();
}

async function checkMobileAndFallbacks() {
  const app = makeApp({ mobile: true });
  for (const lang of languages) {
    changeLanguage(app, lang);
    const sidebar = app.d.getElementById('sidebar'), menu = app.d.getElementById('menu-button');
    assert.equal(sidebar.getAttribute('aria-hidden'), 'true');
    assert.equal(sidebar.inert, true);
    menu.click();
    assert.equal(sidebar.getAttribute('aria-hidden'), 'false');
    assert.equal(sidebar.inert, false);
    assert.equal(menu.getAttribute('aria-expanded'), 'true');
    assert(app.d.body.classList.contains('no-scroll'));
    assert.equal(app.d.querySelector('.app-shell').inert, true, 'Background is inaccessible while the mobile drawer is open');
    const links = [...sidebar.querySelectorAll('a[href]')];
    assert.equal(app.d.activeElement, links[0]);
    links.at(-1).focus();
    app.d.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(app.d.activeElement, links[0]);
    app.d.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(app.d.activeElement, links.at(-1));
    app.d.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(app.d.activeElement, menu);
    assert.equal(sidebar.getAttribute('aria-hidden'), 'true');
    assert(!app.d.body.classList.contains('no-scroll'));
    assert.equal(app.d.querySelector('.app-shell').inert, false);
    menu.click();
    app.d.getElementById('drawer-scrim').click();
    assert.equal(sidebar.inert, true);
    assert.equal(app.d.activeElement, menu, 'Scrim dismissal restores focus outside the now-hidden drawer');
    menu.click();
    await clickRoute(app, sidebar.querySelector('a[href="#/videos"]'), '/videos');
    assert.equal(sidebar.getAttribute('aria-hidden'), 'true');
    visit(app, '/');
  }
  app.setMobile(false);
  assert.equal(app.d.getElementById('sidebar').getAttribute('aria-hidden'), 'false');
  assert.equal(app.d.getElementById('sidebar').inert, false);
  assert.deepEqual(app.errors, []);
  app.close();
  const corrupted = makeApp({ saved: { [languageKey]: 'unsupported', [learningKey]: '{invalid json' } });
  assertChrome(corrupted, 'ar');
  assert(corrupted.d.getElementById('main-content').textContent.length > 10);
  corrupted.close();
  const blocked = makeApp({ blockStorage: true });
  visit(blocked, '/track/pc/lesson/limites/cours');
  blocked.d.querySelector('[data-favorite]').click();
  blocked.d.querySelector('.toast')?.remove();
  changeLanguage(blocked, 'en');
  assert.equal(blocked.d.querySelector('[data-favorite]').getAttribute('aria-pressed'), 'true');
  assert(blocked.d.querySelector('.local-progress p').textContent.includes(blocked.messages().localUnavailable));
  assert.deepEqual(blocked.errors, []);
  blocked.close();
}

(async () => {
  try {
    const first = makeApp();
    checkData(first);
    assert.deepEqual(first.errors, []);
    first.close();
    await checkInteractions();
    await checkNarrationFilters();
    await checkSearch();
    await checkMobileAndFallbacks();
    for (const lang of ['fr', 'ar', 'en']) await sweepLocale(lang);
    console.log(JSON.stringify({ status: 'passed', ...counters, note: 'Real bundled content, jsdom integration, and ffprobe audio-stream verification. No visual layout or listening-quality claim.' }));
  } catch (error) {
    console.error(error.stack || error);
    console.error(JSON.stringify({ completedBeforeFailure: counters }));
    process.exitCode = 1;
  } finally {
    for (const w of windows) w.close();
  }
})();
