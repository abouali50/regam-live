/* Meaningful integration checks against authored content and the real DOM.
 * No browser, external resource loading, account, network or server mutation.
 * Run npm install --ignore-scripts, then npm test.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'site', name), 'utf8');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(String(error)));
virtualConsole.on('error', error => errors.push(String(error)));
const dom = new JSDOM(read('index.html'), {
  url: 'https://academy.invalid/#/', runScripts: 'outside-only', virtualConsole,
});
const { window } = dom;
const document = window.document;
let isMobile = false;
window.matchMedia = query => ({ matches: query.includes('max-width') ? isMobile : false, media: query, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.print = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
for (const file of ['assets/vendor/katex.min.js', 'assets/vendor/auto-render.min.js', 'data/courses.js']) window.eval(read(file));
const data = window.REGAM_DATA;
assert.equal(data.lessons.length, 25);
assert.equal(data.lessons.filter(l => l.tracks.includes('pc')).length, 18);
assert.equal(data.lessons.filter(l => l.tracks.includes('sm')).length, 23);
assert.equal(data.lessons.reduce((n, l) => n + l.exercises.length, 0), 75);

let formulaCount = 0;
function checkFormulae(value, location) {
  if (typeof value === 'string') {
    const re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
    let match;
    while ((match = re.exec(value))) {
      assert.doesNotThrow(() => window.katex.renderToString(match[1] ?? match[2] ?? match[3], { throwOnError: true, strict: 'ignore' }), location);
      formulaCount++;
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => checkFormulae(v, `${location}.${i}`));
  else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) checkFormulae(v, `${location}.${key}`);
}
checkFormulae(data, 'data');
window.eval(read('assets/app.js'));
let routeCount = 0;
function visit(route) {
  window.history.replaceState(null, '', '#' + route);
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  const main = document.getElementById('main-content');
  assert(main.textContent.trim().length > 10, route);
  assert(!main.querySelector('.katex-error'), `Math render error on ${route}`);
  assert(!main.innerHTML.includes('undefined'), `Undefined text on ${route}`);
  assert(!main.textContent.includes('هاد الصفحة ما لقيناهاش'), `Missing valid route ${route}`);
  routeCount++;
  return main;
}
visit('/');
for (const track of data.tracks) {
  visit(`/track/${track.id}`);
  for (const domain of data.domains.filter(d => data.lessons.some(l => l.tracks.includes(track.id) && l.domain === d.id))) visit(`/track/${track.id}/domain/${domain.id}`);
  for (const lesson of data.lessons.filter(l => l.tracks.includes(track.id))) {
    for (const tab of ['cours', 'resume', 'exercices', 'videos']) {
      const main = visit(`/track/${track.id}/lesson/${lesson.id}/${tab}`);
      assert.equal(main.querySelector('h1').textContent, lesson.title);
      if (tab === 'cours') assert.equal(main.querySelectorAll('.course-section').length, lesson.sections.length);
      if (tab === 'exercices') assert.equal(main.querySelectorAll('.solution-details').length, lesson.exercises.length);
      if (tab === 'videos') assert.equal(main.querySelectorAll('video source').length, lesson.videos.length);
      for (const node of main.querySelectorAll('video source,video track,video[poster]')) {
        const src = node.getAttribute('src') || node.getAttribute('poster');
        assert(fs.existsSync(path.join(root, 'site', src)), `Missing media ${src}`);
      }
    }
  }
}

// Regression: strict inequalities must survive HTML parsing as actual TeX.
const limitsPage = visit('/track/pc/lesson/limites/cours');
assert([...limitsPage.querySelectorAll('annotation')].some(el => el.textContent === 'x<0'), 'Inequality swallowed by HTML parser');
// Lesson prerequisites resolve to real titles, not internal slugs.
const functionPage = visit('/track/pc/lesson/etude-fonction/cours');
assert(functionPage.querySelector('.prerequisites a[href*="/limites/"]'), 'Missing prerequisite link');

// Favorites and completion persist in the same browser and update the DOM.
document.querySelector('[data-favorite="etude-fonction"]').click();
assert(JSON.parse(window.localStorage.getItem('regam-maths-learning-v1')).favorites.includes('etude-fonction'));
document.querySelector('[data-complete="etude-fonction"]').click();
assert(JSON.parse(window.localStorage.getItem('regam-maths-learning-v1')).progress['pc:etude-fonction']);
const favoritePage = visit('/favorites');
assert(favoritePage.textContent.includes(data.lessons.find(l => l.id === 'etude-fonction').title));

// Correct and incorrect quizzes use data answers, not a hard-coded first option.
visit('/track/pc/lesson/limites/exercices');
let form = document.querySelector('.quiz-card');
form.querySelector('[value="0"]').checked = true;
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assert(!form.querySelector('.quiz-feedback').hidden);
form.querySelector('[value="1"]').checked = true;
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assert(form.querySelector('.quiz-feedback').textContent.includes('صحيح'));

const searchPage = visit('/search?q=derivation');
assert(searchPage.querySelector('a[href*="/derivation/"]'), 'Accent-insensitive search');
visit('/search?q=%3Cscript%3Ewindow.hacked%3Dtrue%3C%2Fscript%3E');
assert.equal(window.hacked, undefined);
visit('/sources');

// Keyboard search, theme and mobile drawer work without a rendering engine.
document.getElementById('theme-button').click();
assert.equal(document.documentElement.dataset.theme, 'dark');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
assert(document.getElementById('search-dialog').open);
document.getElementById('close-search').click();
isMobile = true;
window.dispatchEvent(new window.Event('resize'));
assert.equal(document.getElementById('sidebar').getAttribute('aria-hidden'), 'true');
document.getElementById('menu-button').click();
assert.equal(document.getElementById('sidebar').getAttribute('aria-hidden'), 'false');
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert.equal(document.getElementById('sidebar').getAttribute('aria-hidden'), 'true');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ status: 'passed', formulaCount, validRoutes: routeCount, lessons: data.lessons.length, exercises: 75, videos: data.lessons.reduce((n, l) => n + l.videos.length, 0), note: 'DOM checks only. No visual or audio review is claimed.' }));
window.close();
