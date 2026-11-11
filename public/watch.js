// REGAM Live - viewer page: HLS player, chat, "request to go on stage".
'use strict';
(async function () {
  const video = $('#video'), offline = $('#offline'), unmute = $('#unmute');
  const badge = $('#liveBadge'), handBtn = $('#handBtn'), guestLine = $('#guestLine');
  const cfg = await fetch('/api/config').then((r) => r.json());
  document.title = cfg.title;
  $('#title').textContent = cfg.title;

  let live = false, hls = null, retry = null, onStage = false, handUp = false;

  // ---------------------------------------------------------------- name --
  const nameDlg = $('#nameDlg'), nameInput = $('#nameInput');
  function askName() {
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

  const link = createLink({ name: store.get('regam.name') || '' });
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

  function setLive(on) {
    live = on;
    badge.textContent = T(on ? 'مباشر' : 'غير مباشر');
    badge.className = 'badge ' + (on ? 'on' : 'off');
    offline.hidden = on;
    if (!on) unmute.hidden = true;
    handBtn.hidden = !on || onStage;
    if (on) startHls(); else stopHls();
  }
  function showGuest(g) {
    guestLine.hidden = !g || !g.ready;
    if (g) guestLine.textContent = T('{name} على المنصة مع {host}', { name: g.name, host: cfg.host });
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
  const REACTIONS = [['👍', 'إعجاب'], ['🤗', 'تعاطف'], ['❤️', 'قلب'], ['😂', 'ضحك'], ['🤭', 'مفاجأة'], ['😳', 'خجل'], ['🤔', 'تفكير']];
  const heartsBox = $('#hearts');
  let likeTotal = 0, mine = 0;
  const sent = REACTIONS.map(() => 0);        // my own reactions not yet echoed by the server
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function floatEmoji(k) {
    if (calm || document.hidden || heartsBox.childElementCount > 28) return;
    const h = el('span', { class: 'float-heart' }, REACTIONS[k][0]);
    h.style.setProperty('--x', `${Math.round(Math.random() * 60 - 30)}px`);
    h.style.setProperty('--s', (0.8 + Math.random() * 0.7).toFixed(2));
    heartsBox.append(h);
    h.addEventListener('animationend', () => h.remove());
  }
  function showLikes(n, r) {
    likeTotal = n; mine = 0;
    $('#likes').textContent = n;
    let shown = 0;
    (r || []).forEach((count, k) => {            // reactions from the other viewers
      const others = Math.max(0, count - (sent[k] || 0));
      sent[k] = 0;
      for (let i = 0; i < others && shown < 8; i++, shown++) setTimeout(() => floatEmoji(k), shown * 110);
    });
  }
  REACTIONS.forEach(([emoji, label], k) => {
    $('#reactions').append(el('button', { type: 'button', class: 'react', 'aria-label': T(label), title: T(label), onclick: () => {
      if (!link.ready) return;
      link.send({ t: 'react', k });
      sent[k]++; mine++;
      $('#likes').textContent = likeTotal + mine;
      floatEmoji(k);
    } }, emoji));
  });
  $('#shareBtn').onclick = async () => {
    const data = { title: document.title, text: $('#title').textContent, url: location.origin + '/' };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); chat.say(T('تنسخ الرابط. لصقو فين بغيتي.')); }
    } catch (e) { if (e && e.name !== 'AbortError') chat.say(data.url, 8000); }
  };

  // ------------------------------------------------- on stage (the guest) --
  const inviteDlg = $('#inviteDlg'), inviteErr = $('#inviteErr'), stageBar = $('#stageBar'), micBtn = $('#micBtn');
  let stage = null;   // { token, cam, pub, watch, voice }

  async function goOnStage(token) {
    const cam = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 }, facingMode: 'user' },
    });
    stage = { token, cam };
    try {
      const pub = new RTCPeerConnection();
      stage.pub = pub;
      pub.addTransceiver(cam.getAudioTracks()[0], { direction: 'sendonly', streams: [cam] });
      preferH264(pub.addTransceiver(cam.getVideoTracks()[0], { direction: 'sendonly', streams: [cam], sendEncodings: [{ maxBitrate: 900_000 }] }));
      await rtcNegotiate(pub, 'whip', 'guest', token);

      // Picture: the mixed broadcast. Sound: the host's microphone only,
      // so the guest never hears their own voice coming back.
      stage.watch = await rtcWatch('studio', token);
      stage.voice = await rtcWatch('backstage', token, { video: false });
    } catch (e) { leaveStage(false); throw e; }

    onStage = true;
    stopHls();
    const mixed = new MediaStream([...stage.watch.stream.getVideoTracks(), ...stage.voice.stream.getAudioTracks()]);
    video.srcObject = mixed; video.muted = false;
    video.play().catch(() => {});
    unmute.hidden = true; stageBar.hidden = false; handBtn.hidden = true;
    micBtn.textContent = T('سد الميكرو');
    lockLang(true);
    link.send({ t: 'onstage' });
    stage.pub.onconnectionstatechange = () => {
      if (stage && ['failed', 'closed'].includes(stage.pub.connectionState)) { leaveStage(true); chat.say(T('تقطع الاتصال ديالك بالمنصة.')); }
    };
  }
  function leaveStage(tellServer) {
    if (!stage) return;
    const s = stage; stage = null;
    s.cam.getTracks().forEach((t) => t.stop());
    if (s.pub) rtcClose(s.pub, 'whip', 'guest', s.token);
    if (s.watch) rtcClose(s.watch.pc, 'whep', 'studio', s.token);
    if (s.voice) rtcClose(s.voice.pc, 'whep', 'backstage', s.token);
    if (tellServer) link.send({ t: 'leave' });
    onStage = false;
    lockLang(false);
    video.srcObject = null;
    stageBar.hidden = true;
    handBtn.hidden = !live;
    setHand(false);
    if (live) startHls();
  }
  micBtn.onclick = () => {
    const t = stage && stage.cam.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    micBtn.textContent = T(t.enabled ? 'سد الميكرو' : 'حل الميكرو');
  };
  $('#leaveBtn').onclick = () => leaveStage(true);

  // ---------------------------------------------------------------- link --
  link.on('init', (d) => {
    setLive(d.live);
    $('#viewers').textContent = d.viewers;
    likeTotal = d.likes || 0; mine = 0; $('#likes').textContent = likeTotal;
    if (d.title) $('#title').textContent = d.title;
    showGuest(d.guest); setHand(!!d.hand);
    if (onStage && !(d.guest && d.guest.uid === link.uid)) leaveStage(false);
  })
    .on('live', (d) => setLive(d.on))
    .on('viewers', (d) => { $('#viewers').textContent = d.n; })
    .on('likes', (d) => showLikes(d.n, d.r))
    .on('title', (d) => { $('#title').textContent = d.text || cfg.title; })
    .on('guest', (d) => showGuest(d.guest))
    .on('hand', (d) => { setHand(d.on); if (d.on) chat.say(T('وصل الطلب ديالك. تسنى صاحب اللايف يقبلو.'), 6000); })
    .on('invite', (d) => {
      setHand(false);
      inviteErr.hidden = true;
      $('#inviteYes').disabled = false;
      $('#inviteYes').onclick = async () => {
        $('#inviteYes').disabled = true;
        try { await goOnStage(d.token); inviteDlg.close(); }
        catch (e) {
          $('#inviteYes').disabled = false;
          inviteErr.hidden = false;
          inviteErr.textContent = e && e.name === 'NotAllowedError'
            ? T('خاصك تسمح للمتصفح باستعمال الكاميرا والميكرو، ومن بعد عاود.')
            : T('ما قدرناش نطلعوك للمنصة. تأكد من الكاميرا والأنترنيت وعاود.');
        }
      };
      $('#inviteNo').onclick = () => { inviteDlg.close(); link.send({ t: 'leave' }); };
      inviteDlg.oncancel = () => link.send({ t: 'leave' });
      inviteDlg.showModal();
    })
    .on('kick', (d) => {
      if (inviteDlg.open) inviteDlg.close();
      const was = onStage;
      leaveStage(false);
      if (was && d.reason !== 'left') chat.say(T(d.reason === 'ended' ? 'سالا اللايف.' : 'صاحب اللايف نزلك من المنصة.'), 6000);
    });

  addEventListener('pagehide', () => leaveStage(true));
})();
