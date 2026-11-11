// REGAM Live - viewer page: HLS player, chat, "request to go on stage".
'use strict';
(async function () {
  const video = $('#video'), offline = $('#offline'), unmute = $('#unmute');
  const badge = $('#liveBadge'), handBtn = $('#handBtn'), guestLine = $('#guestLine');
  // the room comes from the address (/r/<room>); the front page is the first room
  const slug = (location.pathname.match(/^\/r\/([a-z0-9-]+)$/) || [])[1] || '';
  const cfgRes = await fetch('/api/config?room=' + slug);
  if (!cfgRes.ok) { location.replace('/rooms'); return; }
  const cfg = await cfgRes.json();
  window.REGAM_ROOM = cfg.room;
  if (cfg.rooms > 1 || cfg.accounts) $('#roomsLink').hidden = false;
  if (cfg.rooms > 1) { $('#roomHost').textContent = cfg.host; $('#roomHost').hidden = false; }
  document.title = cfg.title === cfg.site ? cfg.site : `${cfg.title} · ${cfg.site}`;
  $('#title').textContent = cfg.title;

  let live = false, hls = null, retry = null, onStage = false, handUp = false;

  // ---------------------------------------------------------------- name --
  const nameDlg = $('#nameDlg'), nameInput = $('#nameInput');
  function askName() {
    // where an account is needed to take part, the name is the account's name
    if (cfg.access !== 'open' && !account.token) { openAccount('login'); return Promise.resolve(null); }
    return new Promise((resolve) => {
      nameInput.value = link.name || '';
      const finish = (v) => { nameDlg.close(); resolve(v); };
      $('#nameForm').onsubmit = (e) => {
        e.preventDefault();
        const n = nameInput.value.trim().slice(0, 24);
        if (!n) return;
        link.setName(n); finish(n);
      };
      $('#nameCancel').onclick = () => finish(null);
      nameDlg.oncancel = () => resolve(null);
      nameDlg.showModal();
      nameInput.focus();
    });
  }

  const link = createLink({ name: account.name || store.get('regam.name') || '', room: cfg.room });
  mountAccount(document.querySelector('.top .meta'), cfg);
  const chat = mountChat($('#chat'), link, { askName });
  mountWho(link);

  // -------------------------------------------------------------- player --
  function stopHls() {
    clearTimeout(retry);
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src'); video.load();
  }
  function startHls() {
    stopHls();
    if (onStage || !live) return;
    const again = (ms = 2500) => { clearTimeout(retry); retry = setTimeout(startHls, ms); };
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // iPhone, iPad and Safari play HLS themselves: every browser on iOS is
      // Safari underneath, and its own player is the reliable one there.
      video.src = `${cfg.hls}?t=${Date.now()}`;
      video.onerror = () => again();
    } else if (window.Hls && Hls.isSupported()) {
      video.onerror = null;
      hls = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, manifestLoadingMaxRetry: 2, lowLatencyMode: false });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError(); else again();
      });
      hls.loadSource(cfg.hls);
      hls.attachMedia(video);
    } else {
      $('#offlineText').textContent = T('المتصفح ديالك ما كيدعمش هاد البث. جرب Chrome ولا Safari.');
      offline.hidden = false;
      return;
    }
    play();
    // The first seconds of a live have no picture to serve yet: if nothing
    // is on screen after a while, start the player again.
    retry = setTimeout(() => { if (live && !onStage && video.readyState < 2) startHls(); }, 9000);
  }
  async function play() {
    video.muted = false;
    try { await video.play(); unmute.hidden = true; }
    catch {                                 // browsers block autoplay with sound
      video.muted = true;
      unmute.hidden = false;
      video.play().catch(() => {});
    }
  }
  unmute.onclick = () => { video.muted = false; video.play(); unmute.hidden = true; };

  // ------------------------------------------- sound while nothing is live --
  // The room's host can give a sound (a recitation, music) for the time before the live.
  const soundBtn = $('#soundBtn');
  const waitSound = cfg.sound ? new Audio(cfg.sound) : null;
  let soundWanted = true;                       // the person has not paused it
  if (waitSound) { waitSound.loop = true; waitSound.preload = 'none'; }
  function syncSound() {
    if (!waitSound) return;
    const idle = !live && !onStage;
    soundBtn.hidden = !idle;
    if (idle && soundWanted) waitSound.play().catch(() => {});      // browsers start it only after a first tap
    else waitSound.pause();
    paintSound();
  }
  const paintSound = () => { soundBtn.textContent = T(waitSound && !waitSound.paused ? '⏸ وقف الصوت' : '🔊 استمع'); };
  if (waitSound) {
    waitSound.onplay = waitSound.onpause = paintSound;
    soundBtn.onclick = () => { soundWanted = waitSound.paused; if (soundWanted) waitSound.play().catch(() => {}); else waitSound.pause(); };
    // the first tap anywhere on the page lets the sound start
    addEventListener('pointerdown', (e) => { if (e.target !== soundBtn && soundWanted && !live && !onStage) waitSound.play().catch(() => {}); }, { once: true });
  }

  const sea = createSea($('#sea'));             // the scene under the sea shown while nothing is live
  function setLive(on) {
    live = on;
    badge.textContent = T(on ? 'مباشر' : 'غير مباشر');
    badge.className = 'badge ' + (on ? 'on' : 'off');
    offline.hidden = on;
    if (!on) unmute.hidden = true;
    handBtn.hidden = !on || onStage;
    if (on) startHls(); else stopHls();
    if (on) sea.stop(); else sea.start();
    syncSound();
  }
  function showGuests(list) {
    const on = (list || []).filter((g) => g.ready).map((g) => g.name);
    guestLine.hidden = on.length === 0;
    if (on.length) guestLine.textContent = T('{name} على المنصة مع {host}', { name: on.join(LANG === 'ar' ? '، ' : ', '), host: cfg.host });
  }
  function setHand(on) {
    handUp = on;
    handBtn.textContent = T(on ? 'إلغاء الطلب' : 'طلب الطلوع');
    handBtn.classList.toggle('active', on);
  }
  handBtn.onclick = async () => {
    if (!link.name && !(await askName())) return;
    link.send({ t: 'hand', on: !handUp });
  };

  // ----------------------------------------------------- reactions, share --
  mountReactions($('#reactions'), $('#hearts'), link, { canSend: true, totalEl: $('#likes') });
  $('#shareBtn').onclick = async () => {
    const data = { title: document.title, text: $('#title').textContent, url: location.origin + location.pathname };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); chat.say(T('تنسخ الرابط. لصقو فين بغيتي.')); }
    } catch (e) { if (e && e.name !== 'AbortError') chat.say(data.url, 8000); }
  };

  // ------------------------------------------------- on stage (the guest) --
  const inviteDlg = $('#inviteDlg'), inviteErr = $('#inviteErr'), stageBar = $('#stageBar'), micBtn = $('#micBtn');
  let stage = null;   // { token, slot, cam, pub, watch, voice }

  // A still, dark picture sent in place of the camera when it is off. It keeps the
  // video line open, so the camera can come back later without reconnecting.
  function blankVideo() {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); let n = 0;
    const paint = () => { x.fillStyle = '#1a2130'; x.fillRect(0, 0, 320, 240); x.fillStyle = (n++ % 2) ? '#1b2231' : '#1a2130'; x.fillRect(0, 0, 8, 8); };
    paint();
    const timer = setInterval(paint, 200);
    return { track: c.captureStream(5).getVideoTracks()[0], timer };
  }
  const camWanted = { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 20 }, facingMode: 'user' };
  const micWanted = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  async function goOnStage(token, slot, withCam = true) {
    let cam;
    try {
      try { cam = await navigator.mediaDevices.getUserMedia({ audio: micWanted, video: withCam ? camWanted : false }); }
      catch (e) {
        // the camera is refused, missing or busy: go up with the microphone alone
        if (!withCam) throw e;
        cam = await navigator.mediaDevices.getUserMedia({ audio: micWanted, video: false });
        withCam = false;
      }
    } catch (e) { if (e) e.step = `camera ${e.name || ''}`.trim(); throw e; }
    const vtrack = cam.getVideoTracks()[0] || null, blank = blankVideo();
    withCam = !!vtrack;
    stage = { token, slot, cam, vtrack, blank, vsender: null };
    let step = 'publish';                       // which part failed, shown to the person so it can be reported
    try {
      const pub = new RTCPeerConnection();
      stage.pub = pub;
      pub.addTransceiver(cam.getAudioTracks()[0], { direction: 'sendonly', streams: [cam] });
      const vt = pub.addTransceiver(vtrack || blank.track, { direction: 'sendonly', streams: [cam], sendEncodings: [{ maxBitrate: 500_000 }] });
      stage.vsender = vt.sender;
      preferH264(vt);
      await rtcNegotiate(pub, 'whip', 'guest' + slot, token);

    } catch (e) { leaveStage(false); if (e) e.step = `${step}${slot} ${e.status || e.name || ''}`.trim(); throw e; }

    onStage = true;
    stopHls();
    // The guest is on stage as soon as their camera is sent. What they see and hear comes
    // right after and never holds them back. Picture: the mixed broadcast. Sound: a mix made
    // for this guest (the host and the other guests), so nobody hears their own voice back.
    const mine = stage;
    const show = () => {
      if (stage !== mine) return;
      video.srcObject = new MediaStream([...(mine.watch ? mine.watch.stream.getVideoTracks() : []), ...(mine.voice ? mine.voice.stream.getAudioTracks() : [])]);
      video.muted = false;
      video.play().catch(() => {});
    };
    const join = (key, path, opts, failText) => rtcWatch(path, token, opts).then((v) => {
      if (stage !== mine) { rtcClose(v.pc, 'whep', path, token); return; }
      mine[key] = v; show();
      v.pc.addEventListener('track', () => setTimeout(show, 0));
    }).catch((e) => { if (stage === mine) chat.say(failText + ` [${key}${slot} ${(e && (e.status || e.name)) || ''}]`, 9000); });
    join('watch', 'studio', { tries: 40 }, T('ما وصلاتش الصورة ديال الاستوديو، ولكن راك على المنصة.'));
    join('voice', 'backstage' + slot, { video: false, tries: 50 }, T('ما وصلش الصوت ديال الاستوديو. نزل من المنصة وعاود طلب الطلوع.'));
    unmute.hidden = true; stageBar.hidden = false; handBtn.hidden = true;
    setMuted(false);
    lockLang(true);
    link.send({ t: 'onstage' });
    link.send({ t: 'cam', on: withCam });
    paintCam();
    stage.pub.onconnectionstatechange = () => {
      if (stage && ['failed', 'closed'].includes(stage.pub.connectionState)) { leaveStage(true); chat.say(T('تقطع الاتصال ديالك بالمنصة.')); }
    };
  }
  function leaveStage(tellServer) {
    if (!stage) return;
    const s = stage; stage = null;
    s.cam.getTracks().forEach((t) => t.stop());
    if (s.vtrack) s.vtrack.stop();
    clearInterval(s.blank.timer); s.blank.track.stop();
    if (s.pub) rtcClose(s.pub, 'whip', 'guest' + s.slot, s.token);
    if (s.watch) rtcClose(s.watch.pc, 'whep', 'studio', s.token);
    if (s.voice) rtcClose(s.voice.pc, 'whep', 'backstage' + s.slot, s.token);
    if (tellServer) link.send({ t: 'leave' });
    onStage = false;
    lockLang(false);
    video.srcObject = null;
    stageBar.hidden = true;
    handBtn.hidden = !live;
    setHand(false);
    if (live) startHls();
  }
  // The host can close a guest's microphone; the guest cannot reopen it until the host does.
  let hostMuted = false;
  function setMuted(on) {
    hostMuted = on;
    const t = stage && stage.cam.getAudioTracks()[0];
    if (t) t.enabled = !on;
    micBtn.disabled = on;
    micBtn.textContent = T(on ? 'صاحب اللايف سد ليك الميكرو' : 'سد الميكرو');
  }
  micBtn.onclick = () => {
    const t = stage && stage.cam.getAudioTracks()[0];
    if (!t || hostMuted) return;
    t.enabled = !t.enabled;
    micBtn.textContent = T(t.enabled ? 'سد الميكرو' : 'حل الميكرو');
  };
  // Camera on or off while on stage. Off: the camera is really released and a name card is shown.
  const camBtn = $('#camBtn');
  const paintCam = () => { camBtn.textContent = T(stage && stage.vtrack ? 'سد الكاميرا' : 'حل الكاميرا'); };
  camBtn.onclick = async () => {
    const s = stage;
    if (!s || !s.vsender || camBtn.disabled) return;
    camBtn.disabled = true;
    try {
      if (s.vtrack) {
        await s.vsender.replaceTrack(s.blank.track);
        s.vtrack.stop(); s.vtrack = null;
        link.send({ t: 'cam', on: false });
      } else {
        const t = (await navigator.mediaDevices.getUserMedia({ video: camWanted })).getVideoTracks()[0];
        if (stage !== s) { t.stop(); return; }
        await s.vsender.replaceTrack(t);
        s.vtrack = t;
        link.send({ t: 'cam', on: true });
      }
    } catch { chat.say(T('ما قدرناش نحلو الكاميرا. تأكد أن المتصفح مسموح ليه يستعملها.'), 6000); }
    finally { camBtn.disabled = false; paintCam(); }
  };
  $('#leaveBtn').onclick = () => leaveStage(true);

  // ---------------------------------------------------------------- link --
  link.on('full', () => {                       // the room has reached the number of viewers its plan allows
    setLive(false);
    $('#offlineText').textContent = T('القاعة عامرة دابا. غادي نعاودو نجربو بوحدنا من بعد شوية.');
  });
  // ---- waiting room: the person gives a name, the host lets them in (or not)
  const knockBtn = $('#knockBtn');
  const pass = () => fetch(`/api/pass?room=${encodeURIComponent(cfg.room)}&uid=${link.uid}`, { headers: account.token ? { Authorization: 'Bearer ' + account.token } : {} }).catch(() => {});
  async function knock() {
    const n = link.name || await askName();
    if (n) link.send({ t: 'knock', name: n });
  }
  knockBtn.onclick = knock;
  link.on('wait', (d) => {
    setLive(false);
    knockBtn.hidden = d.named;
    $('#offlineText').textContent = T(d.named ? 'وصل الطلب ديالك. تسنى صاحب اللايف يدخلك.' : 'هاد القاعة فيها قاعة انتظار. كتب سميتك، وصاحب اللايف غادي يدخلك.');
    if (!d.named && !nameDlg.open) knock();
  })
    .on('admitted', () => { knockBtn.hidden = true; link.hello(); })
    .on('refused', () => { setLive(false); knockBtn.hidden = true; $('#offlineText').textContent = T('صاحب اللايف ما قبلش الدخول ديالك.'); })
    .on('gate', (d) => { if (d.on) pass(); })
    .on('signin', () => {                     // the site is for signed-in people: show the way in
      setLive(false); knockBtn.hidden = true;
      $('#offlineText').textContent = T('خاصك حساب باش تتفرج. سجل ولا دخل بالحساب ديالك.');
      if (account.token) { account.clear(); location.reload(); return; }
      $('#signBtns').hidden = false;
    })
    .on('err', (d) => { if (d.code === 'signin') openAccount('login'); });
  $('#signIn').onclick = () => openAccount('login');
  $('#signUp').onclick = () => openAccount('signup');
  link.on('init', async (d) => {
    knockBtn.hidden = true;
    $('#offlineText').textContent = T('اللايف مازال ما بداش. خلي الصفحة مفتوحة، غادي يبدا بوحدو.');
    if (d.needPass) await pass();                 // lets the player fetch the stream
    setLive(d.live);
    $('#viewers').textContent = d.viewers;
    if (d.title) $('#title').textContent = d.title;
    showGuests(d.guests); setHand(!!d.hand);
    if (onStage && !(d.guests || []).some((g) => g.uid === link.uid)) leaveStage(false);
  })
    .on('live', (d) => setLive(d.on))
    .on('viewers', (d) => { $('#viewers').textContent = d.n; })
    .on('title', (d) => { $('#title').textContent = d.text || cfg.title; })
    .on('guests', (d) => showGuests(d.guests))
    .on('hand', (d) => { setHand(d.on); if (d.on) chat.say(T('وصل الطلب ديالك. تسنى صاحب اللايف يقبلو.'), 6000); })
    .on('invite', (d) => {
      setHand(false);
      inviteErr.hidden = true;
      const yes = $('#inviteYes'), mic = $('#inviteMic');
      const idle = () => { yes.disabled = mic.disabled = false; yes.textContent = T('طلع دابا'); mic.textContent = T('طلع بالميكرو فقط'); };
      const go = async (btn, withCam) => {
        yes.disabled = mic.disabled = true;
        btn.textContent = T('كنتصلو…');
        inviteErr.hidden = true;
        try { await goOnStage(d.token, d.slot, withCam); inviteDlg.close(); }
        catch (e) {
          inviteErr.hidden = false;
          inviteErr.textContent = e && e.name === 'NotAllowedError'
            ? T('خاصك تسمح للمتصفح باستعمال الكاميرا والميكرو، ومن بعد عاود.')
            : T('ما قدرناش نطلعوك للمنصة. تأكد من الكاميرا والأنترنيت وعاود.') + (e && e.step ? ` [${e.step}]` : '');
        }
        idle();
      };
      idle();
      yes.onclick = () => go(yes, true);
      mic.onclick = () => go(mic, false);
      $('#inviteNo').onclick = () => { inviteDlg.close(); link.send({ t: 'leave' }); };
      inviteDlg.oncancel = () => link.send({ t: 'leave' });
      inviteDlg.showModal();
    })
    .on('muted', (d) => { if (stage) { setMuted(!!d.on); chat.say(T(d.on ? 'صاحب اللايف سد ليك الميكرو.' : 'صاحب اللايف حل ليك الميكرو. تقدر تهضر.'), 5000); } })
    .on('kick', (d) => {
      if (inviteDlg.open) inviteDlg.close();
      const was = onStage;
      leaveStage(false);
      if (was && d.reason !== 'left') chat.say(T(d.reason === 'ended' ? 'سالا اللايف.' : 'صاحب اللايف نزلك من المنصة.'), 6000);
    });

  addEventListener('pagehide', () => leaveStage(true));
})();
