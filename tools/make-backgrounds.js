// REGAM Live - draws the waiting-screen backgrounds (3840 x 2160) and saves them as WebP in public/bg.
// Run: node tools/make-backgrounds.js   (needs Playwright's Chromium). Author: Aziz Mernissi.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCENES = function () {
  const W = 3840, H = 2160;
  // ---- small toolbox: repeatable randomness, smooth noise, ridgelines
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noise2 = (seed) => {
    const r = rng(seed), P = new Float32Array(65536); for (let i = 0; i < 65536; i++) P[i] = r();
    const at = (x, y) => P[((x & 255) << 8) | (y & 255)], s = (t) => t * t * (3 - 2 * t);
    const n = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), u = s(x - xi), v = s(y - yi); return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v; };
    return (x, y, oct = 5) => { let a = 0, amp = 0.5, f = 1, tot = 0; for (let o = 0; o < oct; o++) { a += n(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; } return a / tot; };
  };
  const grad = (g, x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([p, c]) => gr.addColorStop(p, c)); return gr; };
  const rad = (g, x, y, r0, r1, stops) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([p, c]) => gr.addColorStop(p, c)); return gr; };
  const sky = (g, stops, h = H) => { g.fillStyle = grad(g, 0, 0, 0, h, stops); g.fillRect(0, 0, W, h); };
  function stars(g, r, n, maxY, tint = '255,255,255') {
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = Math.pow(r(), 1.5) * maxY, big = r() < 0.03, s = big ? 2.2 + r() * 2.4 : 0.6 + r() * 1.5, a = 0.35 + r() * 0.65;
      if (big) { g.fillStyle = rad(g, x, y, 0, s * 7, [[0, `rgba(${tint},${a * 0.55})`], [1, `rgba(${tint},0)`]]); g.fillRect(x - s * 7, y - s * 7, s * 14, s * 14); }
      g.fillStyle = `rgba(${tint},${a})`; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
  }
  // a mountain or dune line: height(x) from noise, filled down to the bottom
  function ridge(g, nz, { base, amp, freq, seedY, fill, rough = 5, bottom = H, step = 6 }) {
    g.beginPath(); g.moveTo(0, bottom);
    for (let x = 0; x <= W; x += step) g.lineTo(x, base - (nz(x * freq, seedY, rough) - 0.5) * 2 * amp);
    g.lineTo(W, bottom); g.closePath(); g.fillStyle = fill; g.fill();
  }
  const heightAt = (nz, x, o) => o.base - (nz(x * o.freq, o.seedY, o.rough || 5) - 0.5) * 2 * o.amp;
  // soft clouds / nebula: noise computed small, then stretched smoothly
  function cloud(g, nz, { w = 960, h = 540, color, x = 0, y = 0, dw = W, dh = H, mode = 'source-over' }) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cg = c.getContext('2d'), im = cg.createImageData(w, h), d = im.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [r, gg, b, a] = color(i / w, j / h, nz); const k = (j * w + i) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = a; }
    cg.putImageData(im, 0, 0);
    g.save(); g.globalCompositeOperation = mode; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(c, x, y, dw, dh); g.restore();
  }
  const vignette = (g, a = 0.45) => { g.fillStyle = rad(g, W / 2, H / 2, H * 0.35, H * 1.15, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${a})`]]); g.fillRect(0, 0, W, H); };
  function crescent(g, x, y, r, color = '#fff6d8') {
    g.fillStyle = rad(g, x, y, r * 0.6, r * 5, [[0, 'rgba(255,240,200,.28)'], [1, 'rgba(255,240,200,0)']]); g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    const c = document.createElement('canvas'); c.width = c.height = r * 2 + 8; const m = c.getContext('2d');
    m.fillStyle = color; m.beginPath(); m.arc(r + 4, r + 4, r, 0, 7); m.fill();
    m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(r + 4 + r * 0.42, r + 4 - r * 0.18, r * 0.86, 0, 7); m.fill();
    g.drawImage(c, x - r - 4, y - r - 4);
  }

  return {
    // 1. northern lights over a lake
    aurora(g) {
      const r = rng(11), nz = noise2(5);
      sky(g, [[0, '#01030f'], [0.45, '#06183a'], [0.78, '#0d3a4f'], [1, '#14585e']], H * 0.72);
      stars(g, r, 2600, H * 0.62);
      g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(18px)';
      const bands = [['70,255,170', 0.30, 0.20, 3], ['40,230,200', 0.36, 0.26, 9], ['150,110,255', 0.22, 0.14, 17], ['90,255,140', 0.42, 0.18, 23]];
      for (const [rgb, top, len, sd] of bands) for (let x = -40; x < W + 40; x += 14) {
        const k = nz(x * 0.0011, sd, 4), y0 = H * (top + (k - 0.5) * 0.34), hgt = H * len * (0.5 + nz(x * 0.004, sd + 40, 3)), a = 0.10 + 0.42 * Math.pow(nz(x * 0.006, sd + 80, 3), 1.6);
        g.fillStyle = grad(g, 0, y0 - hgt, 0, y0 + hgt * 0.35, [[0, `rgba(${rgb},0)`], [0.72, `rgba(${rgb},${a})`], [1, `rgba(${rgb},0)`]]);
        g.fillRect(x, y0 - hgt, 16, hgt * 1.35);
      }
      g.restore();
      const horizon = H * 0.72;
      ridge(g, nz, { base: horizon - 150, amp: 300, freq: 0.0011, seedY: 2, fill: '#0c2740', bottom: horizon });
      ridge(g, nz, { base: horizon - 70, amp: 230, freq: 0.0017, seedY: 9, fill: '#071a2d', bottom: horizon });
      ridge(g, nz, { base: horizon - 10, amp: 120, freq: 0.003, seedY: 15, fill: '#030d1a', bottom: horizon });
      // the lake: the sky upside down, darker, with ripples
      g.save(); g.translate(0, horizon * 2); g.scale(1, -1); g.globalAlpha = 0.62; g.drawImage(g.canvas, 0, horizon - (H - horizon), W, H - horizon, 0, horizon - (H - horizon), W, H - horizon); g.restore();
      g.fillStyle = grad(g, 0, horizon, 0, H, [[0, 'rgba(2,10,22,.35)'], [1, 'rgba(1,4,12,.88)']]); g.fillRect(0, horizon, W, H - horizon);
      for (let i = 0; i < 900; i++) { const y = horizon + Math.pow(r(), 1.6) * (H - horizon), x = r() * W, l = 40 + r() * 260 * ((y - horizon) / (H - horizon) + 0.2); g.fillStyle = `rgba(150,255,220,${0.02 + r() * 0.05})`; g.fillRect(x, y, l, 1.5 + r() * 2); }
      vignette(g, 0.35);
    },
    // 2. sunset on the ocean
    sunset(g) {
      const r = rng(21), nz = noise2(8), hz = H * 0.62, sx = W * 0.5;
      sky(g, [[0, '#1a1446'], [0.3, '#5b2a78'], [0.55, '#c7466b'], [0.8, '#f58a4c'], [1, '#ffd27a']], hz);
      g.fillStyle = rad(g, sx, hz, 0, H * 0.75, [[0, 'rgba(255,236,170,.95)'], [0.12, 'rgba(255,190,110,.55)'], [0.45, 'rgba(255,120,90,.16)'], [1, 'rgba(255,120,90,0)']]); g.fillRect(0, 0, W, hz);
      cloud(g, nz, { dh: hz, color: (u, v, n) => { const k = Math.max(0, n(u * 5, v * 9 + 3, 5) - 0.47) * 3.4, lit = 1 - v; return [255 - 120 * lit, 120 + 70 * v, 120 + 60 * lit, Math.min(210, k * 255 * (0.35 + v * 0.75))]; } });
      g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(sx, hz - 26, 132, 0, 7); g.fill();
      g.fillStyle = grad(g, 0, hz, 0, H, [[0, '#f0834f'], [0.08, '#7a3460'], [0.4, '#22204f'], [1, '#080a22']]); g.fillRect(0, hz, W, H - hz);
      for (let i = 0; i < 5200; i++) {
        const t = Math.pow(r(), 1.4), y = hz + t * (H - hz), spread = 120 + t * 1500, x = sx + (r() + r() + r() - 1.5) * spread, l = 30 + t * 240 * r(), a = (0.10 + 0.5 * (1 - t)) * r();
        g.fillStyle = `rgba(255,${200 - t * 60},${130 - t * 40},${a})`; g.fillRect(x - l / 2, y, l, 2 + t * 5);
      }
      for (let i = 0; i < 1600; i++) { const t = r(), y = hz + t * (H - hz); g.fillStyle = `rgba(255,255,255,${0.015 + r() * 0.04})`; g.fillRect(r() * W, y, 60 + t * 320, 1.5 + t * 3); }
      g.fillStyle = grad(g, 0, hz - 26, 0, hz + 30, [[0, 'rgba(255,200,140,0)'], [0.5, 'rgba(255,205,150,.5)'], [1, 'rgba(255,200,140,0)']]); g.fillRect(0, hz - 26, W, 56);
      vignette(g, 0.4);
    },
    // 3. dunes at dusk
    dunes(g) {
      const r = rng(31), nz = noise2(12);
      sky(g, [[0, '#0d1036'], [0.4, '#3a2a6b'], [0.68, '#b55a6e'], [0.86, '#f3a162'], [1, '#ffd9a0']]);
      stars(g, r, 1100, H * 0.42, '255,244,220');
      crescent(g, W * 0.78, H * 0.2, 120);
      g.fillStyle = rad(g, W * 0.3, H * 0.74, 0, H * 0.8, [[0, 'rgba(255,214,150,.75)'], [0.4, 'rgba(255,160,100,.2)'], [1, 'rgba(255,160,100,0)']]); g.fillRect(0, 0, W, H);
      const layers = [[0.60, 70, 0.0009, '#d98a5c', '#b96a4d'], [0.66, 110, 0.0007, '#c9703f', '#9d4c33'], [0.74, 150, 0.0006, '#b3562c', '#7c3524'], [0.83, 190, 0.0005, '#8f3f20', '#55230f'], [0.94, 220, 0.00045, '#5a260f', '#1e0b05']];
      layers.forEach(([b, amp, f, c1, c2], i) => {
        const o = { base: H * b, amp, freq: f, seedY: 3 + i * 7, rough: 3 };
        ridge(g, nz, { ...o, fill: grad(g, 0, H * b - amp, 0, H, [[0, c1], [0.5, c2], [1, '#120603']]) });
        // the lit crest of each dune
        g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,205,150,${0.22 - i * 0.03})`; g.lineWidth = 5; g.beginPath();
        for (let x = 0; x <= W; x += 6) { const y = heightAt(nz, x, o); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); g.restore();
        // wind lines on the sand
        for (let k = 0; k < 220; k++) { const x = r() * W, y = heightAt(nz, x, o) + 20 + r() * 240; g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; g.fillRect(x, y, 80 + r() * 300, 2); }
      });
      vignette(g, 0.42);
    },
    // 4. zellige: eight-pointed stars in gold on deep blue
    zellige(g) {
      g.fillStyle = rad(g, W / 2, H / 2, 0, W * 0.7, [[0, '#17306e'], [0.6, '#0b1a45'], [1, '#050b22']]); g.fillRect(0, 0, W, H);
      const S = 384, gold = (a) => `rgba(236,196,96,${a})`;
      const star = (cx, cy, R, rot) => { g.beginPath(); for (let i = 0; i < 16; i++) { const a = rot + (i * Math.PI) / 8, rr = i % 2 ? R * 0.54 : R; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
      for (let j = -1; j <= H / S + 1; j++) for (let i = -1; i <= W / S + 1; i++) {
        const cx = i * S + S / 2, cy = j * S + S / 2, d = Math.hypot(cx - W / 2, cy - H / 2) / (W * 0.6), glow = Math.max(0.25, 1 - d);
        star(cx, cy, S * 0.46, Math.PI / 8); g.fillStyle = `rgba(30,70,150,${0.55 * glow})`; g.fill(); g.lineWidth = 7; g.strokeStyle = gold(0.85 * glow); g.stroke();
        star(cx, cy, S * 0.25, 0); g.fillStyle = gold(0.22 * glow); g.fill(); g.lineWidth = 3; g.strokeStyle = gold(0.9 * glow); g.stroke();
        g.fillStyle = gold(0.95 * glow); g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
        // the small cross-shaped tile between four stars
        const x = cx + S / 2, y = cy + S / 2;
        star(x, y, S * 0.2, 0); g.fillStyle = `rgba(20,150,140,${0.5 * glow})`; g.fill(); g.lineWidth = 3; g.strokeStyle = gold(0.7 * glow); g.stroke();
        g.strokeStyle = gold(0.35 * glow); g.lineWidth = 2; g.strokeRect(cx - S / 2, cy - S / 2, S, S);
      }
      g.fillStyle = rad(g, W / 2, H / 2, 0, H * 0.75, [[0, 'rgba(255,220,140,.14)'], [1, 'rgba(255,220,140,0)']]); g.fillRect(0, 0, W, H);
      vignette(g, 0.6);
    },
    // 5. misty mountains at dawn
    mist(g) {
      const r = rng(51), nz = noise2(19);
      sky(g, [[0, '#7fa6d9'], [0.4, '#c3d4ee'], [0.62, '#ffe1c2'], [0.8, '#ffc79a'], [1, '#f6b38a']]);
      g.fillStyle = rad(g, W * 0.68, H * 0.46, 0, H * 0.7, [[0, 'rgba(255,250,225,1)'], [0.08, 'rgba(255,236,190,.8)'], [0.4, 'rgba(255,210,160,.25)'], [1, 'rgba(255,210,160,0)']]); g.fillRect(0, 0, W, H);
      cloud(g, nz, { dh: H * 0.5, color: (u, v, n) => { const k = Math.max(0, n(u * 4, v * 7 + 11, 5) - 0.5) * 3; return [255, 246, 236, Math.min(150, k * 255)]; } });
      const cols = ['#a9bedb', '#8aa5c9', '#6b8bb5', '#4d709c', '#35557f', '#213c61', '#12263f', '#081423'];
      cols.forEach((c, i) => {
        const o = { base: H * (0.5 + i * 0.065), amp: 150 + i * 26, freq: 0.0007 + i * 0.00022, seedY: 4 + i * 6, rough: 6 };
        ridge(g, nz, { ...o, fill: c });
        if (i >= 5) for (let x = 0; x < W; x += 20 + r() * 34) {          // pines on the near ridges
          const y = heightAt(nz, x, o), h = (46 + r() * 60) * (i - 4) * 0.8, w = h * 0.36; g.fillStyle = c;
          g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y + 8); g.lineTo(x - w, y + 8); g.closePath(); g.fill();
        }
        g.fillStyle = grad(g, 0, o.base - 40, 0, o.base + 260, [[0, 'rgba(255,240,225,0)'], [0.6, `rgba(235,240,250,${0.34 - i * 0.035})`], [1, 'rgba(235,240,250,0)']]); g.fillRect(0, o.base - 40, W, 300);
      });
      vignette(g, 0.3);
    },
    // 6. nebula
    nebula(g) {
      const r = rng(61), nz = noise2(27);
      g.fillStyle = '#03030c'; g.fillRect(0, 0, W, H);
      cloud(g, nz, { color: (u, v, n) => {
        const a = n(u * 3 + 1, v * 2.2 + 7, 6), b = n(u * 2.4 + 9, v * 3.1 + 2, 6), c = n(u * 6 + 4, v * 6 + 5, 5), m = Math.max(0, a - 0.36) * 2.4, p = Math.max(0, b - 0.42) * 2.6;
        return [40 + 215 * p * (0.6 + c * 0.6), 30 + 110 * m * c + 60 * p * p, 90 + 165 * m, Math.min(255, (m * 0.9 + p * 0.8) * 255)];
      } });
      g.fillStyle = rad(g, W * 0.62, H * 0.42, 0, H * 0.5, [[0, 'rgba(255,200,150,.22)'], [1, 'rgba(255,200,150,0)']]); g.fillRect(0, 0, W, H);
      stars(g, r, 5200, H * 1.6);
      stars(g, r, 500, H * 1.6, '190,215,255');
      vignette(g, 0.5);
    },
    // 7. domes and minarets at dusk, over water
    medina(g) {
      const r = rng(71), nz = noise2(33), hz = H * 0.7;
      sky(g, [[0, '#070b2a'], [0.35, '#1e1f5c'], [0.62, '#6a3a7d'], [0.82, '#e0785a'], [1, '#ffc27d']], hz);
      stars(g, r, 1500, H * 0.4);
      crescent(g, W * 0.2, H * 0.17, 105);
      cloud(g, nz, { dh: hz, color: (u, v, n) => { const k = Math.max(0, n(u * 4, v * 8 + 5, 5) - 0.52) * 3.2; return [255, 150 + 60 * v, 150, Math.min(140, k * 255 * v)]; } });
      g.fillStyle = rad(g, W * 0.62, hz, 0, H * 0.6, [[0, 'rgba(255,210,150,.8)'], [0.5, 'rgba(255,150,110,.15)'], [1, 'rgba(255,150,110,0)']]); g.fillRect(0, 0, W, hz);
      const ink = '#07091c', lights = [];
      g.fillStyle = ink;
      const box = (x, w, h) => { g.fillRect(x, hz - h, w, h); for (let k = 0; k < (w * h) / 26000; k++) lights.push([x + 14 + r() * (w - 28), hz - 18 - r() * (h - 40)]); };
      const dome = (cx, w, h) => { g.beginPath(); g.moveTo(cx - w / 2, hz - h); g.bezierCurveTo(cx - w / 2, hz - h - w * 0.72, cx + w / 2, hz - h - w * 0.72, cx + w / 2, hz - h); g.closePath(); g.fill(); g.fillRect(cx - 4, hz - h - w * 0.72, 8, w * 0.2); g.beginPath(); g.arc(cx, hz - h - w * 0.74, 11, 0, 7); g.fill(); };
      const minaret = (x, h) => { g.fillRect(x - 17, hz - h, 34, h); g.fillRect(x - 28, hz - h * 0.72, 56, 14); g.fillRect(x - 26, hz - h * 0.93, 52, 12); g.beginPath(); g.moveTo(x - 20, hz - h); g.lineTo(x, hz - h - 80); g.lineTo(x + 20, hz - h); g.closePath(); g.fill(); g.beginPath(); g.arc(x, hz - h - 86, 8, 0, 7); g.fill(); lights.push([x, hz - h * 0.86]); };
      for (let x = -60; x < W; ) { const w = 110 + r() * 210, h = 70 + r() * 150; box(x, w, h); if (r() < 0.3) dome(x + w / 2, w * 0.5, h); x += w - 6; }
      box(W * 0.36, 620, 250); dome(W * 0.36 + 310, 360, 250); dome(W * 0.36 + 110, 150, 250); dome(W * 0.36 + 510, 150, 250); minaret(W * 0.36 - 40, 560); minaret(W * 0.36 + 660, 560);
      box(W * 0.74, 380, 210); dome(W * 0.74 + 190, 240, 210); minaret(W * 0.74 + 420, 430); minaret(W * 0.1, 360);
      for (const [x, y] of lights) { g.fillStyle = rad(g, x, y, 0, 22, [[0, 'rgba(255,214,130,.95)'], [0.3, 'rgba(255,190,100,.4)'], [1, 'rgba(255,190,100,0)']]); g.fillRect(x - 22, y - 22, 44, 44); }
      g.save(); g.translate(0, hz * 2); g.scale(1, -1); g.globalAlpha = 0.55; g.drawImage(g.canvas, 0, hz - (H - hz), W, H - hz, 0, hz - (H - hz), W, H - hz); g.restore();
      g.fillStyle = grad(g, 0, hz, 0, H, [[0, 'rgba(10,10,40,.25)'], [1, 'rgba(3,4,18,.9)']]); g.fillRect(0, hz, W, H - hz);
      for (let i = 0; i < 1400; i++) { const t = Math.pow(r(), 1.5), y = hz + t * (H - hz); g.fillStyle = `rgba(255,200,150,${0.02 + r() * 0.05})`; g.fillRect(r() * W, y, 40 + t * 300, 1.5 + t * 2.5); }
      vignette(g, 0.4);
    },
    // 8. gold lights, out of focus, on black and violet
    bokeh(g) {
      const r = rng(81);
      g.fillStyle = grad(g, 0, 0, W, H, [[0, '#07040f'], [0.5, '#170a2e'], [1, '#05030a']]); g.fillRect(0, 0, W, H);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 260; i++) {
        const x = r() * W, y = H * (0.15 + Math.pow(r(), 0.8) * 0.85), R = 30 + Math.pow(r(), 2) * 230, a = 0.05 + r() * 0.16, warm = r();
        const c = warm < 0.7 ? `255,${190 + r() * 40 | 0},${90 + r() * 60 | 0}` : warm < 0.9 ? '190,140,255' : '120,220,230';
        g.fillStyle = rad(g, x, y, R * 0.55, R, [[0, `rgba(${c},${a})`], [0.86, `rgba(${c},${a * 1.5})`], [1, `rgba(${c},0)`]]);
        g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
      }
      for (let i = 0; i < 500; i++) { const x = r() * W, y = r() * H, s = 1 + r() * 3; g.fillStyle = `rgba(255,220,150,${0.2 + r() * 0.6})`; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); }
      g.restore();
      vignette(g, 0.55);
    },
  };
};

(async () => {
  const out = path.join(__dirname, '..', 'public', 'bg');
  fs.mkdirSync(out, { recursive: true });
  const only = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="3840" height="2160"></canvas>');
  const names = await page.evaluate(`window.S = (${SCENES.toString()})(); Object.keys(window.S)`);
  for (const name of names) {
    if (only.length && !only.includes(name)) continue;
    const data = await page.evaluate(async (n) => {
      const c = document.getElementById('c'), g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, c.width, c.height);
      window.S[n](g);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.86));
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
      return btoa(s);
    }, name);
    fs.writeFileSync(path.join(out, name + '.webp'), Buffer.from(data, 'base64'));
    console.log(name, Math.round(Buffer.from(data, 'base64').length / 1024) + ' KB');
  }
  await browser.close();
})();
