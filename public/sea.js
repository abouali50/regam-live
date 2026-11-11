// REGAM Live - life added over the reef picture shown while a room is not live:
// sun rays swaying through the water, a few fish swimming across, bubbles going up.
'use strict';

function createSea(canvas) {
  const ctx = canvas.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, raf = 0, last = 0, t = 0, running = false;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let fish = [], bubbles = [], motes = [];

  const FISH_COLORS = [['#ffb347', '#e8742c'], ['#ffe066', '#e0a800'], ['#7ee0d6', '#2aa39a'], ['#ff8fa3', '#d9486a'], ['#b9c7ff', '#6f86e8'], ['#f4f1e8', '#c9c2ae']];
  function layout() {
    const r = canvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * d); canvas.height = Math.round(H * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const n = Math.round(Math.min(12, Math.max(5, W / 130)));
    fish = Array.from({ length: n }, (_, i) => {
      const dir = Math.random() < 0.5 ? 1 : -1, size = rnd(0.5, 1.25) * Math.max(14, Math.min(W, H) * 0.035);
      return { x: rnd(0, W), y: rnd(H * 0.12, H * 0.78), dir, size, speed: rnd(14, 42) * (size < 16 ? 1.3 : 1), phase: rnd(0, 6.28), bob: rnd(4, 14), c: FISH_COLORS[i % FISH_COLORS.length], depth: rnd(0.45, 1) };
    }).sort((a, b) => a.depth - b.depth);
    bubbles = Array.from({ length: Math.round(n * 1.4) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 5), v: rnd(14, 40), w: rnd(0, 6.28) }));
    motes = Array.from({ length: 40 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.6, 1.6), v: rnd(2, 8), a: rnd(0.08, 0.3) }));
  }

  function rays() {                                  // light coming down through the water, swaying slowly
    const sx = W * 0.66;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = -0.5 + i * 0.17 + Math.sin(t * 0.12 + i * 1.7) * 0.05, wdt = W * (0.03 + 0.015 * Math.sin(t * 0.2 + i));
      const x2 = sx + Math.tan(a) * H * 1.05, ray = ctx.createLinearGradient(sx, 0, x2, H * 0.9);
      ray.addColorStop(0, `rgba(255,250,215,${0.10 + 0.05 * Math.sin(t * 0.3 + i * 2)})`); ray.addColorStop(1, 'rgba(255,250,215,0)');
      ctx.fillStyle = ray;
      ctx.beginPath(); ctx.moveTo(sx - wdt * 0.25, -4); ctx.lineTo(sx + wdt * 0.25, -4); ctx.lineTo(x2 + wdt * 2.2, H); ctx.lineTo(x2 - wdt * 2.2, H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function oneFish(f) {
    const wag = Math.sin(t * 6 + f.phase) * 0.35, s = f.size;
    ctx.save();
    ctx.translate(f.x, f.y + Math.sin(t * 0.8 + f.phase) * f.bob);
    ctx.scale(f.dir, 1); ctx.globalAlpha = 0.45 + f.depth * 0.55;
    const g = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
    g.addColorStop(0, f.c[0]); g.addColorStop(1, f.c[1]);
    ctx.fillStyle = f.c[1];                           // tail
    ctx.beginPath(); ctx.moveTo(-s * 0.85, 0); ctx.lineTo(-s * 1.55, -s * 0.5 + wag * s); ctx.lineTo(-s * 1.35, wag * s * 0.6); ctx.lineTo(-s * 1.55, s * 0.5 + wag * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = g;                                // body
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.48, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = f.c[1];                           // fins
    ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.42); ctx.quadraticCurveTo(-s * 0.1, -s * 0.9, -s * 0.6, -s * 0.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.05, s * 0.2); ctx.quadraticCurveTo(-s * 0.2, s * 0.7 + wag * s * 0.4, -s * 0.4, s * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.1, s * 0.13, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#0b1a2a'; ctx.beginPath(); ctx.arc(s * 0.58, -s * 0.1, s * 0.07, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  function frame(dt) {
    t += dt;
    ctx.clearRect(0, 0, W, H);
    rays();
    ctx.fillStyle = '#fff';
    for (const m of motes) { m.y -= m.v * dt; m.x += Math.sin(t + m.y * 0.02) * 4 * dt; if (m.y < -4) { m.y = H + 4; m.x = rnd(0, W); } ctx.globalAlpha = m.a; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const f of fish) {
      f.x += f.dir * f.speed * dt;
      if (f.x > W + f.size * 2) { f.x = -f.size * 2; f.y = rnd(H * 0.12, H * 0.78); } else if (f.x < -f.size * 2) { f.x = W + f.size * 2; f.y = rnd(H * 0.12, H * 0.78); }
      oneFish(f);
    }
    for (const b of bubbles) {
      b.y -= b.v * dt; b.w += dt * 2;
      if (b.y < -8) { b.y = H + 8; b.x = rnd(0, W); }
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.arc(b.x + Math.sin(b.w) * 5, b.y, b.r, 0, 6.28); ctx.fill(); ctx.stroke();
    }
  }
  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return;                    // about 30 pictures a second is plenty
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    frame(dt);
  }
  const resize = () => { if (canvas.getBoundingClientRect().width) { layout(); frame(0); } };
  addEventListener('resize', resize);
  return {
    start() {
      if (running) return;
      layout(); frame(0);
      if (calm) return;                             // people who asked for less motion get the still picture
      running = true; last = performance.now(); raf = requestAnimationFrame(loop);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
