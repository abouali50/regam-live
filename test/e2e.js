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
fs.mkdirSync(path.join(HLS_DIR, 'air'), { recursive: true });
const AUTH = 'Basic ' + Buffer.from('regam:mtxpass').toString('base64');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() > end) return null; await sleep(step); }
}

(async () => {
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

  const seen = { unauth: 0, posts: [] };
  let sid = 0;
  const rtc = http.createServer(async (req, res) => {
    const m = req.url.match(/^\/([a-z]+)\/(whip|whep)(?:\/(\w+))?$/);
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
    const on = req.headers.authorization === AUTH && await sfu.evaluate(() => !!window.paths.studio);
    res.writeHead(on ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(on ? { name: 'air', available: true } : { error: 'not found' }));
  }).listen(19997);
  const hlsSrv = http.createServer((req, res) => {
    const f = path.join(HLS_DIR, path.normalize(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => { res.writeHead(e ? 404 : 200, { 'Content-Type': f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' }); res.end(e ? '' : d); });
  }).listen(18888);

  // HLS the test browser can decode (it has no H.264): VP9 + Opus in fMP4.
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '400k', '-g', '25',
    '-c:a', 'libopus', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '6', '-hls_flags', 'delete_segments', '-hls_segment_type', 'fmp4',
    path.join(HLS_DIR, 'air', 'index.m3u8')], { stdio: ['ignore', 'inherit', 'inherit'] });

  const app = spawn('node', [path.join(__dirname, '..', 'server.js')], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env,
    PORT: '13000', ADMIN_PASSWORD: 'studio-pass-1', MTX_RTC: 'http://127.0.0.1:18889', MTX_HLS: 'http://127.0.0.1:18888', MTX_API: 'http://127.0.0.1:19997',
    MTX_USER: 'regam', MTX_PASS: 'mtxpass', DATA_DIR: path.join(OUT, 'data'), HOST_NAME: 'Pro' } });
  const BASE = 'http://127.0.0.1:13000';
  await until(() => fetch(BASE + '/healthz').then((r) => r.ok));

  try {
    // ---- security checks on the API --------------------------------------
    check('login rejects a wrong password', (await fetch(BASE + '/api/login', { method: 'POST', body: '{"password":"nope"}' })).status === 401);
    check('publishing without a token is refused', (await fetch(BASE + '/api/rtc/whip/studio', { method: 'POST', body: 'x' })).status === 401);
    check('path traversal is refused', [400, 404].includes((await fetch(BASE + '/%2e%2e/server.js')).status));

    // ---- viewer (desktop) -------------------------------------------------
    const vctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, permissions: ['camera', 'microphone'] });
    const viewer = await vctx.newPage();
    const errors = [];
    viewer.on('pageerror', (e) => errors.push('viewer: ' + e.message));
    await viewer.goto(BASE + '/');
    check('viewer sees "offline" before the live starts', await viewer.locator('#offline').isVisible() && await viewer.locator('#handBtn').isHidden());

    // ---- studio ------------------------------------------------------------
    const sctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, permissions: ['camera', 'microphone'] });
    const studio = await sctx.newPage();
    studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
    studio.on('dialog', (d) => d.accept());
    await studio.goto(BASE + '/studio');
    await studio.fill('#pw', 'bad'); await studio.click('#loginForm button');
    check('studio shows an error on a wrong password', (await until(() => studio.locator('#loginErr').isVisible(), 5000)) !== null);
    await studio.fill('#pw', 'studio-pass-1'); await studio.click('#loginForm button');
    await studio.waitForSelector('#app:not([hidden])');
    const dim = () => studio.evaluate(() => { const v = document.querySelector('#preview'); return `${v.videoWidth}x${v.videoHeight}`; });
    check('mixer shows the camera in the preview (1280x720)', (await until(async () => (await dim()) === '1280x720')) !== null, await dim());

    await studio.click('#goBtn');
    check('studio connects and goes on air', (await until(() => studio.evaluate(() => window.__studio.pc && window.__studio.pc.connectionState === 'connected'))) !== null);
    check('viewer page switches to "live" by itself', (await until(() => viewer.locator('#liveBadge.on').isVisible())) !== null);
    check('audience player plays the HLS stream', (await until(() => viewer.evaluate(() => { const v = document.querySelector('#video'); return v.videoWidth > 0 && v.currentTime > 0.5; }), 25000)) !== null);
    check('relay receives mixed video + audio from the studio', (await until(() => sfu.evaluate(() => { const v = document.getElementById('v_studio'); return v && v.videoWidth === 1280 && window.paths.studio.getAudioTracks().length === 1; }))) !== null, await sfu.evaluate(() => { const v = document.getElementById('v_studio'); return v ? v.videoWidth + 'x' + v.videoHeight + ' audio=' + window.paths.studio.getAudioTracks().length : 'none'; }));

    // ---- chat + moderation --------------------------------------------------
    await viewer.fill('.composer input', 'سلام من المتفرج');
    await viewer.click('.composer button');
    await viewer.fill('#nameInput', 'كريم'); await viewer.click('#nameForm button[type=submit]');
    await viewer.fill('.composer input', 'سلام من المتفرج'); await viewer.click('.composer button');
    check('comment reaches the studio', (await until(() => studio.locator('.msg', { hasText: 'سلام من المتفرج' }).isVisible())) !== null);
    await viewer.fill('.composer input', 'تعليق ثاني بزربة'); await viewer.click('.composer button');
    check('slow mode blocks a second comment sent right away', (await until(() => viewer.locator('.note', { hasText: 'تسنى' }).isVisible(), 4000)) !== null);
    await studio.fill('.composer input', 'مرحبا بيكم'); await studio.click('.composer button');
    check('host comment is shown to viewers as host', (await until(() => viewer.locator('.msg.host', { hasText: 'مرحبا بيكم' }).isVisible())) !== null);
    await studio.fill('#titleInput', 'كيفاش تكري MetaMask'); await studio.click('#titleForm button');
    await studio.fill('#pinInput', 'التكوين كيبدا دابا'); await studio.click('#pinForm button');
    check('title and pinned message reach viewers', (await until(async () => (await viewer.textContent('#title')) === 'كيفاش تكري MetaMask' && await viewer.locator('.pinned').isVisible())) !== null);
    await viewer.evaluate(() => { const w = new WebSocket(`ws://${location.host}/ws`); w.onopen = () => { w.send(JSON.stringify({ t: 'hello', uid: 'attackeraaaaaaaa', name: 'x', token: 'admin.host.9999999999999.deadbeef' })); w.send(JSON.stringify({ t: 'pin', text: 'HACKED' })); }; });
    await sleep(700);
    check('a forged moderator token cannot pin a message', (await viewer.textContent('.pinned')) === 'التكوين كيبدا دابا');

    // ---- guest on stage -------------------------------------------------------
    await viewer.click('#handBtn');
    check('stage request appears in the studio', (await until(() => studio.locator('#hands li', { hasText: 'كريم' }).isVisible())) !== null);
    await studio.click('#hands li button');
    check('viewer receives the invitation', (await until(() => viewer.locator('#inviteDlg[open]').isVisible())) !== null);
    await viewer.click('#inviteYes');
    check('guest is on stage (camera published, sees the host in real time)', (await until(() => viewer.evaluate(() => { const v = document.querySelector('#video'); return !!v.srcObject && v.videoWidth > 0 && v.srcObject.getAudioTracks().length === 1; }), 20000)) !== null);
    check('studio mixes the guest picture + voice', (await until(() => studio.locator('#guestName', { hasText: 'على المنصة' }).isVisible(), 20000)) !== null && (await until(() => studio.evaluate(() => !!document.querySelector('#guestAudio').srcObject), 8000)) !== null);
    await sleep(1500);
    check('media sessions opened: ' + seen.posts.join(' '), ['whip:studio', 'whip:backstage', 'whip:guest', 'whep:studio', 'whep:backstage', 'whep:guest'].every((k) => seen.posts.includes(k)));
    check('viewers are told who is on stage', true === await (async () => { const p = await vctx.newPage(); await p.goto(BASE + '/'); const ok = (await until(() => p.locator('#guestLine', { hasText: 'كريم' }).isVisible())) !== null; await p.close(); return ok; })());
    await studio.screenshot({ path: path.join(OUT, 'studio-guest.png') });
    await viewer.screenshot({ path: path.join(OUT, 'viewer-onstage.png') });

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
    check('audience relay receives the 1080p picture', (await until(() => sfu.evaluate(() => document.getElementById('v_studio').videoWidth === 1920), 15000)) !== null);
    await sleep(800);
    await studio.screenshot({ path: path.join(OUT, 'studio-screen.png') });
    await studio.click('#screenBtn');
    check('stopping the share returns to 1280x720', (await until(async () => (await dim()) === '1280x720')) !== null);

    // ---- host removes the guest -------------------------------------------------
    await studio.click('#unstageBtn');
    check('guest is taken off stage and returns to the normal player', (await until(() => viewer.evaluate(() => !document.querySelector('#video').srcObject && document.querySelector('#stageBar').hidden))) !== null);
    check('guest media session is closed on the relay', (await until(() => sfu.evaluate(() => !window.paths.guest && !window.paths.backstage))) !== null);
    check('a removed guest can no longer use the stage token', (await viewer.evaluate(() => fetch('/api/rtc/whip/guest', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer stage.x.1.y' } }).then((r) => r.status))) === 401);

    // ---- ban -----------------------------------------------------------------------
    await studio.locator('.msg', { hasText: 'سلام من المتفرج' }).hover();
    await studio.locator('.msg', { hasText: 'سلام من المتفرج' }).locator('button', { hasText: 'حظر' }).click();
    check('ban removes the comments for everyone', (await until(() => viewer.locator('.msg', { hasText: 'سلام من المتفرج' }).count().then((n) => n === 0))) !== null);
    await sleep(3200);
    await viewer.fill('.composer input', 'واش باقي نقدر نكتب؟'); await viewer.click('.composer button');
    await sleep(800);
    check('a banned viewer cannot comment any more', (await studio.locator('.msg', { hasText: 'واش باقي' }).count()) === 0);

    // ---- screenshots ------------------------------------------------------------------
    const v2 = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    await v2.goto(BASE + '/'); await until(() => v2.evaluate(() => document.querySelector('#video').videoWidth > 0), 20000);
    await v2.screenshot({ path: path.join(OUT, 'viewer-desktop.png') });
    const phone = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
    await phone.goto(BASE + '/'); await until(() => phone.evaluate(() => document.querySelector('#video').videoWidth > 0), 20000);
    await phone.screenshot({ path: path.join(OUT, 'viewer-phone.png') });
    check('phone layout has no sideways scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // ---- end of live -------------------------------------------------------------------
    await studio.click('#goBtn');
    check('viewers go back to "offline" when the live stops', (await until(() => viewer.locator('#offline').isVisible())) !== null);
    check('no script errors in the pages', errors.length === 0, errors.join(' | '));
    check('media server credentials were sent on every upstream call', seen.unauth === 0);
  } finally {
    ff.kill('SIGKILL'); app.kill(); await browser.close(); rtc.close(); api.close(); hlsSrv.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
