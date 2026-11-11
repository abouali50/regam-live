// REGAM Live - studio: camera + screen share + guest, mixed into one broadcast.
'use strict';
(function () {
  const TOKEN_KEY = 'regam.studio';
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  const status = (t) => { $('#status').textContent = t; };

  // --------------------------------------------------------------- login --
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    if (!r.ok) {
      $('#loginErr').hidden = false;
      $('#loginErr').textContent = T(r.status === 429 ? 'محاولات بزاف. تسنى ربع ساعة وعاود.' : 'كلمة السر غالطة.');
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
    $('#login').hidden = true;
    $('#app').hidden = false;
    const cfg = await fetch('/api/config').then((r) => r.json());
    const link = createLink({ token });
    mountChat($('#chat'), link);

    // --------------------------------------------------------- the mixer --
    const supported = 'MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window;
    if (!supported) {
      status(T('الاستوديو كيخدم على Google Chrome ولا Edge فالحاسوب. حل هاد الصفحة فواحد منهم.'));
      $('#goBtn').disabled = true;
      return;
    }
    const worker = new Worker('/compositor.worker.js');
    const mixed = new MediaStreamTrackGenerator({ kind: 'video' });
    worker.postMessage({ type: 'init', writable: mixed.writable, brand: cfg.title }, [mixed.writable]);
    const setInput = (name, track) => {
      if (!track) return worker.postMessage({ type: 'remove', name });
      const proc = new MediaStreamTrackProcessor({ track, maxBufferSize: 2 });
      worker.postMessage({ type: 'input', name, readable: proc.readable }, [proc.readable]);
    };
    $('#preview').srcObject = new MediaStream([mixed]);

    // ----------------------------------------------------------- sources --
    let camTrack = null, screenTrack = null, micTrack = null, micOn = true;
    let audioCtx = null, mixOut = null, micGain = null;
    let pc = null, liveOn = false;             // main broadcast
    let back = null;                           // host voice for the guest
    let guestRx = null, guestNode = null, guest = null;

    const press = (btn, on) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');

    async function camOn() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 25 } } });
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
      if (back && back.track) back.track.enabled = micOn;
      press($('#micBtn'), micOn);
    };

    // When the connection is weak, drop frames rather than sharpness: the audience
    // gets a fixed picture size, and text on a shared screen must stay readable.
    function tune() {
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
      try {
        if (!(await ensureMic())) return;
        audioCtx = audioCtx || new AudioContext();
        await audioCtx.resume();
        if (!mixOut) {
          mixOut = audioCtx.createMediaStreamDestination();
          micGain = audioCtx.createGain();
          micGain.gain.value = micOn ? 1 : 0;
          audioCtx.createMediaStreamSource(new MediaStream([micTrack])).connect(micGain).connect(mixOut);
        }
        pc = new RTCPeerConnection();
        pc.addTransceiver(mixOut.stream.getAudioTracks()[0], { direction: 'sendonly' });
        preferH264(pc.addTransceiver(mixed, { direction: 'sendonly', sendEncodings: [{ maxBitrate: 4_500_000, maxFramerate: 25 }] }));
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'connected') status(T('نتا على الهواء. المتابعين كيشوفوك بتأخير ديال بضع ثواني.'));
          if (pc.connectionState === 'failed') { stopLive(); status(T('تقطع الاتصال بالسيرفر. تأكد من الأنترنيت وعاود بدا اللايف.')); }
        };
        await rtcNegotiate(pc, 'whip', 'studio', token);
        liveOn = true;
        tune();
        $('#goBtn').textContent = T('وقف اللايف');
        lockLang(true);
        $('#goBtn').classList.add('danger');
        $('#onAir').hidden = false;
        status(T('كنتصلو…'));
        if (guest) syncGuest();
      } catch (e) {
        if (pc) { pc.close(); pc = null; }
        status(T(e && e.status === 401 ? 'سالات الجلسة. عاود دخل.' : 'ما قدرناش نبداو اللايف. السيرفر ديال البث ما كيجاوبش.'));
        if (e && e.status === 401) logout();
      } finally { $('#goBtn').disabled = false; }
    }
    function stopLive() {
      if (guest) link.send({ t: 'unstage' });
      dropGuestMedia();
      if (pc) { rtcClose(pc, 'whip', 'studio', token); pc = null; }
      liveOn = false;
      $('#goBtn').textContent = T('ابدأ اللايف');
      lockLang(false);
      $('#goBtn').classList.remove('danger');
      $('#onAir').hidden = true;
      status(T('وقف اللايف.'));
    }
    $('#goBtn').onclick = () => (liveOn ? stopLive() : goLive());

    // ------------------------------------------------------------- guest --
    // 1) we publish our raw voice on "backstage" so the guest hears us without hearing themself
    // 2) once the guest is publishing, we pull their camera + voice and add both to the mix
    async function syncGuest() {
      if (!guest || !liveOn) return;
      try {
        if (!back) {
          const track = micTrack.clone();
          track.enabled = micOn;
          const bpc = new RTCPeerConnection();
          back = { pc: bpc, track };
          bpc.addTransceiver(track, { direction: 'sendonly' });
          await rtcNegotiate(bpc, 'whip', 'backstage', token);
        }
        if (guest && guest.ready && !guestRx) {
          const want = guest.uid;
          const rx = await rtcWatch('guest', token);
          if (!guest || guest.uid !== want || !liveOn) { rtcClose(rx.pc, 'whep', 'guest', token); return; }
          guestRx = rx;
          const attach = () => {
            const v = rx.stream.getVideoTracks()[0], a = rx.stream.getAudioTracks()[0];
            if (v) setInput('guest', v);
            if (a && !guestNode) {
              $('#guestAudio').srcObject = new MediaStream([a]);     // so we hear the guest
              guestNode = audioCtx.createMediaStreamSource(new MediaStream([a]));
              guestNode.connect(mixOut);                             // so the audience hears the guest
            }
          };
          attach();
          rx.pc.addEventListener('track', () => setTimeout(attach, 0));
          status(T('{name} طلع معاك للمنصة. استعمل السماعات باش ما يكونش الصدى.', { name: guest.name }));
        }
      } catch { status(T('ما قدرناش نربطو الضيف. نزلو وعاود قبل الطلب ديالو.')); }
    }
    function dropGuestMedia() {
      setInput('guest', null);
      if (guestNode) { guestNode.disconnect(); guestNode = null; }
      $('#guestAudio').srcObject = null;
      if (guestRx) { rtcClose(guestRx.pc, 'whep', 'guest', token); guestRx = null; }
      if (back) { back.track.stop(); rtcClose(back.pc, 'whip', 'backstage', token); back = null; }
    }
    function showGuest(g) {
      const changed = !!guest && (!g || g.uid !== guest.uid);
      if (changed) dropGuestMedia();
      guest = g;
      $('#guestBox').hidden = !g;
      if (g) $('#guestName').textContent = T(g.ready ? '{name} على المنصة' : 'كنتسناو {name} يدخل…', { name: g.name });
      worker.postMessage({ type: 'guestName', name: g ? g.name : '' });
      if (g) syncGuest();
    }
    $('#unstageBtn').onclick = () => link.send({ t: 'unstage' });

    function showHands(list) {
      $('#noHands').hidden = list.length > 0;
      $('#hands').replaceChildren(...list.map((h) => el('li', {},
        el('span', {}, h.name),
        el('button', { class: 'btn primary', type: 'button', onclick: () => {
          if (!liveOn) return status(T('بدا اللايف أولا، عاد قبل الطلبات.'));
          link.send({ t: 'stage', uid: h.uid });
        } }, T('قبول')))));
    }

    // ---------------------------------------------------------- settings --
    $('#titleForm').onsubmit = (e) => { e.preventDefault(); link.send({ t: 'title', text: $('#titleInput').value }); };
    $('#pinForm').onsubmit = (e) => { e.preventDefault(); link.send({ t: 'pin', text: $('#pinInput').value }); };
    $('#slowSel').onchange = () => link.send({ t: 'slow', sec: Number($('#slowSel').value) });

    link.on('init', (d) => {
      if (!d.mod) return logout();            // token expired
      $('#viewers').textContent = d.viewers; $('#likes').textContent = d.likes || 0;
      $('#titleInput').value = d.title || '';
      $('#pinInput').value = d.pinned || '';
      $('#slowSel').value = String(d.slow);
      setBadge(d.live); showHands(d.hands || []); showGuest(d.guest);
    })
      .on('live', (d) => setBadge(d.on))
      .on('viewers', (d) => { $('#viewers').textContent = d.n; })
      .on('likes', (d) => { $('#likes').textContent = d.n; })
      .on('hands', (d) => showHands(d.list))
      .on('guest', (d) => showGuest(d.guest))
      .on('slow', (d) => { $('#slowSel').value = String(d.sec); });
    // -------------------------------------------------------- recordings --
    const fmtSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB');
    const fmtName = (n) => { const m = n.match(/^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)/); return m ? `${m[3]}/${m[2]}/${m[1]} · ${m[4]}:${m[5]}` : n; };
    async function loadRecs() {
      let data;
      try {
        const r = await fetch('/api/recordings', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return;
        data = await r.json();
      } catch { return; }
      $('#noRecs').hidden = data.list.length > 0;
      $('#recs').replaceChildren(...data.list.map((f, i) => {
        const busy = data.live && i === 0;            // still being written
        return el('li', {},
          el('span', { dir: 'ltr' }, `${fmtName(f.name)} · ${fmtSize(f.size)}`),
          busy ? el('span', { class: 'muted' }, T('كيتسجل دابا…')) : el('span', { class: 'rec-actions' },
            el('a', { class: 'btn primary', href: `/api/recordings?name=${encodeURIComponent(f.name)}&token=${encodeURIComponent(token)}`, download: '' }, T('تحميل')),
            el('button', { class: 'btn', type: 'button', onclick: async () => {
              if (!confirm(T('تحذف هاد التسجيل نهائيا؟'))) return;
              await fetch(`/api/recordings?name=${encodeURIComponent(f.name)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
              loadRecs();
            } }, T('حذف'))));
      }));
    }
    loadRecs();
    link.on('live', () => setTimeout(loadRecs, 3000));

    function setBadge(on) {
      $('#liveBadge').textContent = T(on ? 'مباشر' : 'غير مباشر');
      $('#liveBadge').className = 'badge ' + (on ? 'on' : 'off');
    }

    addEventListener('pagehide', () => { if (liveOn) stopLive(); });
    addEventListener('beforeunload', (e) => { if (liveOn) e.preventDefault(); });
    window.__studio = { get live() { return liveOn; }, get pc() { return pc; }, mixed, board };   // for diagnostics
    camOn();
  }
})();
