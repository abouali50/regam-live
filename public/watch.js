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
      if (TOUCH) nameInput.blur(); else nameInput.focus();
    });
  }

  const link = createLink({ name: account.name || store.get('regam.name') || '', room: cfg.room });
  mountAccount(document.querySelector('.top .meta'), cfg);
  if (cfg.assistant) mountAssistant();
  // the room's entry code: from the invitation link (?code=...), or typed once and remembered
  const codeKey = 'regam.code.' + cfg.room;
  link.code = (new URLSearchParams(location.search).get('code') || store.get(codeKey) || '').replace(/\D/g, '');
  if (new URLSearchParams(location.search).get('code')) { store.set(codeKey, link.code); history.replaceState(null, '', location.pathname); }
  // the session the host announced
  function showNext(next) {
    const line = $('#nextLine');
    line.hidden = !next;
    if (!next) return;
    const loc = LANG === 'ar' ? 'ar-MA' : LANG;
    const when = new Date(next.at).toLocaleString(loc, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      + (next.end ? ' – ' + new Date(next.end).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : '');
    // how long until it starts, kept up to date
    const left = () => {
      const m = Math.round((next.at - Date.now()) / 60000);
      return m <= 0 ? T('دابا') : m < 60 ? T('من هنا {n} دقيقة', { n: m }) : m < 48 * 60 ? T('من هنا {h} ساعة و {n} دقيقة', { h: Math.floor(m / 60), n: m % 60 }) : T('من هنا {d} يوم', { d: Math.round(m / 1440) });
    };
    const paint = () => line.replaceChildren(el('span', {}, T('اللايف الجاي: {when}', { when }) + (next.title ? ' · ' + next.title : '')), el('span', { class: 'next-left' }, left()),
      el('a', { class: 'next-ics', href: `/api/ics?room=${encodeURIComponent(cfg.room)}&id=${next.id}` }, T('زيدو للأجندة')));
    clearInterval(showNext.timer); showNext.timer = setInterval(paint, 30000);
    paint();
  }
  showNext(cfg.next);
  const chat = mountChat($('#chat'), link, { askName });

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
  // one file, or several played one after the other and then again from the first
  const tracks = (cfg.sounds && cfg.sounds.length ? cfg.sounds : cfg.sound ? [cfg.sound] : []);
  const waitSound = tracks.length ? new Audio(tracks[0]) : null;
  let trackAt = 0, trackFails = 0;
  let soundWanted = true;                       // the person has not paused it
  if (waitSound) {
    waitSound.loop = tracks.length === 1; waitSound.preload = 'none';
    const step = () => { trackAt = (trackAt + 1) % tracks.length; waitSound.src = tracks[trackAt]; if (soundWanted && !live && !onStage && !doorShut) waitSound.play().catch(() => {}); };
    waitSound.addEventListener('ended', () => { trackFails = 0; if (tracks.length > 1) step(); });
    waitSound.addEventListener('error', () => { if (tracks.length > 1 && ++trackFails < tracks.length) step(); });      // a file that cannot be read is skipped
  }
  let doorShut = false;                         // waiting for an account, a code or the host's yes
  function syncSound() {
    if (!waitSound) return;
    const idle = !live && !onStage && !doorShut;      // nothing for people who are not let in yet
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
    addEventListener('pointerdown', (e) => { if (e.target !== soundBtn && soundWanted && !live && !onStage && !doorShut) waitSound.play().catch(() => {}); }, { once: true });
  }

  const sea = createSea($('#sea'));             // light, fish and bubbles over the picture shown while nothing is live
  // The pictures behind: the room's own, one after the other, or the reef that comes with the site.
  const pics = (cfg.pics || []).length ? cfg.pics.map((p) => p.url) : ['/sea.webp'];
  const layers = [...document.querySelectorAll('#offline .reef')];
  let picAt = 0, picTimer = null;
  const showPic = (i) => {
    const top = layers[i % 2], img = new Image();
    img.onload = () => { top.style.backgroundImage = `url("${pics[i % pics.length]}")`; top.classList.add('on'); layers[(i + 1) % 2].classList.remove('on'); };
    img.src = pics[i % pics.length];
  };
  function slides(on) {
    clearInterval(picTimer); picTimer = null;
    if (!on) return;
    showPic(picAt);
    if (pics.length > 1) picTimer = setInterval(() => showPic(++picAt), 12000);
  }
  function setLive(on) {
    live = on;
    badge.textContent = T(on ? 'مباشر' : 'غير مباشر');
    badge.className = 'badge ' + (on ? 'on' : 'off');
    offline.hidden = on;
    if (!on) unmute.hidden = true;
    handBtn.hidden = !on || onStage;
    $('#offlineHint').hidden = on || doorShut;      // how to come up on stage, told while people wait
    if (on) startHls(); else stopHls();
    if (on) sea.stop(); else sea.start();
    slides(!on);
    syncSound();
  }
  function showGuests(list) {
    const on = (list || []).filter((g) => g.ready).map((g) => g.name);
    guestLine.hidden = on.length === 0;
    if (on.length) guestLine.textContent = T('{name} على المنصة مع {host}', { name: on.join(LANG === 'ar' ? '، ' : ', '), host: cfg.host });
  }
  // Two ways to ask for the floor: the raised hand, and the point of order (one hand up, a finger raised),
  // which the host hears before the others.
  const pointBtn = $('#pointBtn');
  let pointUp = false;
  function setHand(on, point) {
    handUp = on && !point; pointUp = on && !!point;
    handBtn.textContent = T(handUp ? 'إلغاء الطلب' : 'طلب الطلوع');
    handBtn.classList.toggle('active', handUp);
    pointBtn.textContent = T(pointUp ? 'إلغاء نقطة النظام' : '☝️ نقطة نظام');
    pointBtn.classList.toggle('active', pointUp);
  }
  handBtn.onclick = async () => {
    if (!link.name && !(await askName())) return;
    link.send({ t: 'hand', on: !handUp });
  };
  pointBtn.onclick = async () => {
    if (!link.name && !(await askName())) return;
    link.send({ t: 'hand', on: !pointUp, point: true });
  };
  new MutationObserver(() => { pointBtn.hidden = handBtn.hidden; }).observe(handBtn, { attributes: true, attributeFilter: ['hidden'] });
  pointBtn.hidden = handBtn.hidden;
  mountPeople($('#peopleBtn'), link);

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
    paintBar();
  }
  micBtn.onclick = () => {
    const t = stage && stage.cam.getAudioTracks()[0];
    if (!t || hostMuted) return;
    t.enabled = !t.enabled;
    micBtn.textContent = T(t.enabled ? 'سد الميكرو' : 'حل الميكرو');
    paintBar();
  };
  // Camera on or off while on stage. Off: the camera is really released and a name card is shown.
  const camBtn = $('#camBtn');
  const paintCam = () => { camBtn.textContent = T(stage && stage.vtrack ? 'سد الكاميرا' : 'حل الكاميرا'); paintBar(); };
  // The bar is compact: an icon and one short word per button; the full sentence stays as the tooltip.
  function paintBar() {
    const micOn = !!(stage && stage.cam.getAudioTracks()[0] && stage.cam.getAudioTracks()[0].enabled), camOn = !!(stage && stage.vtrack);
    const set = (b, icon, word, off) => { b.dataset.icon = icon; b.dataset.word = T(word); b.classList.toggle('off', off); b.title = b.textContent; b.setAttribute('aria-label', b.textContent); };
    set(micBtn, micOn ? '🎤' : '🔇', 'الميكرو', !micOn);
    set(camBtn, '📷', 'الكاميرا', !camOn);
    set($('#barCap'), '🌐', 'الترجمة', false);
    set($('#leaveBtn'), '✕', 'نزل', false);
  }
  paintBar();
  $('#barCap').onclick = () => { capMenu.classList.add('from-bar'); capMenu.hidden = !capMenu.hidden; };
  // the page keeps room for the bar, whatever its height, so it never covers the comments
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', (stageBar.hidden ? 0 : stageBar.offsetHeight) + 'px')).observe(stageBar);
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
  // ---- assistant: a member the host chose to help. Requests show in a bar at the top, like in the studio.
  let helping = false, hDoor = [], hHands = [], hGuests = [];
  function helperBar() {
    const bar = $('#helperBar');
    // shown only when there is something for the assistant to do
    bar.hidden = !helping || hDoor.length + hHands.length + hGuests.length === 0;
    if (bar.hidden) return;
    const group = (title, items) => (items.length ? el('span', { class: 'wait-group' }, el('strong', {}, title), ...items) : null);
    const act = (text, msg, cls = '') => el('button', { class: 'btn small ' + cls, type: 'button', onclick: () => link.send(msg) }, text);
    bar.replaceChildren(...[el('span', { class: 'badge wait' }, T('مساعد')),
      group(T('كيتسناو يدخلو'), hDoor.slice(0, 5).map((w) => el('span', { class: 'wait-one' }, el('span', {}, w.name), act(T('قبول'), { t: 'admit', uid: w.uid, ok: true }, 'primary'), act(T('رفض'), { t: 'admit', uid: w.uid, ok: false })))),
      group(T('بغاو يطلعو للمنصة'), hHands.slice(0, 5).map((h) => el('span', { class: 'wait-one' }, el('span', {}, h.name), act(T('قبول'), { t: 'stage', uid: h.uid }, 'primary')))),
      group(T('على المنصة'), hGuests.map((g) => el('span', { class: 'wait-one' }, el('span', {}, g.name + (g.muted ? ' 🔇' : '')), act(T(g.muted ? 'حل ليه الميكرو' : 'سد ليه الميكرو'), { t: 'mute', uid: g.uid, on: !g.muted }), act(T('نزلو من المنصة'), { t: 'unstage', uid: g.uid }, 'danger'))))].filter(Boolean));
  }
  link.on('init', (d) => { helping = !!d.helper; hDoor = d.waiting || []; hHands = d.hands || []; hGuests = d.guests || []; helperBar(); })
    .on('waiting', (d) => { hDoor = d.list || []; helperBar(); })
    .on('hands', (d) => { hHands = d.list || []; helperBar(); })
    .on('guests', (d) => { hGuests = d.guests || []; helperBar(); })
    .on('helper', () => location.reload());       // named or removed while on the page

  // ---- live translation: the host's words as text under the picture, and spoken if the person wants
  const capBtn = $('#capBtn'), capMenu = $('#capMenu'), capLine = $('#capLine');
  // Until the person chooses, the translation follows the language of their page.
  let capAuto = store.get('regam.cap') === null;
  let capLang = capAuto ? LANG : store.get('regam.cap'), capVoice = store.get('regam.capVoice') === '1', capHide = null;
  const VOICE = { ar: 'ar-SA', fr: 'fr-FR', en: 'en-US' };
  $('#capLang').value = capLang; $('#capVoice').checked = capVoice;
  const paintCap = () => { capBtn.classList.toggle('on', !!capLang); if (!capLang) { capLine.hidden = true; if (window.speechSynthesis) speechSynthesis.cancel(); video.volume = 1; } };
  paintCap();
  capBtn.onclick = () => { capMenu.classList.remove('from-bar'); capMenu.hidden = !capMenu.hidden; capBtn.setAttribute('aria-expanded', capMenu.hidden ? 'false' : 'true'); };
  document.addEventListener('pointerdown', (e) => { if (!capMenu.hidden && !e.target.closest('.cap-wrap') && !e.target.closest('#barCap')) { capMenu.hidden = true; capBtn.setAttribute('aria-expanded', 'false'); } });
  $('#capLang').onchange = () => { capLang = $('#capLang').value; capAuto = false; store.set('regam.cap', capLang); paintCap(); };
  $('#capVoice').onchange = () => {
    capVoice = $('#capVoice').checked; store.set('regam.capVoice', capVoice ? '1' : '0');
    // phones let a page speak only after a tap: this tap is the one
    if (capVoice && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    if (!capVoice && window.speechSynthesis) { speechSynthesis.cancel(); video.volume = 1; }
  };
  function showCap(d) {
    if (!capLang || !live) return;
    if (capAuto && (d.src === capLang || !d.tx[capLang])) return;      // nothing to translate for this person
    const text = d.tx[capLang] || d.tx[d.src];
    capLine.textContent = text; capLine.hidden = false;
    clearTimeout(capHide); capHide = setTimeout(() => { capLine.hidden = true; }, Math.min(12000, 3500 + text.length * 70));
    if (capVoice && window.speechSynthesis && d.tx[capLang] && d.src !== capLang) {       // spoken only when it really is a translation
      const u = new SpeechSynthesisUtterance(d.tx[capLang]);
      u.lang = VOICE[capLang]; u.rate = 1.05;
      u.onstart = () => { video.volume = 0.2; };                    // the host's own voice goes quiet under the translation
      u.onend = u.onerror = () => { if (!speechSynthesis.pending) video.volume = 1; };
      speechSynthesis.speak(u);
    }
  }
  // The audience sees the picture a few seconds late; the words wait the same time so they land on the right moment.
  const capDelay = () => (onStage ? 0 : hls && hls.latency > 0 ? Math.min(30, hls.latency) * 1000 : 7000);
  link.on('cap', (d) => { if (capLang) setTimeout(() => showCap(d), capDelay()); });

  // ---- a question for the teacher: it goes to a list of its own, apart from the comments
  $('#askBtn').onclick = async () => {
    if (!account.token && cfg.access !== 'open') { openAccount('login'); return; }
    if (!link.name) { const n = await askName(); if (!n) return; }
    $('#askText').value = ''; $('#askDlg').showModal(); focusSoon($('#askText'));
  };
  $('#askCancel').onclick = () => $('#askDlg').close();
  $('#askForm').onsubmit = (e) => { e.preventDefault(); const text = $('#askText').value.trim(); if (text) link.send({ t: 'ask', text }); $('#askDlg').close(); };
  const toast = (text) => { const el0 = $('#guestLine'); el0.hidden = false; el0.textContent = text; setTimeout(() => { if (el0.textContent === text) { el0.textContent = ''; el0.hidden = true; } }, 5000); };
  link.on('asked', (d) => toast(T(d.wait ? 'تسنى شوية قبل ما تصيفط سؤال آخر.' : 'وصل السؤال ديالك للأستاذ.')));

  // ---- a poll or a quiz from the teacher: answer with one tap, see the result
  function showPoll(p) {
    $('#pollBox').hidden = !!p.off;
    if (p.off) return;
    $('#pollQ').textContent = p.q;
    const total = Math.max(1, p.total);
    $('#pollOpts').replaceChildren(...p.opts.map((o, i) => {
      const n = p.counts ? p.counts[i] : 0, pct = p.counts ? Math.round((n / total) * 100) : 0;
      return el('button', { type: 'button', class: 'poll-opt' + (p.mine === i ? ' mine' : '') + (p.correct === i ? ' right' : ''), disabled: p.open ? null : '', style: `--pct:${pct}%`,
        onclick: () => link.send({ t: 'vote', id: p.id, i }) }, el('span', { class: 'poll-label' }, (p.correct === i ? '✓ ' : '') + o), p.counts ? el('span', { class: 'poll-pct' }, pct + '%') : null);
    }));
    $('#pollNote').textContent = !p.open ? T('سالا التصويت. {n} جاوبو.', { n: p.total }) : p.mine === undefined ? T('ختار جواب واحد.') : T('تسجل الجواب ديالك. تقدر تبدلو حتى يسالي التصويت.');
  }
  link.on('poll', showPoll);

  // ---- what the class keeps for its students: replays of past lives, files to download
  async function loadExtras() {
    let d;
    try { d = await (await fetch('/api/extras?room=' + encodeURIComponent(cfg.room), { headers: account.token ? { Authorization: 'Bearer ' + account.token } : {} })).json(); } catch { return; }
    const loc = LANG === 'ar' ? 'ar-MA' : LANG;
    $('#replayBox').hidden = !d.replays.length; $('#fileBox').hidden = !d.files.length; $('#extras').hidden = !d.replays.length && !d.files.length;
    $('#replays').replaceChildren(...d.replays.map((r) => el('li', {},
      el('span', {}, el('strong', {}, r.title), ' ', el('span', { class: 'muted' }, new Date(r.at).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }))),
      el('button', { class: 'btn primary', type: 'button', onclick: () => { $('#replayTitle').textContent = r.title; $('#replayVideo').src = r.url; $('#replayDlg').showModal(); $('#replayVideo').play().catch(() => {}); } }, T('▶ شوف')))));
    $('#classFiles').replaceChildren(...d.files.map((f) => el('li', {},
      el('span', {}, '📄 ' + f.name + ' ', el('span', { class: 'muted', dir: 'ltr' }, f.size >= 1e6 ? (f.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1e3)) + ' KB')),
      el('a', { class: 'btn', href: f.url, download: f.name }, T('تحميل')))));
  }
  const stopReplay = () => { $('#replayVideo').pause(); $('#replayVideo').removeAttribute('src'); $('#replayVideo').load(); };
  $('#replayClose').onclick = () => $('#replayDlg').close();
  $('#replayDlg').addEventListener('close', stopReplay);

  // ---- a paid class: pay with PayPal, come back, come in
  const payBtn = $('#payBtn');
  const priceLine = (fee) => T(fee.days === 1 ? 'هاد الدرس بالخلاص: {amount} دولار لنهار واحد.' : 'هاد الدرس بالخلاص: {amount} دولار ل 30 يوم.', { amount: fee.amount });
  payBtn.onclick = async () => {
    payBtn.disabled = true;
    const r = await fetch('/api/pay/entry?room=' + encodeURIComponent(cfg.room), { method: 'POST', headers: { Authorization: 'Bearer ' + account.token } }).catch(() => null);
    const out = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok && out.url) { location.href = out.url; return; }
    payBtn.disabled = false;
    $('#offlineText').textContent = T('PayPal ما جاوبش. عاود جرب من بعد شوية.');
  };
  {
    const paid = new URLSearchParams(location.search).get('paid');
    if (paid) {
      history.replaceState(null, '', location.pathname);
      setTimeout(() => { if (paid !== '1') $('#offlineText').textContent = T(paid === 'cancel' ? 'تلغى الخلاص. ما تخلص والو.' : paid === 'wait' ? 'الخلاص مازال كيتراجع عند PayPal. عاود حل الصفحة من بعد شوية.' : 'الخلاص ما دازش. ما تخلص والو. عاود جرب ولا تواصل مع الإدارة.'); }, 1200);
    }
  }
  // ---- waiting room: the person gives a name, the host lets them in (or not)
  const knockBtn = $('#knockBtn');
  const pass = () => fetch(`/api/pass?room=${encodeURIComponent(cfg.room)}&uid=${link.uid}&code=${link.code}`, { headers: account.token ? { Authorization: 'Bearer ' + account.token } : {} }).catch(() => {});
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
    .on('next', (d) => showNext(d.next))
    .on('code', (d) => {                      // the room asks for its entry code
      doorShut = true; setLive(false); knockBtn.hidden = true;
      $('#offlineText').textContent = T('هاد القاعة كيدخلو ليها بكود الدخول.');
      const dlg = $('#codeDlg'), err = $('#codeErr');
      err.hidden = !d.bad && !d.wait && !d.early;
      err.textContent = d.early ? T('هاد الكود ديال لايف مبرمج ل {when}. غادي يخدم نص ساعة قبل البداية.', { when: new Date(d.early).toLocaleString(LANG === 'ar' ? 'ar-MA' : LANG, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })
        : T(d.wait ? 'محاولات بزاف. تسنى عشر دقايق وعاود.' : 'الكود غالط ولا سالا الوقت ديالو. شوف الدعوة وعاود.');
      $('#codeForm').onsubmit = (e) => {
        e.preventDefault();
        link.code = $('#codeInput').value.replace(/\D/g, '');
        store.set(codeKey, link.code);
        dlg.close(); link.hello();
      };
      $('#codeInput').value = '';
      if (!dlg.open) { dlg.showModal(); $('#codeInput').blur(); }      // the dialog focuses its first field by itself: undone on phones
      focusSoon($('#codeInput'));
    })
    .on('pay', (d) => {                       // a paid class: the price, and the way to pay it
      doorShut = true; setLive(false); knockBtn.hidden = true; $('#signBtns').hidden = true;
      $('#offlineText').textContent = priceLine(d.fee) + ' ' + T(d.ready ? 'خلص ب PayPal ولا بالكارط، ومن بعد كتدخل نيشان.' : 'الخلاص أونلاين ما خدامش دابا. تواصل مع الأستاذ.');
      payBtn.hidden = !d.ready;
    })
    .on('closed', () => {                     // a class kept for its own students
      doorShut = true; setLive(false); knockBtn.hidden = true; payBtn.hidden = true; $('#signBtns').hidden = true;
      $('#offlineText').textContent = T('هاد القاعة خاصة بالتلاميذ ديال الأستاذ. طلب منو يزيدك للائحة بالإيميل ديال الحساب ديالك.');
    })
    .on('signin', (d) => {                    // the site (or this class) is for signed-in people: show the way in
      doorShut = true; setLive(false); knockBtn.hidden = true;
      $('#offlineText').textContent = (d.fee ? priceLine(d.fee) + ' ' : '') + T(d.fee || d.closed ? 'دخل للحساب ديالك أولا، ولا سجل بالإيميل ديالك.' : 'مرحبا بك. عندك حساب؟ دخل. ما عندكش؟ سجل بالإيميل ديالك وغادي يوصلك كود التفعيل.');
      if ((d.fee || d.closed) && cfg.access !== 'watch') { $('#signBtns').hidden = !!account.token; if (account.token) { account.clear(); location.reload(); } return; }
      if (account.token) { account.clear(); location.reload(); return; }
      $('#signBtns').hidden = false;
    })
    .on('err', (d) => { if (d.code === 'signin') openAccount('login'); });
  $('#signIn').onclick = () => openAccount('login');
  $('#signUp').onclick = () => openAccount('signup');
  link.on('init', async (d) => {
    doorShut = false; $('#signBtns').hidden = true;
    knockBtn.hidden = true; payBtn.hidden = true;
    $('#offlineText').textContent = T('اللايف مازال ما بداش. خلي الصفحة مفتوحة، غادي يبدا بوحدو.');
    if ($('#codeDlg').open) $('#codeDlg').close();
    showNext(d.next);
    showPoll(d.poll || { off: true });
    loadExtras();
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
    .on('hand', (d) => { setHand(d.on, d.point); if (d.on) chat.say(T('وصل الطلب ديالك. تسنى صاحب اللايف يقبلو.'), 6000); })
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
