// REGAM Live - a virtual background behind the person on camera: the person is cut out of the picture
// (in the browser, nothing is sent anywhere) and laid over a chosen picture (still, or with a light animation), a looping video, or their own room blurred.
'use strict';

function createVirtualBg() {
  const W = 1280, H = 720;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none';
  let seg = null, ready = null, mode = '', bg = null, running = false, busy = false, timer = null, track = null, frames = 0;
  // the background is prepared on a canvas of its own: a picture or a looping video, and for the "living"
  // ones a light animation drawn over it (glints on water, stars that twinkle, lights that drift, mist, bubbles)
  const back = document.createElement('canvas'); back.width = W; back.height = H;
  const bctx = back.getContext('2d');
  let clip = null, fx = '', bits = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const seed = (n, make) => Array.from({ length: n }, make);
  const FX = {
    shimmer: { make: () => seed(170, () => { const t = Math.pow(Math.random(), 1.4); return { y: H * (0.63 + t * 0.37), x: W / 2 + (Math.random() + Math.random() - 1) * (60 + t * 520), l: 10 + t * 70, p: rnd(0, 7), s: rnd(1.2, 3.4), t }; }),
      draw: (g, t) => { for (const b of bits) { const a = Math.pow(Math.sin(t * b.s + b.p) * 0.5 + 0.5, 3); g.fillStyle = `rgba(255,${225 - b.t * 50},${170 - b.t * 50},${a * 0.75})`; g.fillRect(b.x - b.l / 2, b.y, b.l, 1.5 + b.t * 2); } } },
    twinkle: { make: () => seed(110, () => ({ x: rnd(0, W), y: Math.pow(Math.random(), 1.4) * H * 0.55, r: rnd(0.8, 2.2), p: rnd(0, 7), s: rnd(0.8, 2.6) })),
      draw: (g, t) => {
        for (const b of bits) { const a = Math.pow(Math.sin(t * b.s + b.p) * 0.5 + 0.5, 2); g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(b.x, b.y, b.r * (0.6 + a), 0, 7); g.fill(); }
        const k = (t % 9) / 0.9;                    // a shooting star now and then
        if (k < 1) { const x = W * 0.75 - k * 420, y = H * 0.12 + k * 150; const gr = g.createLinearGradient(x, y, x + 150, y - 54); gr.addColorStop(0, `rgba(255,255,255,${1 - k})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 150, y - 54); g.stroke(); }
      } },
    drift: { make: () => seed(46, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(18, 80), v: rnd(6, 22), p: rnd(0, 7), c: Math.random() < 0.7 ? '255,205,120' : Math.random() < 0.5 ? '190,140,255' : '120,220,230' })),
      draw: (g, t) => { g.globalCompositeOperation = 'lighter'; for (const b of bits) { const y = ((b.y - t * b.v) % (H + 200) + H + 200) % (H + 200) - 100, x = b.x + Math.sin(t * 0.4 + b.p) * 30, a = 0.10 + 0.08 * Math.sin(t * 0.9 + b.p); const gr = g.createRadialGradient(x, y, b.r * 0.5, x, y, b.r); gr.addColorStop(0, `rgba(${b.c},${a})`); gr.addColorStop(0.85, `rgba(${b.c},${a * 1.5})`); gr.addColorStop(1, `rgba(${b.c},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, b.r, 0, 7); g.fill(); } g.globalCompositeOperation = 'source-over'; } },
    fog: { make: () => seed(7, () => ({ x: rnd(0, W), y: H * rnd(0.45, 0.85), w: rnd(500, 900), h: rnd(70, 150), v: rnd(8, 22) * (Math.random() < 0.5 ? -1 : 1) })),
      draw: (g, t) => { for (const b of bits) { const x = ((b.x + t * b.v) % (W + b.w * 2) + W + b.w * 2) % (W + b.w * 2) - b.w; const gr = g.createRadialGradient(x, b.y, 0, x, b.y, b.w / 2); gr.addColorStop(0, 'rgba(240,244,252,.28)'); gr.addColorStop(1, 'rgba(240,244,252,0)'); g.save(); g.translate(0, b.y); g.scale(1, b.h / (b.w / 2)); g.translate(0, -b.y); g.fillStyle = gr; g.beginPath(); g.arc(x, b.y, b.w / 2, 0, 7); g.fill(); g.restore(); } } },
    bubbles: { make: () => seed(40, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(2, 9), v: rnd(30, 80), p: rnd(0, 7) })),
      draw: (g, t) => { for (const b of bits) { const y = ((b.y - t * b.v) % (H + 40) + H + 40) % (H + 40) - 20, x = b.x + Math.sin(t * 1.3 + b.p) * 14; g.strokeStyle = 'rgba(220,245,255,.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, b.r, 0, 7); g.stroke(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(x - b.r * 0.3, y - b.r * 0.3, b.r * 0.25, 0, 7); g.fill(); }
        const sway = Math.sin(t * 0.5) * 0.04 + 0.06; const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, `rgba(255,255,230,${sway})`); gr.addColorStop(0.5, 'rgba(255,255,230,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); } },
  };
  function drawBack() {
    if (clip && clip.readyState >= 2) cover(bctx, clip, clip.videoWidth, clip.videoHeight);
    else if (bg) cover(bctx, bg, bg.naturalWidth, bg.naturalHeight);
    else { bctx.fillStyle = '#101426'; bctx.fillRect(0, 0, W, H); }
    if (FX[fx]) FX[fx].draw(bctx, performance.now() / 1000);
  }

  const script = (src) => new Promise((ok, bad) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => bad(new Error('load')); document.head.append(el); });
  function load() {                              // the cutting-out engine, fetched the first time it is wanted
    if (ready) return ready;
    ready = (async () => {
      if (!window.SelfieSegmentation) await script('/vendor/selfie/selfie_segmentation.js');
      seg = new window.SelfieSegmentation({ locateFile: (f) => '/vendor/selfie/' + f });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      seg.onResults(paint);
      await seg.initialize();
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }
  const cover = (g, img, w, h) => { const z = Math.max(W / w, H / h); g.drawImage(img, (W - w * z) / 2, (H - h * z) / 2, w * z, h * z); };
  function paint(r) {
    const iw = r.image.width || video.videoWidth, ih = r.image.height || video.videoHeight;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.filter = 'blur(3px)';                     // a soft edge around the person
    cover(ctx, r.segmentationMask, iw, ih);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';   // the camera, kept only where the person is
    cover(ctx, r.image, iw, ih);
    ctx.globalCompositeOperation = 'destination-over';   // and the background behind
    if (mode === 'blur') { ctx.filter = 'blur(14px)'; cover(ctx, r.image, iw, ih); ctx.filter = 'none'; }
    else { drawBack(); ctx.drawImage(back, 0, 0); }
    ctx.restore();
    frames++;
  }
  async function step() {
    if (!running || busy || video.readyState < 2) return;
    busy = true;
    try { await seg.send({ image: video }); } catch { /* a frame lost */ } finally { busy = false; }
  }

  return {
    get on() { return running; },
    get mode() { return mode; },
    get frames() { return frames; },
    canvas: out,
    // what goes behind: nothing ({}), the room blurred ({ kind: 'blur' }), a picture ({ kind: 'image', src }),
    // a picture that lives ({ kind: 'image', src, fx }), or a video in a loop ({ kind: 'video', src })
    async choose(next) {
      const n = next || {};
      if (clip) { clip.pause(); clip.removeAttribute('src'); clip.load(); clip.remove(); clip = null; }
      bg = null; fx = FX[n.fx] ? n.fx : ''; bits = fx ? FX[fx].make() : [];
      mode = n.kind === 'blur' ? 'blur' : n.kind === 'image' || n.kind === 'video' ? n.kind : '';
      if (mode === 'image') { const img = new Image(); img.src = n.src; await img.decode(); bg = img; }
      if (mode === 'video') {
        clip = document.createElement('video');
        clip.muted = true; clip.loop = true; clip.playsInline = true; clip.src = n.src;
        clip.style.cssText = 'position:fixed;left:4px;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none';
        document.body.append(clip);
        await new Promise((ok, bad) => { clip.onloadeddata = ok; clip.onerror = () => bad(new Error('video')); });
        await clip.play().catch(() => {});
      }
    },
    get fx() { return fx; },
    // The camera goes in, the camera with its new background comes out (a track the mixer takes like any camera).
    async start(camTrack) {
      await load();
      video.srcObject = new MediaStream([camTrack]);
      if (!video.isConnected) document.body.append(video);
      await video.play().catch(() => {});
      running = true;
      if (clip) clip.play().catch(() => {});
      clearInterval(timer); timer = setInterval(step, 40);
      if (!track || track.readyState === 'ended') track = out.captureStream(25).getVideoTracks()[0];
      return track;
    },
    stop() {
      running = false; clearInterval(timer); timer = null;
      video.srcObject = null; video.remove();
      if (clip) clip.pause();
      if (track) { track.stop(); track = null; }
    },
  };
}
