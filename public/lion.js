// REGAM Live - the lion of the big celebrations: drawn here (SVG) and brought to life with the browser's own
// animations. It rises with a halo of light, its mane bristles, it roars at the screen, then rises away.
// Original drawing. Author: Aziz Mernissi.
'use strict';
function makeLion() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const CX = 250, CY = 255;
  const svg = s('svg', { viewBox: '0 0 500 520', class: 'lion-svg', 'aria-hidden': 'true' });

  // ---- colours
  const defs = s('defs');
  const radial = (id, stops, attrs = {}) => s('radialGradient', { id, ...attrs }, ...stops.map(([o, c, a = 1]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': a })));
  const linear = (id, stops, attrs = {}) => s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1, ...attrs }, ...stops.map(([o, c]) => s('stop', { offset: o, 'stop-color': c })));
  defs.append(
    radial('lh-glow', [[0, '#fff3c0', 0.95], [0.35, '#ffcf4a', 0.55], [1, '#ff9a1f', 0]]),
    radial('lh-mane1', [[0, '#ffb43a'], [0.6, '#d9731b'], [1, '#7a3408']], { cx: '50%', cy: '45%', r: '60%' }),
    radial('lh-mane2', [[0, '#ffc85a'], [0.7, '#e88a24'], [1, '#9c4a10']], { cx: '50%', cy: '45%', r: '60%' }),
    radial('lh-mane3', [[0, '#ffd877'], [0.75, '#f3a23a'], [1, '#b8601a']], { cx: '50%', cy: '45%', r: '60%' }),
    radial('lh-face', [[0, '#ffe7a8'], [0.65, '#f7c66a'], [1, '#d99136']], { cx: '50%', cy: '40%', r: '65%' }),
    linear('lh-muzzle', [[0, '#fff7e4'], [1, '#f1d6a3']]),
    linear('lh-nose', [[0, '#7a3b1e'], [1, '#3a160a']]),
    radial('lh-iris', [[0, '#fff6a8'], [0.45, '#ffb515'], [1, '#a35c00']]),
    linear('lh-mouth', [[0, '#5a0d12'], [1, '#2a0306']]),
    linear('lh-tongue', [[0, '#ff7d8c'], [1, '#c9374c']]),
    s('filter', { id: 'lh-soft', x: '-20%', y: '-20%', width: '140%', height: '140%' }, s('feGaussianBlur', { stdDeviation: 6 })),
  );
  svg.append(defs);

  // ---- light behind: a glow and turning rays
  svg.append(s('circle', { cx: CX, cy: CY, r: 245, fill: 'url(#lh-glow)' }));
  const rays = s('g', { class: 'lion-rays', opacity: 0.55 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, w = 0.07;
    const p = (r, d) => `${CX + Math.cos(a + d) * r},${CY + Math.sin(a + d) * r}`;
    rays.append(s('polygon', { points: `${p(60, -w)} ${p(260, 0)} ${p(60, w)}`, fill: i % 2 ? '#fff2b3' : '#ffd25e' }));
  }
  svg.append(rays);

  // ---- the mane: three rings of flames, darker outside
  const flame = (r, len, a, wide) => {
    const tipX = CX + Math.cos(a) * (r + len), tipY = CY + Math.sin(a) * (r + len);
    const b1 = a - wide, b2 = a + wide, c = a + wide * 0.2;
    return `M${CX + Math.cos(b1) * r},${CY + Math.sin(b1) * r} Q${CX + Math.cos(c - wide) * (r + len * 0.75)},${CY + Math.sin(c - wide) * (r + len * 0.75)} ${tipX},${tipY} Q${CX + Math.cos(c + wide * 0.6) * (r + len * 0.55)},${CY + Math.sin(c + wide * 0.6) * (r + len * 0.55)} ${CX + Math.cos(b2) * r},${CY + Math.sin(b2) * r} Z`;
  };
  const mane = s('g', { class: 'lion-mane' });
  mane.append(s('circle', { cx: CX, cy: CY + 6, r: 212, fill: '#4a1a03', opacity: 0.45, filter: 'url(#lh-soft)' }));
  [[150, 84, 32, 'url(#lh-mane1)', 0], [134, 72, 28, 'url(#lh-mane2)', 0.15], [118, 58, 24, 'url(#lh-mane3)', 0.05]].forEach(([r, len, n, fill, off], ring) => {
    const g = s('g', { class: 'lion-ring lion-ring' + ring });
    for (let i = 0; i < n; i++) {
      const a = ((i + off * n) / n) * Math.PI * 2 + (ring * Math.PI) / n, l = len * (0.85 + ((i * 37) % 10) / 33);
      g.append(s('path', { d: flame(r - 30, l, a, (Math.PI / n) * 1.3), fill, stroke: '#6b2c05', 'stroke-width': 1.5, 'stroke-opacity': 0.35 }));
    }
    mane.append(g);
  });
  mane.append(s('circle', { cx: CX, cy: CY, r: 128, fill: '#c8661a' }));
  svg.append(mane);

  // ---- the head
  const head = s('g', { class: 'lion-head' });
  for (const dx of [-78, 78]) {                       // ears
    head.append(s('circle', { cx: CX + dx, cy: CY - 88, r: 30, fill: '#e9a64a', stroke: '#8a4510', 'stroke-width': 3 }));
    head.append(s('circle', { cx: CX + dx, cy: CY - 86, r: 16, fill: '#b96a2a' }));
  }
  head.append(s('path', { d: `M${CX - 108},${CY - 30} C${CX - 112},${CY - 120} ${CX + 112},${CY - 120} ${CX + 108},${CY - 30} C${CX + 112},${CY + 60} ${CX + 70},${CY + 118} ${CX},${CY + 124} C${CX - 70},${CY + 118} ${CX - 112},${CY + 60} ${CX - 108},${CY - 30} Z`, fill: 'url(#lh-face)', stroke: '#9a5214', 'stroke-width': 3 }));
  // forehead marks
  head.append(s('path', { d: `M${CX - 18},${CY - 78} Q${CX},${CY - 58} ${CX + 18},${CY - 78}`, fill: 'none', stroke: '#c47b2d', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.6 }));
  head.append(s('path', { d: `M${CX - 10},${CY - 95} Q${CX},${CY - 82} ${CX + 10},${CY - 95}`, fill: 'none', stroke: '#c47b2d', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.5 }));
  // eyes, with brows that frown when it roars
  const eyes = s('g', { class: 'lion-eyes' });
  for (const side of [-1, 1]) {
    const ex = CX + side * 44, ey = CY - 22;
    eyes.append(s('path', { d: `M${ex - 26},${ey} Q${ex},${ey - 22} ${ex + 26},${ey} Q${ex},${ey + 16} ${ex - 26},${ey} Z`, fill: '#2a1205' }));
    eyes.append(s('ellipse', { cx: ex, cy: ey - 2, rx: 15, ry: 12, fill: 'url(#lh-iris)' }));
    eyes.append(s('ellipse', { cx: ex, cy: ey - 2, rx: 4.5, ry: 10, fill: '#120500' }));
    eyes.append(s('circle', { cx: ex + side * -5, cy: ey - 8, r: 3.5, fill: '#fff' }));
  }
  head.append(eyes);
  const brows = s('g', { class: 'lion-brows' });
  for (const side of [-1, 1]) brows.append(s('path', { d: `M${CX + side * 18},${CY - 46} Q${CX + side * 44},${CY - 60} ${CX + side * 72},${CY - 44}`, fill: 'none', stroke: '#7a3b10', 'stroke-width': 7, 'stroke-linecap': 'round' }));
  head.append(brows);
  // the mouth: a dark opening with teeth and tongue, hidden until the roar
  const mouth = s('g', { class: 'lion-mouth' });
  mouth.append(s('path', { d: `M${CX - 46},${CY + 52} Q${CX},${CY + 40} ${CX + 46},${CY + 52} Q${CX + 40},${CY + 112} ${CX},${CY + 116} Q${CX - 40},${CY + 112} ${CX - 46},${CY + 52} Z`, fill: 'url(#lh-mouth)' }));
  mouth.append(s('path', { d: `M${CX - 26},${CY + 104} Q${CX},${CY + 84} ${CX + 26},${CY + 104} Q${CX},${CY + 116} ${CX - 26},${CY + 104} Z`, fill: 'url(#lh-tongue)' }));
  for (const side of [-1, 1]) {
    mouth.append(s('path', { d: `M${CX + side * 40},${CY + 52} L${CX + side * 30},${CY + 78} L${CX + side * 22},${CY + 50} Z`, fill: '#fffaf0' }));
    mouth.append(s('path', { d: `M${CX + side * 36},${CY + 110} L${CX + side * 28},${CY + 92} L${CX + side * 20},${CY + 112} Z`, fill: '#fffaf0' }));
  }
  head.append(mouth);
  // muzzle, nose and whiskers, above the mouth
  const muzzle = s('g', { class: 'lion-muzzle' });
  for (const side of [-1, 1]) muzzle.append(s('ellipse', { cx: CX + side * 24, cy: CY + 40, rx: 34, ry: 26, fill: 'url(#lh-muzzle)' }));
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) muzzle.append(s('circle', { cx: CX + side * (16 + i * 11), cy: CY + 36 + (i % 2) * 9, r: 2.4, fill: '#a36a33' }));
  muzzle.append(s('path', { d: `M${CX - 22},${CY + 8} Q${CX},${CY - 2} ${CX + 22},${CY + 8} Q${CX + 18},${CY + 28} ${CX},${CY + 34} Q${CX - 18},${CY + 28} ${CX - 22},${CY + 8} Z`, fill: 'url(#lh-nose)' }));
  muzzle.append(s('ellipse', { cx: CX - 7, cy: CY + 10, rx: 7, ry: 3.5, fill: '#fff', opacity: 0.35 }));
  for (const side of [-1, 1]) for (const [dy, len] of [[-4, 70], [6, 74], [16, 64]]) {
    muzzle.append(s('path', { d: `M${CX + side * 52},${CY + 38 + dy} Q${CX + side * (52 + len * 0.6)},${CY + 30 + dy * 1.6} ${CX + side * (52 + len)},${CY + 34 + dy * 2.4}`, fill: 'none', stroke: '#fff7e4', 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.85 }));
  }
  head.append(muzzle);
  // the chin, closing the mouth when it is shut
  head.append(s('path', { class: 'lion-chin', d: `M${CX - 30},${CY + 66} Q${CX},${CY + 92} ${CX + 30},${CY + 66}`, fill: 'none', stroke: '#9a5214', 'stroke-width': 4, 'stroke-linecap': 'round' }));
  svg.append(head);

  // ---- the sound of the roar: rings that leave the mouth
  const waves = s('g', { class: 'lion-waves' });
  for (let i = 0; i < 3; i++) waves.append(s('circle', { cx: CX, cy: CY + 80, r: 40, fill: 'none', stroke: '#fff3c0', 'stroke-width': 8, opacity: 0 }));
  svg.append(waves);

  const box = document.createElement('div');
  box.className = 'cheer-lion lion-live';
  box.append(svg);

  // ---- the life of it
  const play = () => {
    const opts = (ms, delay = 0, extra = {}) => ({ duration: ms, delay, fill: 'both', easing: 'ease-in-out', ...extra });
    // the easing goes on each step, not on the whole: the timeline stays in step for every part
    const anim = (node, frames, o) => (node.animate ? node.animate(frames.map((f) => ({ easing: o.easing || 'ease-in-out', ...f })), { ...o, easing: 'linear' }) : null);
    // rise into view, roar, rise away (about 4.8 s)
    anim(box, [
      { transform: 'translateY(40vh) scale(.25)', opacity: 0 },
      { transform: 'translateY(0) scale(1.06)', opacity: 1, offset: 0.14 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'translateY(0) scale(1.04)', opacity: 1, offset: 0.58 },
      { transform: 'translateY(-4vh) scale(.92)', opacity: 1, offset: 0.82 },
      { transform: 'translateY(-26vh) scale(.5)', opacity: 0 },
    ], opts(4800, 0, { easing: 'cubic-bezier(.3,.9,.3,1)' }));
    anim(svg.querySelector('.lion-rays'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(80deg)' }], { duration: 4800, fill: 'both' });
    // the head: a breath, a lean back, then the roar with a shake
    anim(head, [
      { transform: 'translateY(0) rotate(0)' },
      { transform: 'translateY(-8px) rotate(0)', offset: 0.18 },
      { transform: 'translateY(6px) rotate(0)', offset: 0.26 },
      { transform: 'translateY(-14px) rotate(-3deg)', offset: 0.32 },
      { transform: 'translateY(-14px) rotate(3deg)', offset: 0.38 },
      { transform: 'translateY(-14px) rotate(-3deg)', offset: 0.44 },
      { transform: 'translateY(-14px) rotate(2deg)', offset: 0.5 },
      { transform: 'translateY(-10px) rotate(0)', offset: 0.58 },
      { transform: 'translateY(0) rotate(0)' },
    ], { duration: 4800, fill: 'both', easing: 'ease-in-out' });
    // the mane bristles and the rings sway against each other
    anim(mane, [{ transform: 'scale(1)' }, { transform: 'scale(1)', offset: 0.26 }, { transform: 'scale(1.12)', offset: 0.34 }, { transform: 'scale(1.08)', offset: 0.5 }, { transform: 'scale(1)', offset: 0.62 }, { transform: 'scale(1)' }], { duration: 4800, fill: 'both' });
    svg.querySelectorAll('.lion-ring').forEach((g, i) => anim(g, [{ transform: 'rotate(0)' }, { transform: `rotate(${i % 2 ? -7 : 7}deg)` }, { transform: 'rotate(0)' }], { duration: 1200 + i * 250, iterations: 4, easing: 'ease-in-out' }));
    // the mouth opens wide for the roar, the brows frown, the chin drops
    const roarFrames = (open) => [{ transform: 'scaleY(0)', offset: 0 }, { transform: 'scaleY(0)', offset: 0.26 }, { transform: `scaleY(${open})`, offset: 0.31 }, { transform: `scaleY(${open * 0.9})`, offset: 0.5 }, { transform: `scaleY(${open})`, offset: 0.54 }, { transform: 'scaleY(0)', offset: 0.62 }, { transform: 'scaleY(0)', offset: 1 }];
    anim(mouth, roarFrames(1), { duration: 4800, fill: 'both' });
    anim(svg.querySelector('.lion-chin'), [{ opacity: 1 }, { opacity: 1, offset: 0.26 }, { opacity: 0, offset: 0.29 }, { opacity: 0, offset: 0.6 }, { opacity: 1, offset: 0.63 }, { opacity: 1 }], { duration: 4800, fill: 'both' });
    anim(svg.querySelector('.lion-muzzle'), [{ transform: 'translateY(0)' }, { transform: 'translateY(0)', offset: 0.26 }, { transform: 'translateY(-10px)', offset: 0.31 }, { transform: 'translateY(-10px)', offset: 0.58 }, { transform: 'translateY(0)', offset: 0.63 }, { transform: 'translateY(0)' }], { duration: 4800, fill: 'both' });
    anim(svg.querySelector('.lion-brows'), [{ transform: 'translateY(0)' }, { transform: 'translateY(0)', offset: 0.26 }, { transform: 'translateY(9px)', offset: 0.31 }, { transform: 'translateY(9px)', offset: 0.58 }, { transform: 'translateY(0)', offset: 0.63 }, { transform: 'translateY(0)' }], { duration: 4800, fill: 'both' });
    // a blink before the roar
    anim(eyes, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1)', offset: 0.12 }, { transform: 'scaleY(.1)', offset: 0.14 }, { transform: 'scaleY(1)', offset: 0.16 }, { transform: 'scaleY(1)' }], { duration: 4800, fill: 'both' });
    // the sound rings
    waves.querySelectorAll('circle').forEach((c, i) => anim(c, [{ r: 40, opacity: 0 }, { r: 40, opacity: 0, offset: 0.27 + i * 0.05 }, { r: 60, opacity: 0.85, offset: 0.3 + i * 0.05 }, { r: 260, opacity: 0, offset: 0.46 + i * 0.05 }, { r: 260, opacity: 0 }], { duration: 4800, fill: 'both' }));
  };
  return { node: box, play };
}
