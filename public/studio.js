// REGAM Live - studio: camera + screen share + guest, mixed into one broadcast.
'use strict';
(function () {
  const TOKEN_KEY = 'regam.studio';
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  const status = (t) => { $('#status').textContent = t; };
  // A fault in the page itself is shown on the page (with where it happened), so it can be reported from a phone.
  const fault = (what) => { const box = $('#fault'); box.hidden = false; box.textContent = (box.textContent ? box.textContent + '\n' : '') + what; };
  addEventListener('error', (e) => fault(`[page] ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => fault(`[page] ${String((e.reason && (e.reason.message || e.reason.name)) || e.reason).slice(0, 160)}`));

  // --------------------------------------------------------------- login --
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: $('#lg').value.trim(), password: $('#pw').value }) });
    if (!r.ok) {
      $('#loginErr').hidden = false;
      $('#loginErr').textContent = T(r.status === 429 ? 'محاولات بزاف. تسنى ربع ساعة وعاود.' : 'اسم الدخول ولا كلمة السر غالطين.');
      return;
    }
    token = (await r.json()).token;
    sessionStorage.setItem(TOKEN_KEY, token);
    start();
  };
  if (token) start();

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  async function start() {
    // who am I, and which rooms may I broadcast in?
    const meRes = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!meRes.ok) return logout();
    const me = await meRes.json();
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#logoutBtn').onclick = logout;
    $('#adminLink').hidden = me.user.role !== 'admin';
    fetch('/api/site').then((r) => r.json()).then((site) => { $('#setupNote').hidden = me.user.role !== 'admin' || site.accounts; $('#build').textContent = 'v ' + site.build + ' UTC · ' + (('MediaStreamTrackProcessor' in window) ? 'A' : 'B'); }).catch(() => {});
    if (!me.rooms.length) {
      status(T('ما عندك حتى قاعة. طلب من المدير يعطيك قاعة.'));
      $('#goBtn').disabled = true;
      return;
    }
    const wanted = new URLSearchParams(location.search).get('room');
    const mine = me.rooms.find((r) => r.slug === wanted) || me.rooms[0];
    window.REGAM_ROOM = mine.slug;
    const cfg = await fetch('/api/config?room=' + mine.slug).then((r) => r.json());
    const viewerUrl = location.origin + (cfg.rooms === 1 && !cfg.accounts ? '/' : '/r/' + mine.slug);
    $('#roomName').textContent = mine.title;
    $('#roomLink').textContent = viewerUrl.replace(/^https?:\/\//, ''); $('#roomLink').href = viewerUrl;
    $('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(viewerUrl); status(T('تنسخ الرابط. لصقو فين بغيتي.')); } catch { status(viewerUrl); } };
    if (me.rooms.length > 1) {
      $('#roomSel').hidden = false; $('#roomName').hidden = true;
      $('#roomSel').replaceChildren(...me.rooms.map((r) => el('option', { value: r.slug, selected: r.slug === mine.slug }, r.title)));
      $('#roomSel').onchange = () => { location.search = '?room=' + $('#roomSel').value; };
    }
    const recUrl = (extra = '') => `/api/recordings?room=${mine.slug}${extra}`;
    const link = createLink({ token, room: mine.slug });
    mountChat($('#chat'), link);
    mountWho(link);
    mountReactions($('#reactions'), $('#hearts'), link, { totalEl: $('#likes') });

    // --------------------------------------------------------- the mixer --
    // Computers (Chrome, Edge): the picture is mixed in a worker, which keeps going while
    // another window is in front (needed for screen sharing). Phones, tablets and Safari:
    // a simple mixer on the page itself, which works as long as the page stays on screen.
    const fast = 'MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window && new URLSearchParams(location.search).get('mixer') !== 'simple';
    const simple = !fast && !!HTMLCanvasElement.prototype.captureStream && !!window.RTCPeerConnection;
    if (!fast && !simple) {
      status(T('هاد المتصفح ما كيقدرش يبث. جرب Chrome ولا Safari محدث.'));
      $('#goBtn').disabled = true;
      return;
    }
    let worker, mixed, setInput, replaySources = () => {};
    if (fast) {
      worker = new Worker('/compositor.worker.js');
      mixed = new MediaStreamTrackGenerator({ kind: 'video' });
      worker.postMessage({ type: 'init', writable: mixed.writable, brand: cfg.title }, [mixed.writable]);
      setInput = (name, track) => {
        if (!track) return worker.postMessage({ type: 'remove', name });
        const proc = new MediaStreamTrackProcessor({ track, maxBufferSize: 2 });
        worker.postMessage({ type: 'input', name, readable: proc.readable }, [proc.readable]);
      };
    } else {
      const cv = el('canvas', { width: 1280, height: 720 });
      const painter = createPainter(cv, { brand: cfg.title, fixed: true });
      const holder = el('div', { class: 'mix-sources', 'aria-hidden': 'true' });
      document.body.append(holder);
      const vids = {};
      setInput = (name, track) => {
        if (vids[name]) { vids[name].srcObject = null; vids[name].remove(); delete vids[name]; }
        if (!track) return;
        const v = el('video', { playsinline: '', 'webkit-playsinline': '', autoplay: '', muted: '' });
        v.muted = true; v.defaultMuted = true; v.srcObject = new MediaStream([track]);
        holder.append(v); v.play().catch(() => {});
        v.addEventListener('loadedmetadata', () => v.play().catch(() => {}));
        vids[name] = v;
      };
      // phones start a video only after a tap: every tap gives the sources another chance
      replaySources = () => { for (const v of Object.values(vids)) if (v.paused) v.play().catch(() => {}); };
      document.addEventListener('pointerdown', replaySources);
      worker = { postMessage(d) { if (d.type === 'guestName') painter.state.names[d.slot] = d.name || ''; else if (d.type === 'guestCam') painter.state.off[d.slot] = !d.on; else if (d.type === 'page') painter.state.page = d.n; } };
      const frameOf = (name) => { const v = vids[name]; return v && v.readyState >= 2 && v.videoWidth ? v : null; };
      painter.paint(frameOf);
      setInterval(() => painter.paint(frameOf), 40);
      mixed = cv.captureStream(25).getVideoTracks()[0];
      document.addEventListener('visibilitychange', () => { if (document.hidden && liveOn) status(T('خلي هاد الصفحة مفتوحة قدامك: إلا خرجتي منها اللايف كيوقف.')); });
    }
    $('#screenBtn').hidden = !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);   // phones cannot share their screen from a web page
    $('#preview').srcObject = new MediaStream([mixed]);

    // ----------------------------------------------------------- sources --
    let camTrack = null, screenTrack = null, micTrack = null, micOn = true;
    let audioCtx = null, mixOut = null, micGain = null;
    let pc = null, liveOn = false;             // main broadcast
    let guests = [], maxGuests = 12;           // who the server says is on stage
    const onStage = new Map();                 // slot -> what we have set up for that guest
    const buses = {};                          // slot -> the sound mix sent to that guest

    const press = (btn, on) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');

    async function camOn() {
      try {
        const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 25 }, facingMode: 'user' };
        const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        let s;
        // Phones: camera and microphone are asked for together, in one go. Asking for the microphone
        // later, while the camera is already running, can freeze or cut the camera on iPhone.
        if (simple && !micTrack) { try { s = await navigator.mediaDevices.getUserMedia({ video, audio }); micTrack = s.getAudioTracks()[0] || null; } catch { s = null; } }
        if (!s) s = await navigator.mediaDevices.getUserMedia({ video });
        camTrack = s.getVideoTracks()[0];
        camTrack.onended = camOff;
        setInput('cam', camTrack);
        press($('#camBtn'), true);
      } catch { press($('#camBtn'), false); status(T('ما قدرناش نحلو الكاميرا. تأكد من الإذن فالمتصفح.')); }
    }
    function camOff() {
      if (camTrack) { camTrack.onended = null; camTrack.stop(); camTrack = null; }
      setInput('cam', null);
      press($('#camBtn'), false);
    }
    $('#camBtn').onclick = () => (camTrack ? camOff() : camOn());

    async function screenOn() {
      if (boardOn) boardOff();
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 25, max: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false });
        screenTrack = s.getVideoTracks()[0];
        screenTrack.onended = screenOff;       // "Stop sharing" in the browser bar
        setInput('screen', screenTrack);
        press($('#screenBtn'), true);
        $('#screenBtn').textContent = T('وقف مشاركة الشاشة');
        tune();
      } catch { /* the user cancelled the picker */ }
    }
    function screenOff() {
      if (screenTrack) { screenTrack.onended = null; screenTrack.stop(); screenTrack = null; }
      setInput('screen', null);
      press($('#screenBtn'), false);
      $('#screenBtn').textContent = T('شارك الشاشة');
      tune();
    }
    $('#screenBtn').onclick = () => (screenTrack ? screenOff() : screenOn());

    // -------------------------------------------------------- whiteboard --
    // The board takes the place of a shared screen in the mixer: full picture,
    // with the camera (and the guest) in small tiles over it.
    const board = createBoard($('#board'), $('#boardTyper'));
    let boardOn = false;
    function boardStart() {
      if (screenTrack) screenOff();
      boardOn = true;
      setInput('screen', board.start());
      $('#board').hidden = false; $('#boardBar').hidden = false; $('#boardCam').hidden = false;
      press($('#boardBtn'), true);
      $('#board').scrollIntoView({ block: 'nearest' });   // keep the whole board on screen
      tune();
    }
    function boardOff() {
      boardOn = false;
      if (boardVoice) boardVoice.stop();
      board.stop();
      setInput('screen', null);
      $('#board').hidden = true; $('#boardBar').hidden = true; $('#boardCam').hidden = true;
      press($('#boardBtn'), false);
      tune();
    }
    $('#boardBtn').onclick = () => (boardOn ? boardOff() : boardStart());
    const pick = (group, btn) => group.forEach((b) => press(b, b === btn));
    const toolBtns = [...document.querySelectorAll('#boardBar [data-tool]')];
    toolBtns.forEach((b) => { b.onclick = () => { board.setTool(b.dataset.tool); pick(toolBtns, b); }; });
    const colorBtns = [...document.querySelectorAll('#boardBar [data-color]')];
    colorBtns.forEach((b) => { b.onclick = () => { board.setColor(b.dataset.color); pick(colorBtns, b); }; });
    $('#boardSize').onchange = () => board.setSize(Number($('#boardSize').value));
    $('#boardUndo').onclick = () => board.undo();
    // speak, and the words are written on the board
    const boardVoice = makeDictation((fin, interim) => board.voice(fin, interim), (on) => { press($('#boardVoice'), on); board.voiceState(on); });
    $('#boardVoice').hidden = !boardVoice;
    $('#boardVoice').onclick = () => boardVoice && boardVoice.toggle();
    $('#boardClear').onclick = () => { if (confirm(T('تمسح السبورة كاملة؟'))) board.clear(); };

    async function ensureMic() {
      if (micTrack) return true;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micTrack = s.getAudioTracks()[0];
        return true;
      } catch { status(T('ما قدرناش نحلو الميكرو. تأكد من الإذن فالمتصفح.')); return false; }
    }
    $('#micBtn').onclick = () => {
      micOn = !micOn;
      if (micGain) micGain.gain.value = micOn ? 1 : 0;
      press($('#micBtn'), micOn);
    };

    // When the connection is weak, drop frames rather than sharpness: the audience
    // gets a fixed picture size, and text on a shared screen must stay readable.
    // With the whiteboard or a shared screen on, the picture has two pages: the board, and the people.
    let page = 0;
    function showPage(n) {
      const can = !!(screenTrack || boardOn) && guests.length > 0;
      page = can ? n : 0;
      worker.postMessage({ type: 'page', n: page });
      $('#pageBar').hidden = !can;
      press($('#pageBoard'), page === 0); press($('#pagePeople'), page === 1);
    }
    $('#pageBoard').onclick = () => showPage(0);
    $('#pagePeople').onclick = () => showPage(1);
    function tune() {
      showPage(page);
      mixed.contentHint = (screenTrack || boardOn) ? 'detail' : 'motion';
      const sender = pc && pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (!sender) return;
      const p = sender.getParameters();
      p.degradationPreference = 'maintain-resolution';
      sender.setParameters(p).catch(() => {});
    }

    // ----------------------------------------------------------- go live --
    async function goLive() {
      $('#goBtn').disabled = true;
      status(T('كنوجدو البث…'));
      let step = 'sound';                              // which part failed, shown with the error
      try {
        // iPhone: the sound engine must be created and started inside the tap itself, before anything is waited for
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const woke = audioCtx.resume().catch(() => {});
        replaySources();
        step = 'mic';
        if (!(await within(ensureMic(), 40000, 'mic'))) return;
        await Promise.race([woke, new Promise((r) => setTimeout(r, 1500))]);
        step = 'mix';
        if (!mixOut) {
          mixOut = audioCtx.createMediaStreamDestination();
          micGain = audioCtx.createGain();
          micGain.gain.value = micOn ? 1 : 0;
          audioCtx.createMediaStreamSource(new MediaStream([micTrack])).connect(micGain).connect(mixOut);
        }
        step = 'peer';
        pc = new RTCPeerConnection();
        pc.addTransceiver(mixOut.stream.getAudioTracks()[0], { direction: 'sendonly' });
        preferH264(pc.addTransceiver(mixed, { direction: 'sendonly', sendEncodings: [{ maxBitrate: 4_500_000, maxFramerate: 25 }] }));
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'connected') status(T('نتا على الهواء. المتابعين كيشوفوك بتأخير ديال بضع ثواني.'));
          if (pc.connectionState === 'failed') { stopLive(); status(T('تقطع الاتصال بالسيرفر. تأكد من الأنترنيت وعاود بدا اللايف.')); }
        };
        step = 'server';
        await within(rtcNegotiate(pc, 'whip', 'studio', token), 20000, 'server');
        liveOn = true;
        try { tune(); } catch { /* a hint the browser does not know: the live goes on without it */ }
        $('#goBtn').textContent = T('وقف اللايف');
        lockLang(true); $('#roomSel').disabled = true;
        $('#goBtn').classList.add('danger');
        $('#onAir').hidden = false;
        status(T('كنتصلو…'));
        // a live that never connects is told so, with what the connection reported
        const mine = pc;
        setTimeout(() => { if (pc === mine && liveOn && mine.connectionState !== 'connected') status(T('اللايف ما قدرش يتصل بالسيرفر.') + ` [link: ${mine.connectionState}/${mine.iceConnectionState}]`); }, 15000);
        syncGuests();
      } catch (e) {
        if (pc) { pc.close(); pc = null; }
        status(T(e && e.status === 401 ? 'سالات الجلسة. عاود دخل.' : step === 'server' ? 'ما قدرناش نبداو اللايف. السيرفر ديال البث ما كيجاوبش.' : 'ما قدرناش نبداو اللايف من هاد الجهاز.')
          + ` [${step}${e && e.status ? ' ' + e.status : ''}: ${String((e && (e.name || e.message)) || e).slice(0, 60)}]`);
        if (e && e.status === 401) logout();
      } finally { $('#goBtn').disabled = false; }
    }
    function stopLive() {
      if (guests.length) link.send({ t: 'unstage' });
      for (const slot of [...onStage.keys()]) dropGuest(slot);
      if (pc) { rtcClose(pc, 'whip', 'studio', token); pc = null; }
      liveOn = false;
      $('#goBtn').textContent = T('ابدأ اللايف');
      lockLang(false); $('#roomSel').disabled = false;
      $('#goBtn').classList.remove('danger');
      $('#onAir').hidden = true;
      status(T('وقف اللايف.'));
    }
    $('#goBtn').onclick = () => (liveOn ? stopLive() : goLive());

    // ------------------------------------------------------------ guests --
    // Up to twelve guests. For each one:
    //  1) we publish a sound mix made for them on "backstage<n>": our voice and the
    //     other guests, without their own voice, so they hear everybody but no echo
    //  2) once they publish, we pull their camera + voice and add both to the broadcast
    function busFor(slot) {
      if (!buses[slot]) {
        const gain = audioCtx.createGain(), dest = audioCtx.createMediaStreamDestination();
        gain.connect(dest);
        micGain.connect(gain);
        for (const [other, st] of onStage) if (other !== slot && st.node) st.node.connect(gain);
        buses[slot] = { gain, dest };
      }
      return buses[slot];
    }
    function dropGuest(slot) {
      const st = onStage.get(slot);
      if (!st) return;
      onStage.delete(slot);
      setInput('guest' + slot, null);
      worker.postMessage({ type: 'guestName', slot, name: '' });
      if (st.node) st.node.disconnect();
      if (st.sink) { st.sink.pause(); st.sink.srcObject = null; }
      if (st.rx) rtcClose(st.rx.pc, 'whep', 'guest' + slot, token);
      if (st.back) rtcClose(st.back, 'whip', 'backstage' + slot, token);
    }
    // Bring our side in line with who is on stage. Several changes can arrive while one
    // is being handled (a guest is accepted, then becomes ready a second later), so a
    // run that is asked for during another one is done right after it, on fresh data.
    let syncing = false, syncAgain = false;
    async function syncGuests() {
      if (syncing) { syncAgain = true; return; }
      syncing = true;
      try { do { syncAgain = false; await syncOnce(); } while (syncAgain); } finally { syncing = false; }
    }
    async function syncOnce() {
      for (const slot of [...onStage.keys()]) {                       // left, or replaced by someone else
        const g = guests.find((x) => x.slot === slot);
        if (!g || g.uid !== onStage.get(slot).uid) dropGuest(slot);
      }
      if (!liveOn) return;
      for (const slot of guests.map((x) => x.slot)) {
        const now = () => guests.find((x) => x.slot === slot);        // the guest as the server sees them at this moment
        let g = now();
        if (!g) continue;
        let st = onStage.get(slot);
        if (!st) { st = { uid: g.uid, rx: null, node: null, sink: null, back: null }; onStage.set(slot, st); }
        try {
          if (!st.back) {
            const bpc = new RTCPeerConnection();
            st.back = bpc;
            bpc.addTransceiver(busFor(slot).dest.stream.getAudioTracks()[0], { direction: 'sendonly' });
            await rtcNegotiate(bpc, 'whip', 'backstage' + slot, token);
          }
          g = now();
          if (g && g.uid === st.uid && g.ready && !st.rx && onStage.get(slot) === st) {
            const rx = await rtcWatch('guest' + slot, token);
            if (onStage.get(slot) !== st || !liveOn) { rtcClose(rx.pc, 'whep', 'guest' + slot, token); continue; }
            st.rx = rx;
            const attach = () => {
              const v = rx.stream.getVideoTracks()[0], a = rx.stream.getAudioTracks()[0];
              if (v) setInput('guest' + slot, v);
              if (a && !st.node) {
                st.audio = a; a.enabled = !((now() || {}).muted);
                st.sink = new Audio(); st.sink.autoplay = true;          // so we hear the guest
                st.sink.srcObject = new MediaStream([a]); st.sink.play().catch(() => {});
                st.node = audioCtx.createMediaStreamSource(new MediaStream([a]));
                st.node.connect(mixOut);                                  // the audience hears the guest
                for (const [other, bus] of Object.entries(buses)) if (Number(other) !== slot) st.node.connect(bus.gain);   // and so do the other guests
              }
            };
            attach();
            rx.pc.addEventListener('track', () => setTimeout(attach, 0));
            status(T('{name} طلع معاك للمنصة. استعمل السماعات باش ما يكونش الصدى.', { name: g.name }));
          }
        } catch (e) {
          // leave this guest's set-up clean so the next change (or the next try) starts again
          if (st.back && st.back.connectionState !== 'connected') { rtcClose(st.back, 'whip', 'backstage' + slot, token); st.back = null; }
          // a connection that fails once is tried again by itself a few times before the host is told
          st.fails = (st.fails || 0) + 1;
          if (st.fails <= 8) setTimeout(syncGuests, 1500);
          else status(T('ما قدرناش نربطو الضيف. نزلو وعاود قبل الطلب ديالو.') + ` (${slot}: ${(e && (e.status || e.message)) || '?'})`);
        }
      }
    }
    function showGuests(list) {
      guests = list || [];
      $('#noGuests').hidden = guests.length > 0;
      $('#onStage').replaceChildren(...guests.map((g) => el('li', { class: 'guest-box' },
        el('span', {}, T(g.ready ? '{name} على المنصة' : 'كنتسناو {name} يدخل…', { name: g.name }) + (g.muted ? ' 🔇' : '') + (g.cam === false ? ' · ' + T('بلا كاميرا') : '')),
        el('span', { class: 'guest-acts' },
          el('button', { class: 'btn', type: 'button', onclick: () => link.send({ t: 'mute', uid: g.uid, on: !g.muted }) }, T(g.muted ? 'حل ليه الميكرو' : 'سد ليه الميكرو')),
          el('button', { class: 'btn danger', type: 'button', onclick: () => link.send({ t: 'unstage', uid: g.uid }) }, T('نزلو من المنصة'))))));
      showPage(page);
      $('#muteAll').hidden = guests.length < 2;
      $('#muteAll').textContent = T(guests.every((g) => g.muted) ? 'حل الميكرو للجميع' : 'سد الميكرو للجميع');
      $('#muteAll').onclick = () => link.send({ t: 'mute', on: !guests.every((g) => g.muted) });
      for (const g of guests) {
        worker.postMessage({ type: 'guestName', slot: g.slot, name: g.name });
        worker.postMessage({ type: 'guestCam', slot: g.slot, on: g.cam !== false });
        const st = onStage.get(g.slot);                       // a closed microphone is cut here too, whatever the guest's page does
        if (st && st.uid === g.uid && st.audio) st.audio.enabled = !g.muted;
      }
      syncGuests();
    }

    // ---- live translation: the host's speech is written down by the browser, translated on this
    // computer (Chrome's built-in translator), and sent to the viewers as text.
    const CAP_LANGS = ['ar', 'fr', 'en'], SPEECH = { ar: 'ar-MA', fr: 'fr-FR', en: 'en-US' };
    const SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    let capOn = false, capRec = null, capSrc = 'ar', translators = {}, capQueue = Promise.resolve();
    $('#capLang').value = CAP_LANGS.includes(LANG) ? LANG : 'ar';
    const capNote = (t) => { $('#capNote').textContent = t; };
    if (!SRec) { $('#capBtn').disabled = true; capNote(T('هاد المتصفح ما كيعرفش يكتب الهضرة. استعمل Google Chrome فالحاسوب.')); }
    async function capTranslators(src) {              // one translator per other language; the models download the first time
      translators = {};
      if (!('Translator' in self)) return false;
      let ok = true;
      for (const to of CAP_LANGS.filter((l) => l !== src)) {
        try {
          translators[to] = await Translator.create({ sourceLanguage: src, targetLanguage: to, monitor(m) { m.addEventListener('downloadprogress', (e) => capNote(T('كنحملو الترجمة ({lang}): {n}%', { lang: to, n: Math.round(e.loaded * 100) }))); } });
        } catch { ok = false; }
      }
      return ok;
    }
    function capSay(text) {                           // translate, then send; one sentence after the other
      capQueue = capQueue.then(async () => {
        const tx = { [capSrc]: text };
        for (const [to, tr] of Object.entries(translators)) { try { tx[to] = await tr.translate(text); } catch { /* that language is skipped */ } }
        link.send({ t: 'cap', src: capSrc, tx });
      });
    }
    function capListen() {
      capRec = new SRec();
      capRec.lang = SPEECH[capSrc]; capRec.continuous = true; capRec.interimResults = true;
      capRec.onresult = (e) => {
        let hearing = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.trim();
          if (e.results[i].isFinal) { if (t) capSay(t); } else hearing += t + ' ';
        }
        if (hearing) $('#capLast').textContent = '… ' + hearing;      // what is being heard right now
      };
      capRec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { capStop(); capNote(T('خاصك تسمح للمتصفح باستعمال الميكرو باش تخدم الترجمة.')); } };
      capRec.onend = () => { if (capOn) setTimeout(() => { if (capOn) { try { capListen(); } catch { /* tried again at the next pause */ } } }, 400); };   // the browser stops after a silence
      capRec.start();
    }
    function capStop() {
      capOn = false; press($('#capBtn'), false); $('#capBtn').textContent = T('شغل الترجمة'); $('#capLang').disabled = false;
      if (capRec) { try { capRec.stop(); } catch { /* already stopped */ } }
    }
    $('#capBtn').onclick = async () => {
      if (capOn) { capStop(); capNote(''); return; }
      capSrc = $('#capLang').value;
      capOn = true; press($('#capBtn'), true); $('#capBtn').textContent = T('وقف الترجمة'); $('#capLang').disabled = true;
      capNote(T('كنسمعك. هضر عادي، جملة بجملة، ووقف شوية بين الجمل.'));
      capTranslators(capSrc);                       // the browser's own translator helps when it has one; the server translates anyway
      try { capListen(); } catch { capStop(); capNote(T('ما قدرناش نشغلو الترجمة. عاود جرب.')); }
    };
    // what went out, in the three languages, so the host sees that it works
    link.on('capinfo', (d) => {
      const got = CAP_LANGS.filter((l) => d.tx[l]);
      $('#capLast').textContent = got.map((l) => `${l.toUpperCase()}: ${d.tx[l]}`).join('   ·   ');
      if (capOn) capNote(T(got.length === 3 ? 'الترجمة خدامة: الناس كيقراو ويسمعو باللغة ديالهم.' : 'الهضرة ديالك كتكتب، ولكن الترجمة مازال ما واجداش فالسيرفر. إلا عاد دابا درتي التحديث، تسنى شي دقايق وعاود جرب.'));
    });
    window.__cap = { say: (text, src) => { capSrc = src || capSrc; capSay(text); }, send: (src, tx) => link.send({ t: 'cap', src, tx }) };     // for diagnostics

    // ---- calendar and invitations: sessions planned ahead, an entry code, and a text to send for each
    let roomCode = '', sessions = [], picked = '';        // picked: the session the invitation is about
    const pad = (n) => String(n).padStart(2, '0');
    const loc = () => (LANG === 'ar' ? 'ar-MA' : LANG);
    const whenOf = (s) => new Date(s.at).toLocaleString(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      + (s.end ? ' – ' + new Date(s.end).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : '');
    function showInvite() {
      $('#codeChk').checked = !!roomCode;
      $('#codeShow').hidden = !roomCode;
      $('#codeShow').textContent = roomCode ? roomCode.slice(0, 3) + ' ' + roomCode.slice(3) : '';
      const s = sessions.find((x) => x.id === picked) || sessions[0] || null;
      $('#sessNote').hidden = sessions.length > 0;
      $('#sessList').replaceChildren(...sessions.map((x) => el('li', { class: s && x.id === s.id ? 'picked' : '' },
        el('span', {}, el('strong', {}, whenOf(x)), x.title ? ' · ' + x.title : ''),
        el('span', { class: 'guest-acts' },
          el('button', { class: 'btn', type: 'button', onclick: () => { picked = x.id; showInvite(); } }, T('الدعوة')),
          el('button', { class: 'btn danger', type: 'button', onclick: () => link.send({ t: 'session', del: x.id }) }, T('حذف'))))));
      $('#inviteHead').textContent = T('الدعوة') + (s ? ' : ' + whenOf(s) : '');
      $('#inviteText').value = [
        T('دعوة للايف: {room}', { room: mine.title }) + (s && s.title ? ' - ' + s.title : ''),
        s ? T('الوقت: {when}', { when: whenOf(s) }) : '',
        T('الرابط: {url}', { url: viewerUrl + (roomCode ? '?code=' + roomCode : '') }),
        roomCode ? T('كود الدخول: {code}', { code: roomCode.slice(0, 3) + ' ' + roomCode.slice(3) }) : '',
        cfg.access === 'watch' ? T('خاصك تسجل بالإيميل ديالك فالموقع قبل ما تدخل.') : '',
        s ? T('زيدو للأجندة ديالك: {url}', { url: `${location.origin}/api/ics?room=${encodeURIComponent(mine.slug)}&id=${s.id}` }) : '',
      ].filter(Boolean).join('\n');
    }
    $('#codeChk').onchange = () => link.send({ t: 'code', on: $('#codeChk').checked });
    $('#nextSave').onclick = () => {
      const v = $('#nextAt').value, e = $('#nextEnd').value;
      if (!v) return status(T('اختار النهار والساعة ديال البداية.'));
      const at = new Date(v).getTime();
      let end = 0;
      if (e) { end = new Date(v.slice(0, 11) + e).getTime(); if (end <= at) end += 24 * 3600e3; }       // an end before the start means past midnight
      link.send({ t: 'session', at, end, title: $('#nextTitle').value });
    };
    $('#inviteCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteText').value); status(T('تنسخات الدعوة. لصقها فواتساب ولا فالإيميل.')); } catch { $('#inviteText').select(); } };
    link.on('code', (d) => { roomCode = d.code || ''; showInvite(); })
      .on('sessions', (d) => {
        if (d.err) return status(T('الوقت ما مقبولش. اختار وقت جاي، والنهاية من بعد البداية.'));
        if (d.list.length > sessions.length) { picked = d.list.find((x) => !sessions.some((y) => y.id === x.id)).id; $('#nextAt').value = ''; $('#nextEnd').value = ''; $('#nextTitle').value = ''; }
        sessions = d.list; showInvite();
      });

    // ---- assistants: members who help the host run the room
    function showHelpers(list, err) {
      $('#helperList').replaceChildren(...list.map((h) => el('li', {},
        el('span', {}, h.name + ' ', el('span', { class: 'muted', dir: 'ltr' }, h.email)),
        el('button', { class: 'btn danger', type: 'button', onclick: () => link.send({ t: 'helper', id: h.id, on: false }) }, T('حيد')))));
      $('#helperNote').textContent = err ? T('ما لقيناش حساب مفعل بهاد الإيميل. خاص هاد الشخص يسجل فالموقع أولا.') : '';
      if (!err) $('#helperEmail').value = '';
    }
    $('#helperForm').onsubmit = (e) => { e.preventDefault(); link.send({ t: 'helper', email: $('#helperEmail').value.trim(), on: true }); };
    link.on('helpers', (d) => showHelpers(d.list, d.err));

    // ---- requests the host must answer are shown in a bar across the top of the screen, with a chime:
    // people waiting to come in, and people asking to come up on stage
    let doorList = [], handList = [];
    function chime() {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880; g.gain.setValueAtTime(0.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
        o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.6); o.onended = () => ac.close();
      } catch { /* no sound, the bar is enough */ }
    }
    function paintBar() {
      const bar = $('#waitBar');
      bar.hidden = doorList.length + handList.length === 0;
      const group = (list, title, yes, no, all) => (list.length ? [el('span', { class: 'wait-group' },
        el('strong', {}, title),
        ...list.slice(0, 4).map((w) => el('span', { class: 'wait-one' }, list.length > 1 ? el('span', {}, w.name) : null,
          el('button', { class: 'btn primary small', type: 'button', onclick: () => yes(w) }, T('قبول')),
          no ? el('button', { class: 'btn small', type: 'button', onclick: () => no(w) }, T('رفض')) : null)),
        all && list.length > 1 ? el('button', { class: 'btn primary small', type: 'button', onclick: all }, T('دخل الجميع')) : null)] : []);
      bar.replaceChildren(
        ...group(doorList, T(doorList.length === 1 ? '{name} كيتسنى يدخل' : '{n} ناس كيتسناو يدخلو', { name: doorList[0] ? doorList[0].name : '', n: doorList.length }),
          (w) => link.send({ t: 'admit', uid: w.uid, ok: true }), (w) => link.send({ t: 'admit', uid: w.uid, ok: false }), () => link.send({ t: 'admit' })),
        ...group(handList, T(handList.length === 1 ? '{name} بغا يطلع للمنصة' : '{n} ناس بغاو يطلعو للمنصة', { name: handList[0] ? handList[0].name : '', n: handList.length }),
          (h) => acceptHand(h), null, null));
    }

    // ---- waiting room: people give their name and wait for the host to let them in
    let waitingN = 0;
    function showWaiting(gate, list) {
      $('#gateChk').checked = gate;
      $('#noWaiting').hidden = !gate || list.length > 0;
      $('#admitAll').hidden = list.length < 2;
      $('#waiting').replaceChildren(...list.map((w) => el('li', {},
        el('span', {}, w.name),
        el('span', { class: 'guest-acts' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => link.send({ t: 'admit', uid: w.uid, ok: true }) }, T('دخلو')),
          el('button', { class: 'btn danger', type: 'button', onclick: () => link.send({ t: 'admit', uid: w.uid, ok: false }) }, T('رفض'))))));
      doorList = list; paintBar();
      if (list.length > waitingN) {
        status(T('{name} كيتسنى فقاعة الانتظار.', { name: list[list.length - 1].name }));
        chime();
      }
      waitingN = list.length;
    }
    $('#gateChk').onchange = () => link.send({ t: 'gate', on: $('#gateChk').checked });
    $('#admitAll').onclick = () => link.send({ t: 'admit' });

    // ---- the sound people hear while the room is not live
    function showSound(url) {
      $('#soundDel').hidden = !url;
      $('#soundDefault').hidden = !!url;
      $('#soundTry').hidden = !url;
      if (url) $('#soundTry').src = url; else $('#soundTry').removeAttribute('src');
    }
    const roomQ = 'room=' + encodeURIComponent(window.REGAM_ROOM || '');
    fetch('/api/config?' + roomQ).then((r) => r.json()).then((c) => { showSound(c.sound); showPics(c.pics || []); }).catch(() => {});
    $('#soundDefault').onclick = async () => {
      const r = await fetch('/api/sound?default=1&' + roomQ, { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
      if (r && r.ok) { showSound((await r.json()).sound); $('#soundNote').textContent = T('رجعات تلاوة سورة الرحمن.'); }
    };
    // ---- the pictures people see while the room is not live
    function showPics(list) {
      $('#picList').replaceChildren(...list.map((p) => {
        const li = el('li', {}, el('button', { type: 'button', 'aria-label': T('حذف'), title: T('حذف'), onclick: async () => {
          const r = await fetch(`/api/pics?id=${p.id}&` + roomQ, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => null);
          if (r && r.ok) showPics((await r.json()).pics);
        } }, '✕'));
        li.style.backgroundImage = `url("${p.url}")`;
        return li;
      }));
    }
    $('#picFile').onchange = async () => {
      const note = $('#picNote');
      let bad = 0, last = null;
      for (const f of [...$('#picFile').files]) {
        note.textContent = T('كنصيفطو الملف…');
        const r = await fetch('/api/pics?' + roomQ, { method: 'POST', headers: { 'Content-Type': f.type, Authorization: 'Bearer ' + token }, body: f }).catch(() => null);
        if (r && r.ok) last = (await r.json()).pics; else bad++;
      }
      if (last) showPics(last);
      note.textContent = T(bad ? 'شي صور ما تسجلوش: خاصها تكون JPG ولا PNG ولا WebP، أقل من 8 ميغا، وحتى ل 12 صورة.' : 'تسجلو الصور. الناس غادي يشوفوهم ملي ما يكونش لايف.');
      $('#picFile').value = '';
    };
    $('#soundFile').onchange = async () => {
      const f = $('#soundFile').files[0];
      if (!f) return;
      const note = $('#soundNote');
      if (f.size > 60 * 1024 * 1024) { note.textContent = T('الملف كبير بزاف. الحد هو 60 ميغا.'); return; }
      note.textContent = T('كنصيفطو الملف…');
      try {
        const type = f.type || (/\.m4a$/i.test(f.name) ? 'audio/mp4' : 'audio/mpeg');
        const r = await fetch('/api/sound?room=' + encodeURIComponent(window.REGAM_ROOM || ''), { method: 'POST', headers: { 'Content-Type': type, Authorization: 'Bearer ' + token }, body: f });
        if (!r.ok) throw new Error(r.status);
        showSound((await r.json()).sound);
        note.textContent = T('تسجل الصوت. الناس غادي يسمعوه ملي ما يكونش لايف.');
      } catch { note.textContent = T('ما قدرناش نسجلو الملف. خاصو يكون MP3 أو M4A.'); }
      $('#soundFile').value = '';
    };
    $('#soundDel').onclick = async () => {
      await fetch('/api/sound?room=' + encodeURIComponent(window.REGAM_ROOM || ''), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
      showSound(''); $('#soundNote').textContent = T('تحيد الصوت.');
    };

    function acceptHand(h) {
      if (!liveOn) return status(T('بدا اللايف أولا، عاد قبل الطلبات.'));
      if (guests.length >= maxGuests) return status(T('المنصة عامرة. نزل شي واحد أولا.'));
      link.send({ t: 'stage', uid: h.uid });
    }
    function showHands(list) {
      $('#noHands').hidden = list.length > 0;
      $('#hands').replaceChildren(...list.map((h) => el('li', {},
        el('span', {}, h.name),
        el('button', { class: 'btn primary', type: 'button', onclick: () => acceptHand(h) }, T('قبول')))));
      if (list.length > handList.length) chime();
      handList = list; paintBar();
    }

    // ---------------------------------------------------------- settings --
    $('#titleForm').onsubmit = (e) => { e.preventDefault(); link.send({ t: 'title', text: $('#titleInput').value }); };
    $('#pinForm').onsubmit = (e) => { e.preventDefault(); link.send({ t: 'pin', text: $('#pinInput').value }); };
    $('#slowSel').onchange = () => link.send({ t: 'slow', sec: Number($('#slowSel').value) });

    link.on('init', (d) => {
      if (!d.mod) return logout();            // token expired
      $('#viewers').textContent = d.viewers;
      $('#titleInput').value = d.title || '';
      $('#pinInput').value = d.pinned || '';
      $('#slowSel').value = String(d.slow);
      maxGuests = d.maxGuests || 12;
      setBadge(d.live); showHands(d.hands || []); showGuests(d.guests);
      showWaiting(!!d.gate, d.waiting || []);
      recOn = !!d.rec; showRec();
      roomCode = d.code || ''; sessions = d.sessions || []; showInvite();
      showHelpers(d.helpers || []);
    })
      .on('waiting', (d) => showWaiting(d.gate, d.list))
      .on('live', (d) => setBadge(d.on))
      .on('viewers', (d) => { $('#viewers').textContent = d.n; })
      .on('hands', (d) => showHands(d.list))
      .on('guests', (d) => showGuests(d.guests))
      .on('err', (d) => {
        if (d.code === 'stagefull') status(T('المنصة عامرة. نزل شي واحد أولا.'));
        if (d.code === 'onstage') status(T('هاد الشخص راه على المنصة.'));
      })
      .on('slow', (d) => { $('#slowSel').value = String(d.sec); });
    // -------------------------------------------------------- recordings --
    const fmtSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB');
    const fmtName = (n) => { const m = n.match(/^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)/); return m ? `${m[3]}/${m[2]}/${m[1]} · ${m[4]}:${m[5]}` : n; };
    async function loadRecs() {
      let data;
      try {
        const r = await fetch(recUrl(), { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return;
        data = await r.json();
      } catch { return; }
      $('#noRecs').hidden = data.list.length > 0;
      $('#recs').replaceChildren(...data.list.map((f, i) => {
        const busy = data.live && i === 0;            // still being written
        return el('li', {},
          el('span', { dir: 'ltr' }, `${fmtName(f.name)} · ${fmtSize(f.size)}`),
          busy ? el('span', { class: 'muted' }, T('كيتسجل دابا…')) : el('span', { class: 'rec-actions' },
            el('a', { class: 'btn primary', href: recUrl(`&name=${encodeURIComponent(f.name)}&token=${encodeURIComponent(token)}`), download: '' }, T('تحميل')),
            el('button', { class: 'btn', type: 'button', onclick: async () => {
              if (!confirm(T('تحذف هاد التسجيل نهائيا؟'))) return;
              await fetch(recUrl(`&name=${encodeURIComponent(f.name)}`), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
              loadRecs();
            } }, T('حذف'))));
      }));
    }
    loadRecs();
    link.on('live', () => setTimeout(loadRecs, 3000));

    // ---- recording: only when the host asks for it, and only while live
    let recOn = false, airOn = false;
    function showRec() {
      const b = $('#recBtn');
      b.disabled = !airOn;
      press(b, recOn);
      b.classList.toggle('rec-on', recOn);
      b.textContent = T(recOn ? '⏹ وقف التسجيل' : '⏺ سجل اللايف');
    }
    $('#recBtn').onclick = () => link.send({ t: 'rec', on: !recOn });
    link.on('rec', (d) => {
      const was = recOn; recOn = !!d.on; showRec();
      if (d.err) status(T(d.err === 'offline' ? 'بدا اللايف أولا، عاد سجل.' : 'ما قدرناش نبداو التسجيل. عاود جرب.'));
      else if (recOn !== was) status(T(recOn ? 'التسجيل بدا. غادي تلقاه فالتسجيلات ملي توقفو.' : 'وقف التسجيل. راه فالتسجيلات.'));
      if (was && !recOn && typeof loadRecs === 'function') setTimeout(loadRecs, 1500);
    });
    function setBadge(on) {
      $('#liveBadge').textContent = T(on ? 'مباشر' : 'غير مباشر');
      $('#liveBadge').className = 'badge ' + (on ? 'on' : 'off');
      airOn = on; if (!on) recOn = false;
      showRec();
    }

    addEventListener('pagehide', () => { if (liveOn) stopLive(); });
    addEventListener('beforeunload', (e) => { if (liveOn) e.preventDefault(); });
    window.__studio = { get live() { return liveOn; }, get pc() { return pc; }, mixed, board, stage: onStage };   // for diagnostics
    camOn();
  }
})();
