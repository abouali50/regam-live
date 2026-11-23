/* Integration checks for the function-study journey and timed video chapters.
 * Uses the real app and locale bundle. Media playback is stubbed: these checks
 * cover navigation, stored review progress and player controls, not audio quality.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'site', name), 'utf8');
const learningKey = 'regam-maths-learning-v1';
const route = '/parcours/etude-fonctions';
const ordered = ['limites', 'continuite', 'derivation', 'fonctions-reciproques', 'logarithme', 'exponentielle', 'etude-fonction', 'primitives-integrales'];
const languages = ['ar', 'fr', 'en'];
const windows = new Set();
const counters = { locales: 0, progressScenarios: 0, chapterScenarios: 0, writtenStudies: 0, writtenFormulae: 0 };

function createApp(lang, { saved = {}, enhance } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(String(error)));
  virtualConsole.on('error', error => errors.push(String(error)));
  const dom = new JSDOM(read('index.html'), {
    url: `https://academy.invalid/?lang=${lang}#/`, runScripts: 'outside-only', virtualConsole,
  });
  const w = dom.window, d = w.document;
  windows.add(w);
  w.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  for (const file of ['assets/vendor/katex.min.js', 'assets/vendor/auto-render.min.js', 'data/courses.js', 'assets/i18n.js']) w.eval(read(file));
  if (enhance) enhance(w.REGAM_LOCALES, w);
  w.eval(read('assets/app.js'));
  const app = {
    w, d, errors,
    messages: () => w.REGAM_I18N[d.documentElement.lang],
    visit(next) {
      w.history.replaceState(null, '', '#' + next);
      w.dispatchEvent(new w.HashChangeEvent('hashchange'));
      assert.equal(errors.length, 0, errors.join('\n'));
      return d.getElementById('main-content');
    },
    progress() { return d.querySelector('[data-function-path-progress] [role="progressbar"]'); },
    close() { w.close(); windows.delete(w); },
  };
  return app;
}

function switchLanguage(app, lang) {
  const before = app.w.location.hash;
  const select = app.d.getElementById('language-select');
  select.value = lang;
  select.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  assert.equal(app.w.location.hash, before, 'Language changes preserve the active learning path');
  assert.equal(app.d.documentElement.lang, lang);
  assert.equal(app.d.documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr');
  assert.equal(app.d.querySelector('h1').textContent, app.messages().functionPathTitle);
}

async function switchTrack(app, track) {
  const select = app.d.getElementById('function-path-track');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Track selector did not navigate')), 1500);
    app.w.addEventListener('hashchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
    select.value = track;
    select.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  });
  assert.equal(app.w.location.hash, `#${route}?track=${track}`);
}

function progressValue(app) { return Number(app.progress().getAttribute('aria-valuenow')); }

function checkWrittenStudies(app, lang) {
  const section = app.d.querySelector('.function-written-studies');
  assert(section, `Missing written studies in ${lang}`);
  assert.equal(section.querySelector('h2').textContent, app.messages().functionStudiesTitle);
  assert.equal(section.querySelectorAll('video,[data-video-card]').length, 0, 'Written examples must not be presented as videos');
  const cards = [...section.querySelectorAll('[data-function-study]')];
  const expected = app.w.REGAM_LOCALES[lang].functionStudies;
  assert.equal(cards.length, 3);
  assert.equal(expected.length, 3);
  for (const card of cards) {
    const study = expected.find(item => item.id === card.dataset.functionStudy);
    assert(study, 'Every displayed study comes from the selected locale');
    assert.equal(card.querySelector('h3').textContent, study.title);
    assert.equal(card.querySelector('.function-study-copy > p').textContent, study.summary);
    assert.equal(card.querySelector('img').getAttribute('src'), study.image);
    assert(fs.existsSync(path.join(root, 'site', study.image)), `Missing written-study graph ${study.image}`);
    const details = card.querySelector('details');
    assert.equal(details.open, false);
    details.querySelector('summary').click();
    assert.equal(details.open, true, 'The explanation expands through its visible control');
    const steps = [...details.querySelectorAll('.function-study-steps > li')];
    assert.equal(steps.length, study.segments.length);
    assert.equal(steps.length, 16);
    steps.forEach((step, index) => {
      const segment = study.segments[index];
      assert.equal(step.querySelector('h4').textContent, segment.note);
      assert.equal(step.querySelector('.function-study-step-copy > p').textContent, segment.text);
      if (segment.equation) {
        assert.equal(step.querySelector('annotation[encoding="application/x-tex"]').textContent, segment.equation);
        counters.writtenFormulae++;
      }
    });
    assert.equal(details.querySelectorAll('.katex-error').length, 0, 'Every written equation renders');
    details.querySelector('summary').click();
    assert.equal(details.open, false, 'The explanation can be collapsed again');
    counters.writtenStudies++;
  }
}

(async () => {
  for (const lang of languages) {
    const app = createApp(lang), { d, w } = app;
    const feature = d.querySelector('[data-function-path-feature]');
    assert(feature, `Missing home entry in ${lang}`);
    assert.equal(feature.querySelector('h2').textContent, app.messages().functionPathTitle);
    assert.equal(feature.querySelector('[data-function-path-entry]').getAttribute('href'), `#${route}?track=pc`);
    app.visit('/videos?track=sm&audio=current');
    assert.equal(d.querySelector('[data-function-path-entry]').getAttribute('href'), `#${route}?track=sm`, 'Video library preserves selected track');
    const main = app.visit(`${route}?track=pc`);
    checkWrittenStudies(app, lang);
    assert.equal(d.querySelector('h1').textContent, app.messages().functionPathTitle);
    assert.equal(d.title, `${app.messages().functionPathTitle} | REGAM Academy`);
    assert.equal(d.documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal(d.querySelector('.side-link.active').getAttribute('href'), '#' + route);
    assert.deepEqual([...d.querySelectorAll('[data-function-step]')].map(item => item.dataset.functionStep), ordered);
    assert.equal(Number(app.progress().getAttribute('aria-valuemax')), ordered.length);
    assert.equal(progressValue(app), 0);
    assert.equal(d.querySelector('[data-function-next]').getAttribute('href'), '#/track/pc/lesson/limites/cours');
    for (const id of ordered) {
      const step = d.querySelector(`[data-function-step="${id}"]`);
      const lesson = w.REGAM_LOCALES[lang].lessons.find(item => item.id === id);
      assert.equal(step.querySelector('h3').textContent, lesson.title);
      for (const tab of ['cours', 'exercices', 'videos']) assert(step.querySelector(`a[href="#/track/pc/lesson/${id}/${tab}"]`));
      assert.equal(step.querySelector('[data-complete]').dataset.track, 'pc');
      assert.equal(step.querySelector('[data-function-videos] .count').textContent, String(lesson.videos.filter(video => video.src).length));
    }
    assert(!main.querySelector('.katex-error'));
    if (lang !== 'ar') assert(!/[\u0600-\u06ff]/u.test(main.textContent), `Untranslated Arabic in ${lang} path`);
    d.querySelector('[data-complete="limites"]').click();
    assert.equal(progressValue(app), 1);
    assert.equal(d.querySelector('[data-function-next]').getAttribute('href'), '#/track/pc/lesson/continuite/cours');
    assert.equal(JSON.parse(w.localStorage.getItem(learningKey)).progress['pc:limites'], true);
    app.visit('/track/pc/lesson/continuite/cours');
    d.querySelector('[data-complete="continuite"]').click();
    app.visit(`${route}?track=pc`);
    assert.equal(progressValue(app), 2, 'Reviewing a course in its existing page updates the path');
    for (const nextLang of languages) {
      switchLanguage(app, nextLang);
      assert.equal(progressValue(app), 2, 'Progress is independent of display language');
      assert.equal(d.querySelector('#function-studies-title').textContent, app.messages().functionStudiesTitle);
      const firstStudy = w.REGAM_LOCALES[nextLang].functionStudies[0];
      assert.equal(d.querySelector('[data-function-study] h3').textContent, firstStudy.title, 'Written studies follow the selected language');
    }
    await switchTrack(app, 'sm');
    assert.equal(progressValue(app), 0, 'SM has its own review progress');
    d.querySelector('[data-complete="limites"]').click();
    assert.equal(progressValue(app), 1);
    await switchTrack(app, 'pc');
    assert.equal(progressValue(app), 2, 'Returning to PC preserves its progress');
    const persisted = w.localStorage.getItem(learningKey);
    assert.equal(JSON.parse(persisted).progress['sm:limites'], true);
    const restored = createApp(lang, { saved: { [learningKey]: persisted } });
    restored.visit(`${route}?track=pc`);
    assert.equal(progressValue(restored), 2, 'Review progress survives a reload');
    restored.close();
    app.visit(route + '/unexpected');
    assert.equal(d.querySelector('h2').textContent, app.messages().notFound, 'A malformed path is not silently accepted');
    assert.deepEqual(app.errors, []);
    app.close();
    counters.locales++;
    counters.progressScenarios += 5;
  }

  const allReviewed = Object.fromEntries(ordered.map(id => [`pc:${id}`, true]));
  const finished = createApp('fr', { saved: { [learningKey]: JSON.stringify({ progress: allReviewed }) } });
  finished.visit(`${route}?track=pc`);
  assert.equal(progressValue(finished), ordered.length);
  assert(finished.d.querySelector('[data-function-next]').textContent.includes(finished.messages().functionPathReviewFirst));
  finished.d.querySelector('[data-complete="logarithme"]').click();
  assert.equal(progressValue(finished), ordered.length - 1);
  assert.equal(finished.d.querySelector('[data-function-next]').getAttribute('href'), '#/track/pc/lesson/logarithme/cours');
  finished.close();
  counters.progressScenarios++;

  // Add fixture metadata only in memory so new worked examples can arrive one
  // by one without phantom players or a hard-coded library count.
  const chapters = createApp('fr', { enhance(locales) {
    const written = locales.fr.functionStudies[0];
    written.segments[0] = { text: '<img src="x" onerror="window.studyInjected=true">', note: '<script>window.studyInjected=true</script>', equation: '0<x<1' };
    const study = locales.fr.lessons.find(lesson => lesson.id === 'etude-fonction');
    const base = study.videos[0];
    const example = (id, overrides) => ({
      ...base, id, title: id, src: `media/fr/${id}-narrated.mp4`, silent: false, audioLanguage: 'fr',
      transcript: [{ note: 'Domaine', text: 'Une première étape.', startSeconds: 0 }, { note: 'Variations', text: 'Une deuxième étape.', startSeconds: 12.75 }],
      ...overrides,
    });
    study.videos = [
      { ...base, transcript: [{ note: 'Ancien exemple', text: 'Texte sans repère temporel.' }] },
      example('etude-exponentielle', { transcript: [{ text: 'Valeur non valide.', startSeconds: -3 }] }),
      example('etude-rationnelle'),
      example('etude-logarithmique', { id: undefined, silent: true, transcript: [{ text: 'Explication écrite.' }] }),
      example('etude-rationnelle', { src: '' }),
    ];
  } });
  chapters.visit(`${route}?track=pc`);
  const writtenStep = chapters.d.querySelector('.function-study-steps > li');
  assert.equal(writtenStep.querySelectorAll('img,script').length, 0, 'Plain explanation text is escaped');
  assert.equal(writtenStep.querySelector('.function-study-step-copy > p').textContent, '<img src="x" onerror="window.studyInjected=true">');
  assert.equal(writtenStep.querySelector('h4').textContent, '<script>window.studyInjected=true</script>');
  assert.equal(writtenStep.querySelector('annotation[encoding="application/x-tex"]').textContent, '0<x<1', 'Inequalities survive HTML parsing');
  assert.equal(chapters.w.studyInjected, undefined);
  const cards = [...chapters.d.querySelectorAll('.function-path-examples [data-video-card]')];
  assert.equal(cards.length, 3, 'Only the actual available worked examples are displayed');
  assert.deepEqual(cards.map(card => card.querySelector('source').getAttribute('src')), [
    'media/fr/etude-rationnelle-narrated.mp4', 'media/fr/etude-logarithmique-narrated.mp4', 'media/fr/etude-exponentielle-narrated.mp4',
  ]);
  assert.equal(cards[0].querySelector('.video-format-label').textContent, chapters.messages().frenchAudio);
  assert.equal(cards[1].querySelector('.video-format-label').textContent, chapters.messages().silentLabel, 'Silent metadata is never relabelled as narrated');
  assert.equal(cards[1].querySelectorAll('[data-video-seek]').length, 0, 'Legacy transcripts need no artificial chapters');
  assert.equal(cards[2].querySelectorAll('[data-video-seek]').length, 0, 'Invalid timestamps do not become seek controls');
  const ready = cards[0].querySelector('video');
  assert(ready.hasAttribute('controls') && ready.hasAttribute('playsinline'));
  assert(!ready.hasAttribute('muted') && !ready.hasAttribute('autoplay'));
  assert.equal(ready.getAttribute('preload'), 'none');
  const buttons = [...cards[0].querySelectorAll('[data-video-seek]')];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].querySelector('.mono').textContent, '0:00');
  assert.equal(buttons[1].querySelector('.mono').textContent, '0:12');
  assert.equal(cards[0].querySelector('.video-transcript li strong').textContent, 'Domaine');
  assert.equal(cards[0].querySelector('.video-transcript li p').textContent, 'Une première étape.');
  Object.defineProperty(ready, 'readyState', { configurable: true, value: 1 });
  Object.defineProperty(ready, 'duration', { configurable: true, value: 60 });
  let plays = 0;
  ready.play = () => { plays++; return Promise.resolve(); };
  buttons[1].click();
  assert.equal(ready.currentTime, 12.75);
  assert.equal(plays, 1);
  assert.equal(cards[1].querySelector('video').currentTime, 0, 'A chapter controls only its own video');
  counters.chapterScenarios++;

  Object.defineProperty(ready, 'readyState', { configurable: true, value: 0 });
  ready.currentTime = 0;
  buttons[1].click();
  assert.equal(ready.currentTime, 0, 'Seek waits for initially missing metadata');
  assert.equal(plays, 2, 'Playback is requested from the click gesture');
  Object.defineProperty(ready, 'readyState', { configurable: true, value: 1 });
  ready.dispatchEvent(new chapters.w.Event('loadedmetadata'));
  assert.equal(ready.currentTime, 12.75);
  counters.chapterScenarios++;

  ready.play = () => Promise.reject(new Error('Playback unavailable in test'));
  buttons[0].click();
  await Promise.resolve();
  assert.equal(cards[0].querySelector('.video-load-error').hidden, false);
  assert.equal(cards[0].querySelector('.video-load-error').textContent, chapters.messages().videoChapterPlayHelp);
  assert.deepEqual(chapters.errors, []);
  counters.chapterScenarios++;
  chapters.close();
  console.log(JSON.stringify({ status: 'passed', ...counters, note: 'DOM and control tests only; no visual, listening or media playback claim.' }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const w of windows) w.close(); });
