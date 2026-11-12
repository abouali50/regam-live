// End-to-end test. The real media server (MediaMTX) is replaced by a stand-in:
// a headless browser page acting as a tiny relay that speaks the same WHIP/WHEP
// HTTP protocol, plus ffmpeg producing an HLS stream. Everything else is the real app.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium, devices } = require('playwright');

const OUT = process.env.OUT || path.join(__dirname, 'out');
const HLS_DIR = path.join(OUT, 'hls');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(HLS_DIR, 'air_main'), { recursive: true });
const AUTH = 'Basic ' + Buffer.from('regam:mtxpass').toString('base64');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() > end) return null; await sleep(step); }
}

(async () => {
  const openChat = (ctx) => ctx.addInitScript(() => { try { if (!localStorage.getItem('regam.chat')) localStorage.setItem('regam.chat', 'open'); } catch {} });
  const browser = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required',
  ] });

  // ---- stand-in relay (browser page) -------------------------------------
  const sfu = await (await browser.newContext()).newPage();
  await sfu.goto('about:blank');
  await sfu.evaluate(() => {
    const ice = (pc) => new Promise((res) => { if (pc.iceGatheringState === 'complete') return res(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && res(); setTimeout(res, 2000); });
    window.paths = {}; window.pcs = {};
    window.publish = async (name, sdp, id) => {
      const pc = new RTCPeerConnection(); const stream = new MediaStream();
      pc.ontrack = (e) => stream.addTrack(e.track);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer()); await ice(pc);
      window.paths[name] = stream; window.pcs[id] = { pc, name, pub: true };
      const v = document.createElement('video'); v.muted = true; v.autoplay = true; v.srcObject = stream; v.id = 'v_' + name; document.body.append(v);
      return pc.localDescription.sdp;
    };
    window.read = async (name, sdp, id) => {
      const stream = window.paths[name]; if (!stream) return null;
      const pc = new RTCPeerConnection();
      await pc.setRemoteDescription({ type: 'offer', sdp });
      for (const t of pc.getTransceivers()) {
        const track = stream.getTracks().find((x) => x.kind === t.receiver.track.kind);
        if (track) { await t.sender.replaceTrack(track); t.direction = 'sendonly'; } else t.direction = 'inactive';
      }
      await pc.setLocalDescription(await pc.createAnswer()); await ice(pc);
      window.pcs[id] = { pc, name };
      return pc.localDescription.sdp;
    };
    window.drop = (id) => { const s = window.pcs[id]; if (!s) return; s.pc.close(); delete window.pcs[id];
      if (s.pub) { delete window.paths[s.name]; const v = document.getElementById('v_' + s.name); if (v) v.remove(); } };
  });

  const seen = { unauth: 0, posts: [], recConf: {}, recCalls: [], translated: [], ai: [] };
  let sid = 0;
  const rtc = http.createServer(async (req, res) => {
    const m = req.url.match(/^\/([a-z0-9_-]+)\/(whip|whep)(?:\/(\w+))?$/);
    if (!m) { res.writeHead(404); return res.end(); }
    if (req.headers.authorization !== AUTH) { seen.unauth++; res.writeHead(401); return res.end(); }
    if (req.method === 'DELETE') { await sfu.evaluate((id) => window.drop(id), m[3]); res.writeHead(200); return res.end(); }
    let body = ''; for await (const c of req) body += c;
    const id = 's' + (++sid);
    seen.posts.push(`${m[2]}:${m[1]}`);
    const answer = await sfu.evaluate(([fn, name, sdp, i]) => window[fn](name, sdp, i), [m[2] === 'whip' ? 'publish' : 'read', m[1], body, id]);
    if (!answer) { res.writeHead(404); return res.end('no stream'); }
    res.writeHead(201, { 'Content-Type': 'application/sdp', Location: `/${m[1]}/${m[2]}/${id}` });
    res.end(answer);
  }).listen(18889);
  const api = http.createServer(async (req, res) => {
    // like MediaMTX: every room being published to has its "air_<room>" path available
    if (req.url.startsWith('/v3/config/paths/')) {           // recording switched on or off for one room
      let body = ''; for await (const c of req) body += c;
      const [, verb, name] = req.url.match(/paths\/(\w+)\/(.+)$/) || [];
      const known = !!seen.recConf[name], okAuth = req.headers.authorization === AUTH;
      const good = okAuth && (verb === 'add' ? !known : known);
      if (good) seen.recConf[name] = JSON.parse(body).record;
      seen.recCalls.push(`${verb}:${name}:${good}`);
      res.writeHead(good ? 200 : verb === 'patch' ? 404 : 400, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    const ok = req.headers.authorization === AUTH && req.url.startsWith('/v3/paths/list');
    const names = ok ? await sfu.evaluate(() => Object.keys(window.paths).filter((k) => k.startsWith('studio_')).map((k) => 'air_' + k.slice(7))) : [];
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ itemCount: names.length, pageCount: 1, items: names.map((name) => ({ name, available: true })) }));
  }).listen(19997);
  const lt = http.createServer(async (req, res) => {          // stands in for the translation service
    let body = ''; for await (const c of req) body += c;
    const q = JSON.parse(body || '{}');
    seen.translated.push(`${q.source}>${q.target}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ translatedText: `[${q.target}] ${q.q}` }));
  }).listen(15000);
  const aiSrv = http.createServer(async (req, res) => {       // stands in for the AI service
    let body = ''; for await (const c of req) body += c;
    const q = JSON.parse(body || '{}'), sys = String(q.system || ''), last = q.messages[q.messages.length - 1].content;
    seen.ai.push({ key: req.headers['x-api-key'], version: req.headers['anthropic-version'], model: q.model, system: sys, messages: q.messages });
    if (req.headers['x-api-key'] !== 'sk-test-key') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
    const text = /single word: OK/.test(sys) ? 'OK' : /public comments/.test(sys) ? (/salut/i.test(last.split('\n').pop()) ? 'SKIP' : 'MetaMask est un portefeuille.') : `AIDE ${q.messages.length} ${/LIVE NOW/.test(sys) ? 'direct' : 'hors ligne'}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  }).listen(15001);
  const hlsSrv = http.createServer((req, res) => {
    // like MediaMTX: without the CDN secret, a playlist request is answered with a redirect
    if (req.headers.authorization !== 'Bearer mtxpass') { seen.hlsNoSecret = (seen.hlsNoSecret || 0) + 1; res.writeHead(302, { Location: req.url + '?cookieCheck=1' }); return res.end(); }
    const f = path.join(HLS_DIR, path.normalize(req.url.split('?')[0].replace(/^\/air_[a-z0-9-]+\//, '/air_main/')));
    fs.readFile(f, (e, d) => { res.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' }); res.end(e ? '' : d); });
  }).listen(18888);

  // HLS the test browser can decode (it has no H.264): VP9 + Opus in fMP4.
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '400k', '-g', '25',
    '-c:a', 'libopus', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '6', '-hls_flags', 'delete_segments', '-hls_segment_type', 'fmp4',
    path.join(HLS_DIR, 'air_main', 'index.m3u8')], { stdio: ['ignore', 'inherit', 'inherit'] });

  const app = spawn('node', [path.join(__dirname, '..', 'server.js')], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env,
    PORT: '13000', REC_DIR: path.join(OUT, 'rec'), ADMIN_PASSWORD: 'studio-pass-1', MTX_RTC: 'http://127.0.0.1:18889', MTX_HLS: 'http://127.0.0.1:18888', MTX_API: 'http://127.0.0.1:19997', MAIL_OUTBOX: path.join(OUT, 'outbox.jsonl'), WAIT_SOUND_URL: 'https://sound.test.invalid/rahman.mp3, https://sound.test.invalid/waqia.mp3 ,https://sound.test.invalid/hadid.mp3', TRANSLATE_URL: 'http://127.0.0.1:15000', AI_URL: 'http://127.0.0.1:15001',
    MTX_USER: 'regam', MTX_PASS: 'mtxpass', DATA_DIR: path.join(OUT, 'data'), HOST_NAME: 'Pro' } });
  const BASE = 'http://127.0.0.1:13000';
  fs.mkdirSync(path.join(OUT, 'rec', 'air_main'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'rec', 'air_main', '2026-11-10_20-30-00-000000.mp4'), Buffer.alloc(2_500_000, 7));
  fs.writeFileSync(path.join(OUT, 'rec', 'air_main', 'notes.txt'), 'x');
  await until(() => fetch(BASE + '/healthz').then((r) => r.ok));

  try {
    // ---- security checks on the API --------------------------------------
    check('login rejects a wrong password', (await fetch(BASE + '/api/login', { method: 'POST', body: '{"password":"nope"}' })).status === 401);
    check('publishing without a token is refused', (await fetch(BASE + '/api/rtc/whip/studio', { method: 'POST', body: 'x' })).status === 401);
    check('only the audience stream is exposed over HLS', (await fetch(BASE + '/hls/studio_main/index.m3u8')).status === 404 && (await fetch(BASE + '/hls/guest1_main/index.m3u8')).status === 404 && (await fetch(BASE + '/hls/air_nope/index.m3u8')).status === 404);
    check('path traversal is refused', [400, 404].includes((await fetch(BASE + '/%2e%2e/server.js')).status));

    // ---- viewer (desktop) -------------------------------------------------
    const vctx = await browser.newContext({ locale: 'ar-MA', viewport: { width: 1280, height: 760 }, permissions: ['camera', 'microphone'] });
    await openChat(vctx);
    const viewer = await vctx.newPage();
    const errors = [];
    viewer.on('pageerror', (e) => errors.push('viewer: ' + e.message));
    await viewer.goto(BASE + '/');
    check('viewer sees "offline" before the live starts', await viewer.locator('#offline').isVisible() && await viewer.locator('#handBtn').isHidden());

    // ---- studio ------------------------------------------------------------
    const sctx = await browser.newContext({ locale: 'ar-MA', viewport: { width: 1380, height: 900 }, permissions: ['camera', 'microphone'] });
    await openChat(sctx);
    const studio = await sctx.newPage();
    studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
    studio.on('dialog', (d) => d.accept());
    await studio.goto(BASE + '/studio?all=1');
    await studio.fill('#pw', 'bad');
    const pwType = () => studio.evaluate(() => document.querySelector('#pw').type);
    const hidden1 = await pwType(); await studio.click('.pw-eye'); const shown = await pwType(); await studio.click('.pw-eye');
    check('the eye button shows the typed password, then hides it again', hidden1 === 'password' && shown === 'text' && (await pwType()) === 'password' && (await studio.inputValue('#pw')) === 'bad');
    await studio.click('#loginForm button[type=submit]');
    check('studio shows an error on a wrong password', (await until(() => studio.locator('#loginErr').isVisible(), 5000)) !== null);
    await studio.fill('#pw', 'studio-pass-1'); await studio.click('#loginForm button[type=submit]');
    await studio.waitForSelector('#app:not([hidden])');
    const dim = () => studio.evaluate(() => { const v = document.querySelector('#preview'); return `${v.videoWidth}x${v.videoHeight}`; });
    check('mixer shows the camera in the preview (1280x720)', (await until(async () => (await dim()) === '1280x720')) !== null, await dim());

    await studio.click('#goBtn');
    check('studio connects and goes on air', (await until(() => studio.evaluate(() => window.__studio.pc && window.__studio.pc.connectionState === 'connected'))) !== null);
    check('viewer page switches to "live" by itself', (await until(() => viewer.locator('#liveBadge.on').isVisible())) !== null);
    check('audience player plays the HLS stream', (await until(() => viewer.evaluate(() => { const v = document.querySelector('#video'); return v.videoWidth > 0 && v.currentTime > 0.5; }), 25000)) !== null);
    check('relay receives mixed video + audio from the studio', (await until(() => sfu.evaluate(() => { const v = document.getElementById('v_studio_main'); return v && v.videoWidth === 1280 && window.paths.studio_main.getAudioTracks().length === 1; }))) !== null, await sfu.evaluate(() => { const v = document.getElementById('v_studio_main'); return v ? v.videoWidth + 'x' + v.videoHeight + ' audio=' + window.paths.studio_main.getAudioTracks().length : 'none'; }));

    // ---- chat + moderation --------------------------------------------------
    await viewer.fill('.composer input', 'سلام من المتفرج');
    await viewer.click('.composer button[type=submit]');
    await viewer.fill('#nameInput', 'كريم'); await viewer.click('#nameForm button[type=submit]');
    await viewer.fill('.composer input', 'سلام من المتفرج'); await viewer.click('.composer button[type=submit]');
    check('comment reaches the studio', (await until(() => studio.locator('.msg', { hasText: 'سلام من المتفرج' }).isVisible())) !== null);
    await viewer.fill('.composer input', 'تعليق ثاني بزربة'); await viewer.click('.composer button[type=submit]');
    check('slow mode blocks a second comment sent right away', (await until(() => viewer.locator('.note', { hasText: 'تسنى' }).isVisible(), 4000)) !== null);
    await studio.fill('.composer input', 'مرحبا بيكم'); await studio.click('.composer button[type=submit]');
    check('host comment is shown to viewers as host', (await until(() => viewer.locator('.msg.host', { hasText: 'مرحبا بيكم' }).isVisible())) !== null);
    await studio.fill('#titleInput', 'كيفاش تكري MetaMask'); await studio.click('#titleForm button');
    await studio.fill('#pinInput', 'التكوين كيبدا دابا'); await studio.click('#pinForm button');
    check('title and pinned message reach viewers', (await until(async () => (await viewer.textContent('#title')) === 'كيفاش تكري MetaMask' && await viewer.locator('.pinned').isVisible())) !== null);
    await viewer.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'attackeraaaaaaaa', name: 'x', token: 'admin.host.9999999999999.deadbeef' })); w.send(JSON.stringify({ t: 'pin', text: 'HACKED' })); }; });
    await sleep(700);
    check('a forged moderator token cannot pin a message', (await viewer.textContent('.pinned')) === 'التكوين كيبدا دابا');

    // ---- comment colours, spacing, dictation button -----------------------------------------
    await sleep(3200);
    await viewer.click('.color-btn'); await viewer.locator('.swatch').nth(1).click();
    await viewer.fill('.composer input', 'تعليق بالأزرق'); await viewer.click('.composer button[type=submit]');
    const blue = studio.locator('.msg', { hasText: 'تعليق بالأزرق' });
    check('a viewer picks a colour and everyone sees their comment in it', (await until(() => blue.isVisible())) !== null && (await blue.locator('.txt').evaluate((n) => getComputedStyle(n).color)) === 'rgb(106, 168, 255)');
    check('the name and the comment are separated by a space', /^كريم\s+تعليق بالأزرق/.test(await blue.evaluate((n) => n.innerText)));
    await viewer.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'colorcheat000001', name: 'x', color: 99 })); w.send(JSON.stringify({ t: 'color', c: '<b>' })); w.send(JSON.stringify({ t: 'msg', text: 'couleur invalide' })); }; });
    check('an invalid colour is ignored', (await until(() => studio.locator('.msg', { hasText: 'couleur invalide' }).isVisible())) !== null && (await studio.locator('.msg', { hasText: 'couleur invalide' }).locator('.txt').getAttribute('class')) === 'txt');
    check('the dictation button appears only where the browser can do speech to text', (await viewer.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition))) === (await viewer.locator('.mic-btn').isVisible()));

    // ---- hearts ------------------------------------------------------------------
    for (const k of [0, 3, 6]) { await viewer.click('.react-open'); await viewer.locator('#reactions button').nth(k).click(); await sleep(260); }
    await viewer.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'spammerbbbbbbbbb', name: 'x' })); for (let i = 0; i < 200; i++) w.send(JSON.stringify({ t: 'like' })); }; });
    check('the reactions are folded into one button; the box closes once one is picked', await viewer.locator('#reactions').isHidden() && (await viewer.click('.react-open'), await viewer.locator('#reactions').isVisible()) && (await viewer.screenshot({ path: path.join(OUT, 'reactions-open.png') }), await viewer.keyboard.press('Escape'), await viewer.locator('#reactions').isHidden()));
    check('all seven reactions are offered', (await viewer.locator('#reactions button').count()) === 7);
    await viewer.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'badreactccccccc1', name: 'x' })); for (const k of [7, -1, 'a', 2.5, null]) w.send(JSON.stringify({ t: 'react', k })); }; });
    const perKind = (page) => page.evaluate(() => [...document.querySelectorAll('#reactions .react-n')].map((n) => n.textContent).join(','));
    check('each reaction has its own counter, shown to viewers and in the studio', (await until(async () => (await perKind(studio)) === '1,0,1,1,0,0,1' && (await perKind(viewer)) === '1,0,1,1,0,0,1', 6000)) !== null, 'studio ' + await perKind(studio) + ' viewer ' + await perKind(viewer));
    const floated = [];
    await studio.exposeFunction('sawFloat', (e) => floated.push(e));
    await studio.evaluate(() => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => window.sawFloat(n.textContent)))).observe(document.querySelector('#hearts'), { childList: true }));
    await viewer.click('.react-open'); await viewer.locator('#reactions button').nth(3).click(); await sleep(300); await viewer.click('.react-open'); await viewer.locator('#reactions button').nth(0).click();
    check('the studio sees the same emoji float, not only hearts', (await until(() => floated.includes('😂') && floated.includes('👍'), 6000)) !== null, floated.join(' '));
    check('reactions are counted for everyone, and flooding is limited', (await until(async () => Number(await studio.textContent('#likes')) === 6, 6000)) !== null, 'studio shows ' + await studio.textContent('#likes'));

    // ---- guest on stage -------------------------------------------------------
    await viewer.click('#handBtn');
    check('stage request appears in the studio', (await until(() => studio.locator('#hands li', { hasText: 'كريم' }).isVisible())) !== null);
    check('the request is also shown in the bar at the top of the studio', await studio.locator('#waitBar', { hasText: 'كريم' }).isVisible() && await studio.evaluate(() => document.querySelector('#waitBar').getBoundingClientRect().top < 80));
    await studio.click('#hands li button');
    check('viewer receives the invitation', (await until(() => viewer.locator('#inviteDlg[open]').isVisible())) !== null);
    await viewer.click('#inviteYes');
    check('guest is on stage (camera published, sees the host in real time)', (await until(() => viewer.evaluate(() => { const v = document.querySelector('#video'); return !!v.srcObject && v.videoWidth > 0 && v.srcObject.getAudioTracks().length === 1; }), 20000)) !== null, 'studio: ' + await studio.textContent('#status') + ' | posts: ' + seen.posts.join(' ') + ' | paths: ' + await sfu.evaluate(() => Object.keys(window.paths).join(' ')));
    check('studio mixes the guest picture + voice', (await until(() => studio.locator('#onStage li', { hasText: 'على المنصة' }).isVisible(), 20000)) !== null && (await until(() => studio.evaluate(() => { const st = window.__studio.stage.get(1); return !!(st && st.node && st.sink && st.sink.srcObject); }), 8000)) !== null);
    await sleep(1500);
    check('media sessions opened: ' + seen.posts.join(' '), ['whip:studio_main', 'whip:backstage1_main', 'whip:guest1_main', 'whep:studio_main', 'whep:backstage1_main', 'whep:guest1_main'].every((k) => seen.posts.includes(k)));
    check('viewers are told who is on stage', true === await (async () => { const p = await vctx.newPage(); await p.goto(BASE + '/'); const ok = (await until(() => p.locator('#guestLine', { hasText: 'كريم' }).isVisible())) !== null; await p.close(); return ok; })());
    await studio.screenshot({ path: path.join(OUT, 'studio-guest.png') });
    await viewer.screenshot({ path: path.join(OUT, 'viewer-onstage.png') });

    // ---- a second guest joins the first -------------------------------------------------------
    check('the stage controls are a bar at the bottom of the screen, off the picture', await viewer.evaluate(() => { const bar = document.querySelector('#stageBar').getBoundingClientRect(), pic = document.querySelector('#player').getBoundingClientRect(); return bar.height > 0 && bar.top >= pic.bottom - 1 && Math.abs(bar.bottom - innerHeight) < 2 && bar.width >= innerWidth - 2; }));
    const g2ctx = await browser.newContext({ locale: 'ar-MA', viewport: { width: 900, height: 700 }, permissions: ['camera', 'microphone'] });
    const g2 = await g2ctx.newPage();
    g2.on('pageerror', (e) => errors.push('guest2: ' + e.message));
    await g2.goto(BASE + '/');
    check('comments are folded for a new visitor, with a counter of what arrives', (await until(() => g2.locator('#liveBadge.on').isVisible())) !== null && await g2.locator('.composer').isHidden() && await g2.locator('.msgs').isHidden());
    await studio.fill('.composer input', 'مرحبا بالضيف الثاني'); await studio.click('.composer button[type=submit]');
    check('the counter shows the new comment, and a click opens the comments', (await until(async () => (await g2.textContent('.chat-unread')) === '1' && await g2.locator('.chat-unread').isVisible(), 6000)) !== null
      && (await g2.click('.chat-head'), await g2.locator('.msg', { hasText: 'مرحبا بالضيف الثاني' }).isVisible()) && await g2.locator('.chat-unread').isHidden());
    await g2.click('#handBtn'); await g2.fill('#nameInput', 'سلمى'); await g2.click('#nameForm button[type=submit]');
    await until(() => studio.locator('#hands li', { hasText: 'سلمى' }).isVisible());
    await studio.click('#hands li button');
    await until(() => g2.locator('#inviteDlg[open]').isVisible()); await g2.click('#inviteYes');
    check('two guests are on stage together, each on their own media paths', (await until(() => studio.evaluate(() => { const a = window.__studio.stage.get(1), b = window.__studio.stage.get(2); return !!(a && a.node && b && b.node); }), 25000)) !== null
      && (await sfu.evaluate(() => ['guest1_main', 'guest2_main', 'backstage1_main', 'backstage2_main'].every((k) => !!window.paths[k]))) && (await studio.locator('#onStage li').count()) === 2);
    check('each guest gets a sound mix (host + the others) and the picture stays 1280x720', (await until(() => g2.evaluate(() => { const v = document.querySelector('#video'); return !!v.srcObject && v.srcObject.getAudioTracks().length === 1 && v.videoWidth > 0; }), 20000)) !== null && (await dim()) === '1280x720');
    await studio.click('.who-btn');
    check('a click on the viewer count lists who is watching, the host first', (await until(async () => { const t = await studio.locator('.who-list li').allTextContents(); return t.length >= 3 && t[0].startsWith('Pro') && t.some((x) => x === 'كريم') && t.some((x) => x === 'سلمى'); }, 8000)) !== null, (await studio.locator('.who-list li').allTextContents()).join(' | '));
    await studio.click('.who-dlg .btn');
    // ---- with the whiteboard on, the guests are not squeezed beside it: they are on a second page
    {
      const corner = () => studio.evaluate(() => { const v = document.querySelector('#preview'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0); const px = (fx, fy) => [...x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3); return { left: px(0.5, 0.3), right: px(0.93, 0.3) }; });
      const white = (p) => p.every((v) => v > 235);
      await studio.click('#boardBtn');
      await until(async () => white((await corner()).left), 8000);
      const onBoard = await corner();
      check('the whiteboard fills the picture, with no column of guests beside it', white(onBoard.left) && white(onBoard.right) && await studio.locator('#pageBar').isVisible(), JSON.stringify(onBoard));
      await studio.click('#pagePeople');
      const people = await until(async () => { const c = await corner(); return !white(c.left) && c; }, 8000);
      check('the host turns to the page of the guests, and back to the board', !!people && (await studio.click('#pageBoard'), (await until(async () => white((await corner()).left), 8000)) !== null));
      await studio.click('#boardBtn');
      check('without the board, the page buttons go away', await studio.locator('#pageBar').isHidden());
    }
    // ---- three more people are accepted one after the other, before any of them has joined
    const extra = [];
    for (const name of ['يوسف', 'هدى', 'عمر']) {
      const c = await browser.newContext({ locale: 'ar-MA', viewport: { width: 700, height: 600 }, permissions: ['camera', 'microphone'] });
      const p = await c.newPage();
      p.on('pageerror', (e) => errors.push('guest ' + name + ': ' + e.message));
      await p.goto(BASE + '/');
      await until(() => p.locator('#liveBadge.on').isVisible());
      await p.click('#handBtn'); await p.fill('#nameInput', name); await p.click('#nameForm button[type=submit]');
      extra.push(p);
    }
    await until(async () => (await studio.locator('#hands li').count()) === 3);
    for (let i = 0; i < 3; i++) { await studio.locator('#hands li button').first().click(); await sleep(150); }
    for (const p of extra) await until(() => p.locator('#inviteDlg[open]').isVisible());
    await Promise.all(extra.map((p, i) => p.click(i === 2 ? '#inviteMic' : '#inviteYes')));       // the third comes up with the microphone only
    check('five guests are on stage at once, each heard by the audience', (await until(() => studio.evaluate(() => [1, 2, 3, 4, 5].every((n) => { const s = window.__studio.stage.get(n); return !!(s && s.node); })), 40000)) !== null
      && (await studio.locator('#onStage li').count()) === 5, await studio.evaluate(() => JSON.stringify([...window.__studio.stage].map(([n, s]) => [n, !!s.rx, !!s.node, !!s.back]))));
    check('every one of the five sees the stage and hears the others', (await until(async () => { for (const p of [viewer, g2, ...extra]) if (!(await p.evaluate(() => { const v = document.querySelector('#video'); return !!v.srcObject && v.srcObject.getAudioTracks().length === 1 && v.videoWidth > 0; }))) return false; return true; }, 30000)) !== null);
    await studio.screenshot({ path: path.join(OUT, 'studio-5-guests.png') });
    // camera on or off: the third guest came up without a camera, then turns it on, then off again
    const omar = extra[2], omarLi = studio.locator('#onStage li', { hasText: 'عمر' });
    check('a guest can come up with the microphone only: a name card stands in for the camera', (await until(() => omarLi.locator('text=بلا كاميرا').isVisible(), 8000)) !== null
      && await omar.evaluate(() => document.querySelector('#camBtn').textContent === 'حل الكاميرا') && (await studio.locator('#onStage li', { hasText: 'بلا كاميرا' }).count()) === 1);
    await sleep(600); await studio.screenshot({ path: path.join(OUT, 'studio-guest-no-camera.png') });
    await omar.click('#camBtn');
    check('the guest turns the camera on while on stage', (await until(async () => (await studio.locator('#onStage li', { hasText: 'بلا كاميرا' }).count()) === 0, 8000)) !== null
      && (await until(() => omar.evaluate(() => document.querySelector('#camBtn').textContent === 'سد الكاميرا'), 5000)) !== null);
    await omar.click('#camBtn');
    check('and off again, without leaving the stage', (await until(() => omarLi.locator('text=بلا كاميرا').isVisible(), 8000)) !== null && await omar.locator('#stageBar').isVisible()
      && await studio.evaluate(() => { const s = window.__studio.stage.get(5) || {}; return !!s.rx && s.rx.pc.connectionState === 'connected'; }));
    await omar.click('#camBtn'); await until(async () => (await studio.locator('#onStage li', { hasText: 'بلا كاميرا' }).count()) === 0, 8000);
    // the host closes one guest's microphone, then opens it again
    await studio.locator('#onStage li', { hasText: 'هدى' }).locator('button').first().click();
    const huda = extra[1];
    check('the host can close a guest microphone: the guest is cut and cannot reopen it', (await until(() => huda.evaluate(() => document.querySelector('#micBtn').disabled), 6000)) !== null
      && (await until(() => studio.evaluate(() => [...window.__studio.stage.values()].filter((s) => s.audio && !s.audio.enabled).length === 1), 6000)) !== null
      && (await studio.locator('#onStage li', { hasText: '🔇' }).count()) === 1);
    await studio.locator('#onStage li', { hasText: 'هدى' }).locator('button').first().click();
    check('the host opens it again and the guest can speak', (await until(() => huda.evaluate(() => !document.querySelector('#micBtn').disabled), 6000)) !== null
      && (await until(() => studio.evaluate(() => [...window.__studio.stage.values()].every((s) => !s.audio || s.audio.enabled)), 6000)) !== null);
    await studio.click('#muteAll');
    check('one button closes every guest microphone', (await until(() => studio.evaluate(() => [...window.__studio.stage.values()].every((s) => s.audio && !s.audio.enabled)), 6000)) !== null);
    await studio.click('#muteAll');
    await until(() => studio.evaluate(() => [...window.__studio.stage.values()].every((s) => s.audio && s.audio.enabled)), 6000);
    for (const name of ['يوسف', 'هدى', 'عمر']) await studio.locator('#onStage li', { hasText: name }).locator('button.danger').click();
    check('the three leave and the first two stay', (await until(async () => (await studio.locator('#onStage li').count()) === 2 && await studio.evaluate(() => window.__studio.stage.size === 2), 10000)) !== null);
    for (const p of extra) await p.context().close();
    // ---- viewer accounts: sign-up with a code sent by e-mail
    {
      const tok = await studio.evaluate(() => sessionStorage.getItem('regam.studio'));
      const adminSet = (body) => fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const lastMail = () => { const l = fs.readFileSync(path.join(OUT, 'outbox.jsonl'), 'utf8').trim().split('\n'); return JSON.parse(l[l.length - 1]); };
      const codeIn = (m) => (m.text.match(/\b(\d{6})\b/) || [])[1];
      const actx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1100, height: 800 } });
      const a = await actx.newPage();
      a.on('pageerror', (e) => errors.push('account: ' + e.message));
      const closed = await fetch(BASE + '/api/member/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', email: 'x@example.com', password: 'motdepasse1' }) });
      const lockEarly = await adminSet({ access: 'watch' });
      const still = (await (await fetch(BASE + '/api/site')).json()).access;
      check('without a mailbox to send codes, sign-up is closed and the site cannot be locked', closed.status === 503 && lockEarly.status === 200 && still === 'open');
      const mailSet = await adminSet({ mail: { host: 'smtp.test.local', port: 465, user: 'live@test.local', from: 'live@test.local', pass: 'secret-pass' } });
      check('once the mailbox is set, the front address becomes the site\'s home page', mailSet.status === 200 && /hero/.test(await (await fetch(BASE + '/')).text()));
      await a.goto(BASE + '/');
      check('the front page offers to create an account or sign in, in the visitor\'s language', (await until(() => a.locator('#heroUp').isVisible())) !== null && (await a.textContent('#heroUp')) === 'Créer un compte' && await a.locator('.acc-box').isVisible());
      await a.click('#heroUp');
      await a.fill('#accountDlg input[type=text]', 'Samira'); await a.fill('#accountDlg input[type=email]', 'Samira@Example.com'); await a.fill('#accountDlg input[type=password]', 'motdepasse1');
      await a.click('#accountDlg button[type=submit]');
      check('signing up sends a six-digit code to the person\'s own address', (await until(() => a.locator('#accountDlg .acc-code').isVisible())) !== null
        && lastMail().to === 'samira@example.com' && /^\d{6}$/.test(codeIn(lastMail())) && /Samira/.test(lastMail().text));
      const early = await fetch(BASE + '/api/member/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'samira@example.com', password: 'motdepasse1' }) });
      await a.fill('#accountDlg .acc-code', '000000'); await a.click('#accountDlg button[type=submit]');
      const linkIn = (lastMail().text.match(/https?:\/\/\S+/) || [''])[0];
      check('nothing opens before the right code: sign-in refused, wrong code refused', early.status === 403 && (await until(() => a.locator('#accountDlg .err').isVisible())) !== null);
      await a.fill('#accountDlg .acc-code', codeIn(lastMail())); await a.click('#accountDlg button[type=submit]');
      check('the right code activates the account and signs the person in', (await until(() => a.locator('.acc-name', { hasText: 'Samira' }).isVisible(), 8000)) !== null && await a.locator('#heroHello').isVisible());
      const dup = await fetch(BASE + '/api/member/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', email: 'samira@example.com', password: 'autrechose1' }) });
      check('an address cannot be registered twice', dup.status === 409);

      // the link in the e-mail validates in one tap
      await fetch(BASE + '/api/member/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Yassine', email: 'yassine@example.com', password: 'motdepasse1', lang: 'fr' }) });
      const tap = (lastMail().text.match(/https?:\/\/\S+/) || [''])[0];
      const lp = await (await browser.newContext({ locale: 'fr-FR' })).newPage();
      await lp.goto(tap);
      check('the e-mail also carries a link that validates the account in one tap', /\/rooms\?e=samira%40example\.com&v=\d{6}$/.test(linkIn) && tap.startsWith(BASE + '/rooms?e=') && /Ou cliquez/.test(lastMail().text)
        && (await until(() => lp.locator('.acc-name', { hasText: 'Yassine' }).isVisible(), 8000)) !== null && !/[?&]v=/.test(lp.url()));
      await lp.context().close();
      const tested = await fetch(BASE + '/api/admin/mailtest', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'pro@example.com' }) });
      check('once the test message is sent, an account becomes compulsory by itself', tested.status === 200 && (await (await fetch(BASE + '/api/site')).json()).access === 'watch');
      // members only: without an account, no stream and no room
      const locked = await adminSet({ access: 'watch' });
      const anon = await (await browser.newContext({ locale: 'ar-MA' })).newPage();
      await anon.goto(BASE + '/r/main');
      check('with "account needed to watch", a visitor without one is shown the way in and gets no stream', locked.status === 200 && (await until(() => anon.locator('#signBtns').isVisible())) !== null
        && (await anon.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status)) === 403 && (await anon.evaluate(async () => (await fetch('/api/pass?room=main&uid=aaaaaaaaaaaaaaaa')).status)) === 401 && await anon.locator('#soundBtn').isHidden());
      await a.goto(BASE + '/r/main');
      check('a signed-in member enters, under the name of the account', (await until(() => a.locator('#liveBadge.on').isVisible())) !== null
        && (await until(() => a.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status === 200), 8000)) !== null
        && (await studio.click('.who-btn'), (await until(async () => (await studio.locator('.who-list li').allTextContents()).includes('Samira'), 8000)) !== null));
      await studio.click('.who-dlg .btn');
      await adminSet({ access: 'join' });
      await anon.reload();
      check('with "account needed to take part", watching is open but raising a hand asks to sign in', (await until(() => anon.locator('#liveBadge.on').isVisible())) !== null
        && (await anon.click('#handBtn'), (await until(() => anon.locator('#accountDlg[open]').isVisible())) !== null));
      // forgotten password
      await anon.locator('#accountDlg .acc-link', { hasText: 'نسيت' }).click();
      await anon.fill('#accountDlg input[type=email]', 'samira@example.com'); await anon.click('#accountDlg button[type=submit]');
      await until(() => anon.locator('#accountDlg .acc-code').isVisible());
      await anon.fill('#accountDlg .acc-code', codeIn(lastMail())); await anon.fill('#accountDlg input[type=password]', 'nouveaupass2'); await anon.click('#accountDlg button[type=submit]');
      const signedIn = (await until(() => anon.locator('.acc-name', { hasText: 'Samira' }).isVisible(), 8000)) !== null;
      const oldPw = await fetch(BASE + '/api/member/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'samira@example.com', password: 'motdepasse1' }) });
      check('a forgotten password is replaced with a code sent by e-mail', signedIn && oldPw.status === 401);
      // administration
      const adminData = await (await fetch(BASE + '/api/admin', { headers: { Authorization: 'Bearer ' + tok } })).json();
      const noMailLock = await (await fetch(BASE + '/api/member/me')).status;
      check('the administrator sees the members, never their password', adminData.accounts.members.total === 2 && adminData.accounts.members.list.some((m) => m.email === 'samira@example.com') && !JSON.stringify(adminData).includes('hash') && adminData.accounts.mail.hasPass === true && !JSON.stringify(adminData).includes('secret-pass') && noMailLock === 401);
      const yas = adminData.accounts.members.list.find((m) => m.email === 'yassine@example.com');
      const gone = await fetch(BASE + '/api/admin/member?id=' + yas.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      const after = await fetch(BASE + '/api/member/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yassine@example.com', password: 'motdepasse1' }) });
      check('the administrator can delete an account, which then cannot sign in', gone.status === 200 && after.status === 401);
      // an assistant: a member the host names to help run the room
      await adminSet({ access: 'open' });
      await studio.fill('#helperEmail', 'nobody@example.com'); await studio.click('#helperForm button[type=submit]');
      const unknown = (await until(async () => (await studio.textContent('#helperNote')).length > 0, 6000)) !== null;
      await studio.fill('#helperEmail', 'samira@example.com'); await studio.click('#helperForm button[type=submit]');
      check('the host names an assistant by the e-mail of their account; an unknown address is refused', unknown && (await until(() => studio.locator('#helperList li', { hasText: 'Samira' }).isVisible(), 6000)) !== null
        && (await until(() => a.locator('#helperBar').isVisible(), 10000)) !== null);
      const hv = await (await browser.newContext({ locale: 'ar-MA' })).newPage();
      await hv.goto(BASE + '/r/main'); await until(() => hv.locator('#liveBadge.on').isVisible());
      await hv.click('#handBtn'); await hv.fill('#nameInput', 'زائر'); await hv.click('#nameForm button[type=submit]');
      await until(() => a.locator('#helperBar .wait-one', { hasText: 'زائر' }).isVisible(), 8000);
      await a.locator('#helperBar .wait-one', { hasText: 'زائر' }).locator('button.primary').click();
      const invited = (await until(() => hv.locator('#inviteDlg[open]').isVisible(), 8000)) !== null;
      await hv.click('#inviteNo');
      await a.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'helperhack000001', mt: localStorage.getItem('regam.member'), room: 'main' })); w.send(JSON.stringify({ t: 'title', text: 'HACKED' })); w.send(JSON.stringify({ t: 'gate', on: true })); }; });
      await sleep(800);
      check('the assistant accepts a request to come on stage, but cannot touch the settings', invited && (await a.textContent('#title')) !== 'HACKED' && !(await studio.isChecked('#gateChk')));
      await studio.locator('#helperList li', { hasText: 'Samira' }).locator('button').click();
      check('removed, the assistant is an ordinary viewer again', (await until(async () => (await studio.locator('#helperList li').count()) === 0 && await a.locator('#helperBar').isHidden(), 10000)) !== null);
      await hv.context().close();
      await adminSet({ access: 'open', mail: { host: '', port: 465, user: '', from: '' } });       // the rest of the run is without accounts, as on a fresh install
      await anon.context().close(); await actx.close();
    }
    // ---- recording: nothing is recorded unless the host asks
    check('a live is not recorded by itself', seen.recCalls.length === 0 && await studio.evaluate(() => { const b = document.querySelector('#recBtn'); return !b.disabled && b.getAttribute('aria-pressed') === 'false'; }));
    await studio.click('#recBtn');
    check('the host starts recording with one button', (await until(() => seen.recConf.air_main === true, 6000)) !== null && (await until(() => studio.locator('#recBtn.rec-on').isVisible(), 6000)) !== null, seen.recCalls.join(' '));
    await studio.click('#recBtn');
    check('and stops it with the same button', (await until(() => seen.recConf.air_main === false, 6000)) !== null && (await until(async () => !(await studio.locator('#recBtn.rec-on').count()), 6000)) !== null);
    await studio.click('#recBtn');
    await until(() => seen.recConf.air_main === true, 6000);
    // ---- the AI assistant: answers in the comments and in a private help bubble
    {
      const tok = await studio.evaluate(() => sessionStorage.getItem('regam.studio'));
      const set = (ai) => fetch(BASE + '/api/admin/settings', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ ai }) });
      const off = (await (await fetch(BASE + '/api/config')).json()).assistant;
      await set({ key: 'wrong-key', about: 'Prix du cours: 500 dh.', chat: true, help: true });
      const badTest = await fetch(BASE + '/api/admin/aitest', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
      await set({ key: 'sk-test-key' });
      const goodTest = await fetch(BASE + '/api/admin/aitest', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
      const adminAi = await (await fetch(BASE + '/api/admin', { headers: { Authorization: 'Bearer ' + tok } })).json();
      check('the assistant is off without a key; the administrator sets one, tests it, and it is never sent back', off === false && badTest.status === 400 && goodTest.status === 200 && adminAi.ai.ready && adminAi.ai.hasKey && !JSON.stringify(adminAi).includes('sk-test-key'));
      const q = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1100, height: 760 } })).newPage();
      q.on('pageerror', (e) => errors.push('ai: ' + e.message));
      await q.goto(BASE + '/r/main'); await until(() => q.locator('#liveBadge.on').isVisible());
      await q.click('#aiBubble'); await q.fill('.ai-form input', 'Comment je crée un compte ?'); await q.click('.ai-form button');
      check('the help bubble answers in private, knowing the state of the rooms', (await until(async () => (await q.locator('.ai-msg.assistant').last().textContent()) === 'AIDE 1 direct', 10000)) !== null);
      await q.fill('.ai-form input', 'Et le code ?'); await q.click('.ai-form button');
      check('the conversation goes on with its history', (await until(async () => (await q.locator('.ai-msg.assistant').last().textContent()) === 'AIDE 3 direct', 10000)) !== null);
      await q.click('.ai-x');
      await q.click('.chat-head'); await q.fill('.composer input', 'C’est quoi MetaMask ?'); await q.click('.composer button[type=submit]');
      await q.fill('#nameInput', 'Lina'); await q.click('#nameForm button[type=submit]');
      await q.fill('.composer input', 'C’est quoi MetaMask ?'); await q.click('.composer button[type=submit]');
      check('a question in the comments gets a short public answer from the assistant', (await until(() => q.locator('.msg.ai', { hasText: '@Lina MetaMask est un portefeuille.' }).isVisible(), 10000)) !== null
        && (await until(() => studio.locator('.msg.ai', { hasText: 'MetaMask est un portefeuille' }).isVisible(), 6000)) !== null);
      const calls = seen.ai.length;
      await sleep(3200);
      await q.fill('.composer input', 'merci beaucoup'); await q.click('.composer button[type=submit]');
      await sleep(1500);
      const sent = JSON.stringify(seen.ai);
      check('ordinary comments are left alone, and nothing private goes to the AI service', seen.ai.length === calls && seen.ai.every((c) => c.version === '2023-06-01' && c.model === 'claude-haiku-5-5')
        && sent.includes('Prix du cours: 500 dh.') && !sent.includes('studio-pass-1') && !/@example\.com/.test(sent) && (await studio.locator('#aiChatRow').isVisible()));
      await studio.uncheck('#aiChatChk'); await sleep(400);
      const q2 = await (await browser.newContext({ locale: 'fr-FR' })).newPage();
      await q2.goto(BASE + '/r/main'); await until(() => q2.locator('#liveBadge.on').isVisible());
      await q2.click('.chat-head'); await q2.fill('.composer input', 'Pourquoi ?'); await q2.click('.composer button[type=submit]');
      await q2.fill('#nameInput', 'Omar2'); await q2.click('#nameForm button[type=submit]'); await q2.fill('.composer input', 'Pourquoi ça marche pas ?'); await q2.click('.composer button[type=submit]');
      await sleep(1500);
      check('the host can keep the assistant out of the room\'s comments', seen.ai.length === calls);
      await set({ removeKey: true });
      check('without a key the assistant disappears again', (await (await fetch(BASE + '/api/config')).json()).assistant === false);
      await q.context().close(); await q2.context().close();
    }
    // ---- live translation: the host's words reach each viewer in the language they picked
    {
      const mk = async () => { const c = await browser.newContext({ locale: 'ar-MA', viewport: { width: 900, height: 700 } }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push('cap: ' + e.message)); await p.goto(BASE + '/r/main'); await until(() => p.locator('#liveBadge.on').isVisible()); return p; };
      const en = await mk(), none = await mk(), auto = await mk();
      await en.click('#capBtn'); await en.selectOption('#capLang', 'en');
      await none.click('#capBtn'); await none.selectOption('#capLang', '');
      await en.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'fakecaptioner001', name: 'x' })); w.send(JSON.stringify({ t: 'cap', src: 'fr', tx: { fr: 'faux', en: 'FAKE' } })); }; });
      await studio.evaluate(() => window.__cap.send('fr', { fr: 'Bonjour à tous', en: 'Hello everyone', ar: 'مرحبا بالجميع', de: 'x' }));
      check('a viewer who picked English reads the host in English, on the picture', (await until(async () => (await en.locator('#capLine').isVisible()) && (await en.textContent('#capLine')) === 'Hello everyone', 40000)) !== null);
      check('a viewer who asked for no translation sees none, and only the host can send them', await none.locator('#capLine').isHidden() && (await en.textContent('#capLine')) !== 'FAKE');
      check('a viewer who chose nothing gets the translation in the language of their page', (await until(async () => (await auto.textContent('#capLine')) === 'مرحبا بالجميع', 40000)) !== null);
      await studio.evaluate(() => window.__cap.say('Merci beaucoup', 'fr'));
      check('what the host says is translated on the server into the other two languages', (await until(async () => (await en.textContent('#capLine')) === '[en] Merci beaucoup', 40000)) !== null
        && (await until(async () => (await auto.textContent('#capLine')) === '[ar] Merci beaucoup', 20000)) !== null && seen.translated.join(' ') === 'fr>ar fr>en'
        && (await until(async () => (await studio.textContent('#capLast')).includes('EN: [en] Merci beaucoup'), 6000)) !== null, seen.translated.join(' '));
      await studio.evaluate(() => window.__cap.say('شكرا', 'ar'));
      check('a viewer is not shown a translation of their own language', (await until(async () => (await en.textContent('#capLine')) === '[en] شكرا', 40000)) !== null && (await auto.textContent('#capLine')) === '[ar] Merci beaucoup');
      for (const p of [en, none, auto]) await p.context().close();
    }
    // ---- entry code and invitation, like a meeting passcode
    {
      await studio.check('#codeChk');
      const code = (await until(async () => ((await studio.textContent('#codeShow')) || '').replace(/\D/g, '').length === 6 && (await studio.textContent('#codeShow')).replace(/\D/g, ''), 6000));
      const open1 = async (q = '') => { const c = await browser.newContext({ locale: 'ar-MA', viewport: { width: 800, height: 640 } }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push('code: ' + e.message)); await p.goto(BASE + '/r/main' + q); return p; };
      const c1 = await open1();
      check('with an entry code, a visitor is asked for it and gets no stream', !!code && (await until(() => c1.locator('#codeDlg[open]').isVisible())) !== null
        && (await c1.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status)) === 403 && (await c1.evaluate(async () => (await fetch('/api/pass?room=main&uid=aaaaaaaaaaaaaaaa&code=000000')).status)) === 403);
      await c1.fill('#codeInput', code === '111111' ? '222222' : '111111'); await c1.click('#codeForm button[type=submit]');
      check('a wrong code is refused', (await until(() => c1.locator('#codeErr').isVisible(), 6000)) !== null && await c1.locator('#liveBadge.off').isVisible());
      await c1.fill('#codeInput', code); await c1.click('#codeForm button[type=submit]');
      check('the right code lets the person in', (await until(() => c1.locator('#liveBadge.on').isVisible(), 8000)) !== null
        && (await until(() => c1.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status === 200), 8000)) !== null && await c1.locator('#codeDlg').isHidden());
      check('guests on stage are not cut when the code is switched on', await studio.evaluate(() => window.__studio.stage.size === 2) && await viewer.locator('#stageBar').isVisible(), JSON.stringify({ stage: await studio.evaluate(() => [...window.__studio.stage].map(([n, x]) => [n, !!x.rx, x.rx && x.rx.pc.connectionState])), bar: await viewer.locator('#stageBar').isVisible(), g2bar: await g2.locator('#stageBar').isVisible(), list: await studio.locator('#onStage li').allTextContents(), status: await studio.textContent('#status'), vchat: await viewer.evaluate(() => [...document.querySelectorAll('.chat .note, .chat-note, .sys')].map((n) => n.textContent).slice(-3)) }));
      // the invitation: date, link carrying the code, the code itself
      const soon = new Date(Date.now() + 26 * 3600e3), two = (n) => String(n).padStart(2, '0');
      const plan = async (d, mins, title) => { await studio.click('#schedOpen'); await studio.fill('#nextDate', `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`); await studio.fill('#nextTime', `${two(d.getHours())}:${two(d.getMinutes())}`); await studio.selectOption('#nextDur', String(mins)); await studio.fill('#nextTitle', title); await studio.click('#nextSave'); };
      await plan(soon, 60, 'MetaMask الدرس الثاني');
      const invite = await until(async () => { const t = await studio.inputValue('#inviteText'); return t.includes('MetaMask') && t; }, 6000);
      const url = (String(invite).match(/https?:\/\/\S+/) || [''])[0];
      const sCode = (url.match(/code=(\d{6})$/) || [])[1] || '';
      check('each planned live has its own code and its own link, different from the room\'s', !!invite && /^\d{6}$/.test(sCode) && sCode !== code && invite.includes(sCode.slice(0, 3) + ' ' + sCode.slice(3)) && !invite.includes(code.slice(0, 3) + ' ' + code.slice(3)) && invite.split('\n').length >= 4
        && !JSON.stringify(await (await fetch(BASE + '/api/config')).json()).includes(sCode) && !JSON.stringify(await (await fetch(BASE + '/api/rooms')).json()).includes(sCode), String(invite));
      const tooSoon = await open1('?code=' + sCode);
      check('the code of a planned live does not open the room before its time, and says when it will', (await until(() => tooSoon.locator('#codeDlg[open]').isVisible(), 8000)) !== null
        && (await until(async () => (await tooSoon.textContent('#codeErr')).length > 20, 6000)) !== null && await tooSoon.locator('#liveBadge.off').isVisible()
        && (await tooSoon.evaluate(async (c) => (await fetch('/api/pass?room=main&uid=aaaaaaaaaaaaaaaa&code=' + c)).status, sCode)) === 403);
      await tooSoon.context().close();
      const c2 = await open1('?code=' + code);
      check('the invitation link enters directly and shows the announced session', (await until(() => c2.locator('#liveBadge.on').isVisible(), 8000)) !== null && !/code=/.test(c2.url())
        && (await c2.evaluate(async () => (await fetch('/api/config?room=main')).json())).next.title === 'MetaMask الدرس الثاني' && (await c2.evaluate(() => document.querySelector('#nextLine').textContent)).includes('MetaMask'));
      const hp = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 900, height: 700 } })).newPage();
      await hp.goto(BASE + '/rooms');
      const badJoin = await fetch(BASE + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code === '333333' ? '444444' : '333333' }) });
      await hp.fill('#joinCode', code.slice(0, 3) + ' ' + code.slice(3)); await hp.click('#joinForm button[type=submit]');
      check('on the home page, typing the invitation code leads straight into its room', badJoin.status === 404 && (await until(() => hp.locator('#liveBadge.on').isVisible(), 10000)) !== null && hp.url().endsWith('/r/main')
        && (await hp.textContent('#handBtn')) === 'Demander à monter');
      await hp.context().close();
      // the calendar: a second session, the agenda on the home page, the calendar file
      const later = new Date(Date.now() + 5 * 24 * 3600e3);
      later.setHours(15, 0, 0, 0);
      await plan(later, 60, 'Cours du dimanche');
      await until(async () => (await studio.locator('#sessList li').count()) === 2, 6000);
      const cal = (await (await fetch(BASE + '/api/config')).json()).sessions;
      const ics = await fetch(BASE + `/api/ics?room=main&id=${cal[0].id}`), icsText = await ics.text();
      const ag = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1000, height: 800 } })).newPage();
      await ag.goto(BASE + '/rooms');
      await studio.locator('#invitePanel').scrollIntoViewIfNeeded(); await studio.locator('#invitePanel').screenshot({ path: path.join(OUT, 'agenda.png') });
      await studio.click('#schedOpen'); await sleep(300); await studio.screenshot({ path: path.join(OUT, 'agenda-form.png') }); await studio.click('#schedCancel');
      check('several lives can be planned, each with a start and an end; the soonest is the one announced', cal.length === 2 && cal[0].title === 'MetaMask الدرس الثاني' && cal[0].end - cal[0].at === 3600e3 && cal[1].end - cal[1].at === 3600e3
        && (await studio.inputValue('#inviteText')).includes('Cours du dimanche') && (await studio.inputValue('#inviteText')).includes('/api/ics?room=main&id=' + cal[1].id)
        && (await studio.locator('#sessList .sess-card').count()) === 2 && (await studio.textContent('#sessList .sess-card >> nth=1')).includes('15:00') && await studio.locator('#schedDlg').isHidden());
      check('each planned live can be added to a personal calendar', ics.status === 200 && /text\/calendar/.test(ics.headers.get('content-type')) && /BEGIN:VEVENT/.test(icsText)
        && /DTSTART:\d{8}T\d{6}Z/.test(icsText) && /DTEND:\d{8}T\d{6}Z/.test(icsText) && icsText.includes('/r/main') && !icsText.includes(code));
      check('the home page shows the agenda of planned lives', (await until(async () => (await ag.locator('#agendaList li').count()) === 2, 8000)) !== null && (await ag.textContent('#agendaList li >> nth=1')).includes('Cours du dimanche')
        && (await ag.textContent('#agendaList li >> nth=1')).includes('15:00') && (await c2.textContent('#nextLine')).includes('dans') === false);
      await ag.context().close();
      const badTime = await studio.evaluate(() => new Promise((res) => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'sessiontester0001', token: sessionStorage.getItem('regam.studio') })); w.send(JSON.stringify({ t: 'session', at: Date.now() - 5 * 24 * 3600e3 })); }; w.onmessage = (m) => { const d = JSON.parse(m.data); if (d.t === 'sessions') { res(d.err || 'accepted'); w.close(); } }; setTimeout(() => res('none'), 4000); }));
      check('a session in the past is refused', badTime === 'bad');
      // a live planned for now: during its time, only its own code opens the room
      const nowish = new Date(Date.now() + 10 * 60e3);
      await plan(nowish, 45, 'Maintenant');
      const nowCode = await until(async () => { const m = (await studio.inputValue('#inviteText')).match(/code=(\d{6})/); return (await studio.inputValue('#inviteText')).includes('Maintenant') && m && m[1]; }, 6000);
      const withRoom = await fetch(BASE + `/api/pass?room=main&uid=aaaaaaaaaaaaaaaa&code=${code}`), withOwn = await fetch(BASE + `/api/pass?room=main&uid=aaaaaaaaaaaaaaaa&code=${nowCode}`);
      const viaJoin = await (await fetch(BASE + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: nowCode }) })).json();
      check('during a planned live, its own code opens the room and the room\'s general code does not', !!nowCode && nowCode !== code && withRoom.status === 403 && withOwn.status === 200 && viaJoin.slug === 'main' && !viaJoin.early, `${withRoom.status} ${withOwn.status} body=${await withOwn.text()} now=${new Date().toISOString()} cfg=${JSON.stringify((await (await fetch(BASE + '/api/config')).json()).sessions)} code=${nowCode} cards=${await studio.locator('#sessList li').count()} dlg=${await studio.locator('#schedDlg').isVisible()} err=${await studio.textContent('#schedErr')} invite=${(await studio.inputValue('#inviteText')).slice(0, 80)}`);
      for (let i = 0; i < 3; i++) await studio.locator('#sessList li button.danger').first().click();
      await until(async () => (await studio.locator('#sessList li').count()) === 0, 6000);
      await studio.uncheck('#codeChk');
      const c3 = await open1();
      check('without the code option, the room is open again', (await until(() => c3.locator('#liveBadge.on').isVisible(), 8000)) !== null && (await (await fetch(BASE + '/api/config')).json()).locked === false);
      for (const p of [c1, c2, c3]) await p.context().close();
    }
    // ---- waiting room: people give a name, the host lets them in or not
    await studio.check('#gateChk');
    await sleep(500);
    const door = async () => { const c = await browser.newContext({ locale: 'ar-MA', viewport: { width: 700, height: 600 } }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push('door: ' + e.message)); await p.goto(BASE + '/r/main'); return p; };
    const w1 = await door();
    check('with the waiting room on, a newcomer is asked for a name and gets no stream', (await until(() => w1.locator('#nameDlg[open]').isVisible())) !== null
      && (await w1.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status)) === 403 && await w1.locator('#liveBadge.off').isVisible());
    await w1.fill('#nameInput', 'نادية'); await w1.click('#nameForm button[type=submit]');
    check('the host sees who is waiting', (await until(() => studio.locator('#waiting li', { hasText: 'نادية' }).isVisible())) !== null && await w1.locator('#offlineText', { hasText: 'تسنى' }).isVisible());
    check('people already inside keep watching', await viewer.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status) === 200);
    check('someone waiting to come in is announced at the top of the studio, and can be accepted from there', await studio.locator('#waitBar', { hasText: 'نادية' }).isVisible());
    await studio.locator('#waitBar button.primary').first().click();
    check('once admitted, the person watches the live', (await until(() => w1.locator('#liveBadge.on').isVisible())) !== null
      && (await until(() => w1.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status === 200), 8000)) !== null && (await studio.locator('#waiting li').count()) === 0);
    const w2 = await door();
    await until(() => w2.locator('#nameDlg[open]').isVisible());
    await w2.fill('#nameInput', 'مجهول'); await w2.click('#nameForm button[type=submit]');
    await until(() => studio.locator('#waiting li', { hasText: 'مجهول' }).isVisible());
    await studio.locator('#waiting li', { hasText: 'مجهول' }).locator('button.danger').click();
    check('a refused person is told so and stays out, even after a reload', (await until(() => w2.locator('#offlineText', { hasText: 'ما قبلش' }).isVisible())) !== null
      && (await w2.reload(), (await until(() => w2.locator('#offlineText', { hasText: 'ما قبلش' }).isVisible())) !== null)
      && (await w2.evaluate(async () => (await fetch('/hls/air_main/index.m3u8')).status)) === 403);
    await studio.uncheck('#gateChk');
    const w3 = await door();
    check('with the waiting room off, everybody enters directly', (await until(() => w3.locator('#liveBadge.on').isVisible())) !== null);
    for (const p of [w1, w2, w3]) await p.context().close();
    check('paths beyond the twelve stage slots are refused', (await fetch(BASE + '/api/rtc/whep/guest13', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer ' + await studio.evaluate(() => sessionStorage.getItem('regam.studio')) } })).status >= 404);
    await sleep(1200);
    await studio.screenshot({ path: path.join(OUT, 'studio-3-people.png') });
    await g2.screenshot({ path: path.join(OUT, 'guest-phone-stage.png') });
    await studio.locator('#onStage li', { hasText: 'سلمى' }).locator('button.danger').click();
    const gone = [
      (await until(() => g2.evaluate(() => !document.querySelector('#video').srcObject), 10000)) !== null,
      (await until(() => sfu.evaluate(() => !window.paths.guest2_main && !!window.paths.guest1_main))) !== null,
      (await until(async () => (await studio.locator('#onStage li').count()) === 1, 5000)) !== null,
      await viewer.evaluate(() => !!document.querySelector('#video').srcObject),
    ];
    check('removing one guest leaves the other on stage', gone.every(Boolean), gone.join(','));
    await g2ctx.close();

    // ---- screen share ------------------------------------------------------------
    await studio.evaluate(() => {   // headless has no screen to capture: hand the page a drawn "screen"
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 }); const g = c.getContext('2d'); let n = 0;
        setInterval(() => { g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 1920, 1080); g.fillStyle = '#1b2430'; g.font = '700 84px sans-serif'; g.fillText('MetaMask — Create a new wallet', 120, 220);
          g.font = '44px sans-serif'; g.fillText('Step ' + (1 + (n++ >> 5) % 4) + ': write down your secret recovery phrase', 120, 330); g.fillStyle = '#f2b84b'; g.fillRect(120, 420, 520, 110); }, 40);
        return c.captureStream(25);
      };
    });
    await studio.click('#screenBtn');
    check('screen share switches the broadcast to 1920x1080', (await until(async () => (await dim()) === '1920x1080')) !== null, await dim());
    check('audience relay receives the 1080p picture', (await until(() => sfu.evaluate(() => document.getElementById('v_studio_main').videoWidth === 1920), 15000)) !== null);
    await sleep(800);
    await studio.screenshot({ path: path.join(OUT, 'studio-screen.png') });
    await studio.click('#screenBtn');
    check('stopping the share returns to 1280x720', (await until(async () => (await dim()) === '1280x720')) !== null);

    // ---- whiteboard ---------------------------------------------------------------
    await studio.click('#boardBtn');
    check('whiteboard switches the broadcast to 1920x1080', (await until(async () => (await dim()) === '1920x1080')) !== null, await dim());
    await studio.evaluate(() => { document.querySelector('.stage').scrollTop = 0; });
    let box = await studio.locator('#board').boundingBox();
    await studio.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
    await studio.mouse.down();
    for (let i = 1; i <= 12; i++) await studio.mouse.move(box.x + box.width * (0.15 + i * 0.03), box.y + box.height * (0.6 + 0.12 * Math.sin(i / 2)));
    await studio.mouse.up();
    await studio.click('#boardBar [data-tool="text"]');
    await studio.click('#boardBar [data-color="#d92d2d"]');
    await studio.locator('#board').scrollIntoViewIfNeeded();
    await studio.evaluate(() => { document.querySelector('.stage').scrollTop = 0; });
    box = await studio.locator('#board').boundingBox();   // the toolbar click may have scrolled the page
    await studio.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.2);
    await studio.waitForFunction(() => document.activeElement && document.activeElement.id === 'boardTyper');
    await studio.keyboard.type('MetaMask : étape 1');
    await studio.keyboard.press('Escape');
    await studio.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.38);
    await studio.waitForFunction(() => document.activeElement && document.activeElement.id === 'boardTyper');
    await studio.keyboard.type('الدرس الأول');
    await studio.keyboard.press('Escape');
    check('drawing and typing land on the whiteboard', (await studio.evaluate(() => window.__studio.board.count)) === 3);
    const inked = () => sfu.evaluate(() => { const v = document.getElementById('v_studio_main'); const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 192, 108); const d = g.getImageData(0, 0, 192, 108).data; let white = 0, red = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++; if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 110) red++; } return { white: white / (192 * 108), red }; });
    const seenBoard = await until(async () => { const r = await inked(); return r.white > 0.6 && r.red > 3 ? r : null; }, 15000);
    check('audience relay shows the whiteboard with the red text', seenBoard !== null, JSON.stringify(seenBoard || await inked()));
    await studio.screenshot({ path: path.join(OUT, 'studio-board.png') });
    await studio.click('#boardUndo');
    check('undo removes the last item', (await studio.evaluate(() => window.__studio.board.count)) === 2);
    await studio.click('#screenBtn');
    check('sharing the screen closes the whiteboard', await studio.locator('#board').isHidden() && (await until(async () => (await dim()) === '1920x1080')) !== null);
    await studio.click('#screenBtn');
    check('back to the camera after both are off', (await until(async () => (await dim()) === '1280x720')) !== null);

    // ---- host removes the guest -------------------------------------------------
    await studio.locator('#onStage li button.danger').first().click();
    check('guest is taken off stage and returns to the normal player', (await until(() => viewer.evaluate(() => !document.querySelector('#video').srcObject && document.querySelector('#stageBar').hidden))) !== null);
    check('guest media session is closed on the relay', (await until(() => sfu.evaluate(() => !window.paths.guest1_main && !window.paths.backstage1_main))) !== null);
    check('a removed guest can no longer use the stage token', (await viewer.evaluate(() => fetch('/api/rtc/whip/guest1', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer stage.x.1.y' } }).then((r) => r.status))) === 401);

    // ---- ban -----------------------------------------------------------------------
    await studio.locator('.msg', { hasText: 'سلام من المتفرج' }).hover();
    await studio.locator('.msg', { hasText: 'سلام من المتفرج' }).locator('button', { hasText: 'حظر' }).click();
    check('ban removes the comments for everyone', (await until(() => viewer.locator('.msg', { hasText: 'سلام من المتفرج' }).count().then((n) => n === 0))) !== null);
    await sleep(3200);
    await viewer.fill('.composer input', 'واش باقي نقدر نكتب؟'); await viewer.click('.composer button[type=submit]');
    await sleep(800);
    check('a banned viewer cannot comment any more', (await studio.locator('.msg', { hasText: 'واش باقي' }).count()) === 0);

    // ---- screenshots ------------------------------------------------------------------
    const v2 = await (await browser.newContext({ locale: 'ar-MA', viewport: { width: 1280, height: 760 } })).newPage();
    await v2.goto(BASE + '/'); await until(() => v2.evaluate(() => document.querySelector('#video').videoWidth > 0), 20000);
    await v2.screenshot({ path: path.join(OUT, 'viewer-desktop.png') });
    const phone = await (await browser.newContext({ ...devices['iPhone 14'], locale: 'ar-MA' })).newPage();
    await phone.goto(BASE + '/'); await until(() => phone.evaluate(() => document.querySelector('#video').videoWidth > 0), 20000);
    await phone.screenshot({ path: path.join(OUT, 'viewer-phone.png') });
    check('phone layout has no sideways scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // ---- languages ----------------------------------------------------------------------
    const frCtx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 760 } });
    await openChat(frCtx);
    const fr = await frCtx.newPage();
    fr.on('pageerror', (e) => errors.push('fr: ' + e.message));
    await fr.goto(BASE + '/');
    await until(() => fr.locator('#liveBadge.on').isVisible());
    const frText = await fr.evaluate(() => [document.documentElement.lang, document.documentElement.dir, document.querySelector('#liveBadge').textContent, document.querySelector('#handBtn').textContent, document.querySelector('.composer input').placeholder, document.querySelector('.chat-head span').textContent, document.querySelector('#shareBtn').textContent].join(' | '));
    check('a French browser gets the page in French, left to right', frText === 'fr | ltr | En direct | Demander à monter | Écrire un commentaire… | Commentaires | Partager', frText);
    check('no Arabic interface text is left on the French page', await fr.evaluate(() => { const skip = ['.msgs', '.pinned', '#title', '#guestLine', '.lang']; const c = document.body.cloneNode(true); skip.forEach((q) => c.querySelectorAll(q).forEach((n) => n.remove())); c.querySelectorAll('[hidden],dialog,script').forEach((n) => n.remove()); return !/[\u0600-\u06FF]/.test(c.textContent); }));
    await fr.screenshot({ path: path.join(OUT, 'viewer-fr.png') });
    await fr.selectOption('.lang', 'en');
    await fr.waitForLoadState('load');
    check('the language menu switches to English and remembers it', (await until(async () => (await fr.textContent('#handBtn')) === 'Ask to join' && (await fr.evaluate(() => document.documentElement.lang)) === 'en')) !== null);
    const frStudio = await frCtx.newPage();
    await frStudio.goto(BASE + '/studio?all=1');
    await frStudio.evaluate(() => localStorage.setItem('regam.lang', 'fr')); await frStudio.reload();
    check('studio sign-in is in French', (await frStudio.textContent('#loginForm h1')) === 'Connexion au studio' && (await frStudio.textContent('#loginForm button[type=submit]')) === 'Entrer');
    await frStudio.fill('#pw', 'studio-pass-1'); await frStudio.click('#loginForm button[type=submit]'); await frStudio.waitForSelector('#app:not([hidden])');
    check('studio controls are in French', (await frStudio.evaluate(() => ['#goBtn', '#camBtn', '#screenBtn', '#boardBtn', '#micBtn'].map((q) => document.querySelector(q).textContent).join(' | '))) === "Démarrer le live | Caméra | Partager l'écran | Tableau blanc | Micro");
    await frStudio.screenshot({ path: path.join(OUT, 'studio-fr.png') });
    await frCtx.close();

    // ---- rooms and teachers ----------------------------------------------------------------
    const adminCtx = await browser.newContext({ locale: 'ar-MA', viewport: { width: 1280, height: 860 }, permissions: ['camera', 'microphone'] });
    await openChat(adminCtx);
    const adm = await adminCtx.newPage();
    adm.on('pageerror', (e) => errors.push('admin: ' + e.message));
    adm.on('dialog', (d) => d.accept());
    await adm.goto(BASE + '/admin');
    check('the administration page sends a visitor to the sign-in', (await until(() => adm.url().endsWith('/studio'))) !== null);
    await adm.fill('#pw', 'studio-pass-1'); await adm.click('#loginForm button[type=submit]'); await adm.waitForSelector('#app:not([hidden])');
    const adminTok = await adm.evaluate(() => sessionStorage.getItem('regam.studio'));
    await adm.click('#adminLink'); await adm.waitForSelector('#roomList li');
    await adm.fill('#userForm [name=name]', 'Prof Salma'); await adm.fill('#userForm [name=login]', 'salma'); await adm.fill('#userForm [name=password]', 'salma-pass-9');
    await adm.click('#userForm button'); await adm.waitForSelector('#users li');
    await adm.fill('#roomForm [name=title]', 'Programmation Python'); await adm.fill('#roomForm [name=topic]', 'Programmation');
    await adm.selectOption('#roomForm [name=ownerId]', { label: 'Prof Salma' });
    await adm.click('#roomForm button');
    check('the administrator creates a teacher and a room from the page', (await until(() => adm.locator('#roomList li', { hasText: 'Programmation Python' }).isVisible())) !== null && (await adm.locator('#roomList li', { hasText: 'Programmation Python' }).locator('.room-url').textContent()).endsWith('/r/programmation-python'));
    await adm.screenshot({ path: path.join(OUT, 'admin.png'), fullPage: true });
    check('the old viewer page keeps working at its own address', (await fetch(BASE + '/r/main')).status === 200 && (await viewer.locator('#liveBadge.on').isVisible()));

    const home = await vctx.newPage();
    await home.goto(BASE + '/');
    check('with two rooms the front page lists them, the live one marked', (await until(async () => (await home.locator('.room-card').count()) === 2 && (await home.locator('.room-card.is-live').count()) === 1)) !== null && (await home.locator('.room-group').first().locator('.room-card.is-live').count()) === 1 && (await home.locator('.room-group h2').last().textContent()) === 'Programmation');
    await home.screenshot({ path: path.join(OUT, 'home.png') });

    const tctx = await browser.newContext({ locale: 'ar-MA', viewport: { width: 1380, height: 900 }, permissions: ['camera', 'microphone'] });
    await openChat(tctx);
    const teacher = await tctx.newPage();
    teacher.on('pageerror', (e) => errors.push('teacher: ' + e.message));
    await teacher.goto(BASE + '/studio?all=1');
    await teacher.fill('#lg', 'salma'); await teacher.fill('#pw', 'wrong-pass-00'); await teacher.click('#loginForm button[type=submit]');
    check('a teacher with a wrong password is refused', (await until(() => teacher.locator('#loginErr').isVisible(), 5000)) !== null);
    await teacher.fill('#pw', 'salma-pass-9'); await teacher.click('#loginForm button[type=submit]'); await teacher.waitForSelector('#app:not([hidden])');
    const teacherTok = await teacher.evaluate(() => sessionStorage.getItem('regam.studio'));
    check('the teacher lands in their own room, without the administration link', (await teacher.textContent('#roomName')) === 'Programmation Python' && await teacher.locator('#adminLink').isHidden() && (await teacher.textContent('#roomLink')).endsWith('/r/programmation-python'));
    const asTeacher = { Authorization: 'Bearer ' + teacherTok };
    check('a teacher cannot reach the administration or another room', (await fetch(BASE + '/api/admin', { headers: asTeacher })).status === 403
      && (await fetch(BASE + '/api/admin/room', { method: 'POST', headers: asTeacher, body: '{"title":"x","ownerId":"admin"}' })).status === 403
      && (await fetch(BASE + '/api/rtc/whip/studio?room=main', { method: 'POST', headers: asTeacher, body: 'x' })).status === 401
      && (await fetch(BASE + '/api/recordings?room=main', { headers: asTeacher })).status === 401);
    await teacher.evaluate((tok) => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'teacherinmain001', room: 'main', token: tok })); w.send(JSON.stringify({ t: 'pin', text: 'TEACHER WAS HERE' })); }; }, teacherTok);
    await sleep(700);
    check('a teacher is an ordinary viewer in a room that is not theirs', (await viewer.textContent('.pinned')) === 'التكوين كيبدا دابا');

    await teacher.click('#goBtn');
    check('the teacher goes live in their room while the first room is live too', (await until(() => teacher.evaluate(() => window.__studio.pc && window.__studio.pc.connectionState === 'connected'))) !== null
      && (await until(async () => { const r = await (await fetch(BASE + '/api/rooms')).json(); return r.rooms.filter((x) => x.live).length === 2; })) !== null);
    const pupil = await vctx.newPage();
    await pupil.goto(BASE + '/r/programmation-python');
    check("a viewer of the teacher's room sees it live, with its own title and host", (await until(() => pupil.locator('#liveBadge.on').isVisible())) !== null && (await pupil.textContent('#title')) === 'Programmation Python' && (await pupil.textContent('#roomHost')) === 'Prof Salma');
    await teacher.fill('.composer input', 'bonjour la classe'); await teacher.click('.composer button[type=submit]');
    await pupil.click('.react-open'); await pupil.locator('#reactions button').nth(1).click();
    check('chat and reactions stay inside their room', (await until(() => pupil.locator('.msg.host', { hasText: 'bonjour la classe' }).isVisible())) !== null
      && (await until(async () => (await teacher.textContent('#likes')) === '1', 5000)) !== null
      && (await viewer.locator('.msg', { hasText: 'bonjour la classe' }).count()) === 0 && (await studio.textContent('#likes')) !== '1');
    check('each room publishes on its own media paths', seen.posts.includes('whip:studio_programmation-python') && (await sfu.evaluate(() => !!window.paths['studio_programmation-python'] && !!window.paths.studio_main)));

    const asAdmin = { Authorization: 'Bearer ' + adminTok, 'Content-Type': 'application/json' };
    const sal = (await (await fetch(BASE + '/api/admin', { headers: asAdmin })).json()).users[0];
    check('a teacher who still has a room cannot be deleted', (await fetch(BASE + '/api/admin/user?id=' + sal.id, { method: 'DELETE', headers: asAdmin })).status === 409);
    await fetch(BASE + '/api/admin/user', { method: 'POST', headers: asAdmin, body: JSON.stringify({ id: sal.id, active: false }) });
    check('suspending a teacher cuts their live and their access at once', (await fetch(BASE + '/api/me', { headers: asTeacher })).status === 401
      && (await until(async () => { const r = await (await fetch(BASE + '/api/rooms')).json(); return r.rooms.find((x) => x.slug === 'programmation-python').live === false; }, 15000)) !== null
      && (await fetch(BASE + '/api/login', { method: 'POST', body: '{"login":"salma","password":"salma-pass-9"}' })).status === 401);
    check('the first room is not affected', (await (await fetch(BASE + '/api/rooms')).json()).rooms.find((x) => x.slug === 'main').live === true);
    check('deleting the room and then the teacher works; the front page is the single room again', (await fetch(BASE + '/api/admin/room?slug=programmation-python', { method: 'DELETE', headers: asAdmin })).status === 200
      && (await fetch(BASE + '/api/admin/user?id=' + sal.id, { method: 'DELETE', headers: asAdmin })).status === 200
      && (await fetch(BASE + '/api/admin/room?slug=main', { method: 'DELETE', headers: asAdmin })).status === 409
      && (await (await fetch(BASE + '/')).text()).includes('id="video"'));
    await tctx.close(); await adminCtx.close(); await home.close(); await pupil.close();

    // ---- sign-in, teacher sign-up, plans, capacity, subscriptions ----------------------------
    const lg = (body) => fetch(BASE + '/api/login', { method: 'POST', body: JSON.stringify(body) });
    check("the administrator's password works whatever is typed in the login field", (await lg({ login: 'regam-live', password: 'studio-pass-1' })).status === 200 && (await lg({ login: 'me@example.com', password: 'studio-pass-1' })).status === 200 && (await lg({ login: 'regam-live', password: 'nope-nope-1' })).status === 401);
    const actx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1100, height: 900 } });
    await openChat(actx);
    const apply = await actx.newPage();
    apply.on('pageerror', (e) => errors.push('apply: ' + e.message));
    const admin2 = { Authorization: 'Bearer ' + (await (await lg({ password: 'studio-pass-1' })).json()).token, 'Content-Type': 'application/json' };
    const post = (url, body, headers = admin2) => fetch(BASE + url, { method: 'POST', headers, body: JSON.stringify(body) });
    await post('/api/admin/settings', { payInfo: 'PayPal: pay@example.com\nUSDT (TRC20): TXyz123', plans: [{ name: 'Classe 2', price: 500, capacity: 2 }, { name: 'Amphi', price: 1200, capacity: 500 }] });
    check('plans with a wrong size or price are refused', (await post('/api/admin/settings', { plans: [{ name: 'x', price: -1, capacity: 10 }] })).status === 400 && (await post('/api/admin/settings', { plans: [{ name: 'x', price: 5, capacity: 0 }] })).status === 400);
    await apply.goto(BASE + '/teach');
    await apply.waitForSelector('#plans .plan');
    check('the sign-up page shows the plans, in French for a French browser', (await apply.locator('#plans .plan').first().textContent()) === "Classe 2 : jusqu'à 2 spectateurs, 500 $ par mois" && (await apply.locator('#plans .plan').count()) === 2);
    await apply.fill('[name=name]', 'Karim Bennani'); await apply.fill('[name=contact]', '+212 600 000 000'); await apply.fill('[name=roomTitle]', 'Crypto Débutants'); await apply.fill('[name=topic]', 'Crypto');
    await apply.fill('[name=login]', 'karim'); await apply.fill('[name=password]', 'karim-pass-7');
    await apply.screenshot({ path: path.join(OUT, 'teach.png'), fullPage: true });
    await apply.click('#applyForm button[type=submit]');
    check('after the request the teacher sees how to pay', (await until(() => apply.locator('#applyDone').isVisible())) !== null && (await apply.textContent('#payInfo')).includes('USDT (TRC20): TXyz123') && (await apply.textContent('#donePlan')).startsWith('Classe 2'));
    check('a request opens nothing: no sign-in, no room', (await lg({ login: 'karim', password: 'karim-pass-7' })).status === 401 && (await (await fetch(BASE + '/api/rooms')).json()).rooms.length === 1);
    check('the same login cannot be requested twice, and anonymous visitors cannot approve', (await post('/api/apply', { planId: 'x', name: 'a', contact: 'b', roomTitle: 'c', login: 'karim', password: '12345678' }, {})).status >= 400 && (await post('/api/admin/user', { id: 'whatever', months: 1 }, {})).status === 401);
    const pend = (await (await fetch(BASE + '/api/admin', { headers: admin2 })).json()).users.find((u) => u.login === 'karim');
    check('the administrator sees the request with contact, room and plan', pend.pending === true && pend.contact === '+212 600 000 000' && pend.wantRoom === 'Crypto Débutants');
    await post('/api/admin/user', { id: pend.id, months: 1 });
    const afterPay = await (await fetch(BASE + '/api/admin', { headers: admin2 })).json();
    const kRoom = afterPay.rooms.find((r) => r.ownerId === pend.id), kUser = afterPay.users.find((u) => u.id === pend.id);
    check('payment received: the account is active for a month and the room opens with the plan size', (await lg({ login: 'karim', password: 'karim-pass-7' })).status === 200 && kRoom && kRoom.slug === 'crypto-debutants' && kRoom.capacity === 2 && kRoom.topic === 'Crypto'
      && kUser.pending === false && Math.abs(kUser.paidUntil - Date.now() - 30 * 86400e3) < 60e3);
    const seat = async (uid) => { const pg = await actx.newPage(); await pg.addInitScript((u) => localStorage.setItem('regam.uid', u), uid); await pg.goto(BASE + '/r/crypto-debutants'); return pg; };
    const s1 = await seat('seat0000000001'), s2 = await seat('seat0000000002');
    await until(async () => (await (await fetch(BASE + '/api/rooms')).json()).rooms.find((r) => r.slug === 'crypto-debutants').viewers === 2);
    const s3 = await seat('seat0000000003');
    check('a room takes no more viewers than its plan allows, and says so', (await until(() => s3.locator('#offlineText', { hasText: 'La salle est complète' }).isVisible(), 8000)) !== null && (await (await fetch(BASE + '/api/rooms')).json()).rooms.find((r) => r.slug === 'crypto-debutants').viewers === 2);
    const kTok = (await (await lg({ login: 'karim', password: 'karim-pass-7' })).json()).token;
    await s1.evaluate((tok) => new Promise((res) => { const w = new WebSocket(`ws://${location.host}/ws`); w.onmessage = (e) => { window.hostIn = JSON.parse(e.data).t; res(); }; w.onopen = () => w.send(JSON.stringify({ t: 'hello', uid: 'hostkarim000001', room: 'crypto-debutants', token: tok })); }), kTok);
    check('the teacher always gets into their own full room', (await s1.evaluate(() => window.hostIn)) === 'init');
    // let the subscription run out
    const dbFile = path.join(OUT, 'data', 'db.json');
    await post('/api/admin/user', { id: pend.id, name: 'Karim Bennani' });   // any save, so the file is fresh
    await sleep(500);
    check('teacher passwords are stored hashed', !fs.readFileSync(dbFile, 'utf8').includes('karim-pass-7') && /"hash":"[0-9a-f]{64}"/.test(fs.readFileSync(dbFile, 'utf8')));
    await actx.close();

    // ---- recordings ----------------------------------------------------------------------
    check('recordings are private', (await fetch(BASE + '/api/recordings')).status === 401 && (await fetch(BASE + '/api/recordings?name=2026-11-10_20-30-00-000000.mp4')).status === 401);
    const tok = await studio.evaluate(() => sessionStorage.getItem('regam.studio'));
    check('recordings cannot reach other files', (await fetch(BASE + '/api/recordings?name=..%2F..%2Fserver.js&token=' + tok)).status === 400 && (await fetch(BASE + '/api/recordings?name=notes.txt&token=' + tok)).status === 400);
    const dl = await fetch(BASE + '/api/recordings?name=2026-11-10_20-30-00-000000.mp4&token=' + tok);
    check('a recording downloads in full', dl.status === 200 && (await dl.arrayBuffer()).byteLength === 2_500_000);
    await studio.reload(); await studio.waitForSelector('#recs li .rec-actions', { timeout: 20000 });
    check('studio lists the recording with date and size', /10\/11\/2026 · 20:30 · (2|3) MB/.test(await studio.textContent('#recs li')), await studio.textContent('#recs li'));
    await studio.click('#recs li button');
    check('deleting a recording removes the file', (await until(() => !fs.existsSync(path.join(OUT, 'rec', 'air_main', '2026-11-10_20-30-00-000000.mp4')), 5000)) !== null && (await until(() => studio.locator('#noRecs').isVisible(), 5000)) !== null);
    await studio.click('#goBtn');
    await until(() => studio.evaluate(() => window.__studio.pc && window.__studio.pc.connectionState === 'connected'));

    // ---- end of live -------------------------------------------------------------------
    await studio.click('#goBtn');
    check('viewers go back to "offline" when the live stops', (await until(() => viewer.locator('#offline').isVisible())) !== null);
    check('recording stops by itself when the live ends, and the next live starts without it', (await until(() => seen.recConf.air_main === false, 8000)) !== null && await studio.evaluate(() => document.querySelector('#recBtn').disabled));
    // ---- sound for the time before the live
    {
      const tok = await studio.evaluate(() => sessionStorage.getItem('regam.studio'));
      const bytes = Buffer.alloc(5000, 7);
      const dflt = await (await fetch(BASE + '/api/config')).json();
      check('a room without its own sound plays the recitations that come with the site, one after the other', dflt.sound === 'https://sound.test.invalid/rahman.mp3' && dflt.sounds.length === 3 && dflt.sounds[2] === 'https://sound.test.invalid/hadid.mp3');
      const noAuth = await fetch(BASE + '/api/sound', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: bytes });
      const notSound = await fetch(BASE + '/api/sound', { method: 'POST', headers: { 'Content-Type': 'text/html', Authorization: 'Bearer ' + tok }, body: bytes });
      const up = await fetch(BASE + '/api/sound', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', Authorization: 'Bearer ' + tok }, body: bytes });
      const cfgNow = await (await fetch(BASE + '/api/config')).json();
      const part = await fetch(BASE + cfgNow.sound, { headers: { Range: 'bytes=100-199' } });
      check('only the host can set a waiting sound, and phones can fetch it in pieces', noAuth.status === 401 && notSound.status === 415 && up.status === 200 && /^\/media\/sound\/main\?v=\d+$/.test(cfgNow.sound)
        && part.status === 206 && part.headers.get('content-range') === 'bytes 100-199/5000' && (await part.arrayBuffer()).byteLength === 100, `${noAuth.status} ${notSound.status} ${up.status} ${cfgNow.sound} ${part.status}`);
      const idle = await (await browser.newContext({ locale: 'ar-MA' })).newPage();
      await idle.goto(BASE + '/r/main');
      check('while nothing is live, viewers get a button to hear the waiting sound', (await until(() => idle.locator('#soundBtn').isVisible())) !== null);
      check('with its own file, the room plays that one file only', (await (await fetch(BASE + '/api/config')).json()).sounds.length === 1);
      const del = await fetch(BASE + '/api/sound', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      check('the host can remove the sound', del.status === 200 && (await (await fetch(BASE + '/api/config')).json()).sound === '' && (await fetch(BASE + cfgNow.sound)).status === 404);
      const back = await fetch(BASE + '/api/sound?default=1', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
      check('and can bring the recitation back', back.status === 200 && (await (await fetch(BASE + '/api/config')).json()).sound === 'https://sound.test.invalid/rahman.mp3');
      // waiting pictures
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const before = await idle.evaluate(() => getComputedStyle(document.querySelector('#offline .reef.on')).backgroundImage);
      const picNo = await fetch(BASE + '/api/pics', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
      const picBad = await fetch(BASE + '/api/pics', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml', Authorization: 'Bearer ' + tok }, body: png });
      const pic1 = await fetch(BASE + '/api/pics', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: 'Bearer ' + tok }, body: png });
      await fetch(BASE + '/api/pics', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: 'Bearer ' + tok }, body: png });
      const list = (await (await fetch(BASE + '/api/config')).json()).pics;
      const got = await fetch(BASE + list[0].url);
      await idle.reload();
      check('the reef picture is shown by default; the host can put several pictures of their own instead', /sea\.webp/.test(before) && picNo.status === 401 && picBad.status === 415 && pic1.status === 200 && list.length === 2
        && got.status === 200 && got.headers.get('content-type') === 'image/png'
        && (await until(() => idle.evaluate(() => { const l = document.querySelector('#offline .reef.on'); return !!l && /media\/pic\/main\//.test(l.style.backgroundImage); }), 8000)) !== null, `${picNo.status} ${picBad.status} ${pic1.status} ${list.length} ${before}`);
      for (const p of list) await fetch(BASE + `/api/pics?id=${p.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      check('pictures can be removed again', (await (await fetch(BASE + '/api/config')).json()).pics.length === 0 && (await fetch(BASE + list[0].url)).status === 404);
      await idle.context().close();
    }
    // ---- the studio on a phone: no worker mixer there, the simple one takes over
    {
      const pctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'ar-MA', permissions: ['camera', 'microphone'] });
      const ph = await pctx.newPage();
      ph.on('pageerror', (e) => errors.push('phone studio: ' + e.message));
      await ph.goto(BASE + '/studio?mixer=simple&all=1');
      await ph.fill('#pw', 'studio-pass-1'); await ph.click('#loginForm button[type=submit]'); await ph.waitForSelector('#app:not([hidden])');
      check('the studio opens on a phone and is ready to go live', (await until(() => ph.evaluate(() => !document.querySelector('#goBtn').disabled && document.querySelector('#preview').videoWidth === 1280), 10000)) !== null
        && await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await ph.click('#camBtn');
      await ph.click('#goBtn');
      const onAir = (await until(() => ph.evaluate(() => !!window.__studio.live && window.__studio.pc && window.__studio.pc.connectionState === 'connected'), 20000)) !== null;
      const pv = await (await browser.newContext({ locale: 'ar-MA' })).newPage();
      await pv.goto(BASE + '/r/main');
      check('a live started from the phone reaches the viewers with a moving picture', onAir && (await until(() => pv.locator('#liveBadge.on').isVisible(), 20000)) !== null
        && (await until(() => sfu.evaluate(async () => { const p = window.paths.studio_main; if (!p) return false; const v = document.createElement('video'); v.muted = true; v.srcObject = p; await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 400)); return v.videoWidth === 1280; }), 20000)) !== null);
      await ph.screenshot({ path: path.join(OUT, 'studio-phone.png'), fullPage: true });
      await ph.click('#goBtn');
      await until(() => pv.locator('#liveBadge.off').isVisible());
      await pv.context().close(); await pctx.close();
    }
    // ---- the studio organised in sections with a side menu
    {
      const sp = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1400, height: 900 }, permissions: ['camera', 'microphone'] })).newPage();
      sp.on('pageerror', (e) => errors.push('sections: ' + e.message));
      await sp.goto(BASE + '/studio');
      await sp.fill('#pw', 'studio-pass-1'); await sp.click('#loginForm button[type=submit]'); await sp.waitForSelector('#app:not([hidden])');
      check('the studio opens on a home section, with a menu to the others', (await until(() => sp.locator('#homeDash').isVisible())) !== null && await sp.locator('#goBtn').isHidden() && await sp.locator('#invitePanel').isHidden()
        && (await sp.locator('#sideNav button').count()) === 8 && (await sp.textContent('#sideNav button.on')).includes('Accueil'));
      await sp.click('#tileLive');
      const liveTab = await sp.locator('#goBtn').isVisible() && await sp.locator('#homeDash').isHidden() && (await until(() => sp.evaluate(() => document.querySelector('#preview').videoWidth > 0), 8000)) !== null;
      await sp.click('#sideNav button[data-tab=agenda]');
      const agendaTab = await sp.locator('#schedOpen').isVisible() && await sp.locator('#goBtn').isHidden();
      await sp.screenshot({ path: path.join(OUT, 'studio-sections.png') });
      await sp.click('#sideNav button[data-tab=home]'); await sp.click('#tilePlan');
      check('each menu entry shows its own section; the tiles lead to the live and to the planner', liveTab && agendaTab && await sp.locator('#schedDlg[open]').isVisible());
      await sp.click('#schedCancel'); await sp.click('#sideNav button[data-tab=home]'); await sp.screenshot({ path: path.join(OUT, 'studio-home.png') });
      await sp.context().close();
    }
    check('no script errors in the pages', errors.length === 0, errors.join(' | '));
    check('media server credentials were sent on every upstream call', seen.unauth === 0 && !seen.hlsNoSecret);
  } finally {
    ff.kill('SIGKILL'); app.kill(); await browser.close(); rtc.close(); api.close(); hlsSrv.close(); lt.close(); aiSrv.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
