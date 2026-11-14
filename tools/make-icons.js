// REGAM Live - draws the home-screen icons (public/icon-*.png). Run: node tools/make-icons.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  for (const n of [512, 192, 180]) {
    await p.setViewportSize({ width: n, height: n });
    await p.setContent(`<body style="margin:0;width:${n}px;height:${n}px;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#5a4ef0,#1c2560 55%,#05060a);font-family:Arial,Helvetica,sans-serif">
      <div style="text-align:center;line-height:1">
        <div style="color:#fff;font-weight:900;font-size:${n * 0.2}px;letter-spacing:${n * 0.004}px">REGAM</div>
        <div style="display:inline-block;margin-top:${n * 0.05}px;padding:${n * 0.03}px ${n * 0.07}px;border-radius:${n * 0.05}px;background:#ef4444;color:#fff;font-weight:900;font-size:${n * 0.13}px">LIVE</div>
      </div></body>`);
    await p.screenshot({ path: path.join(__dirname, '..', 'public', `icon-${n}.png`) });
  }
  await b.close();
})();
