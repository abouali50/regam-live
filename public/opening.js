// REGAM Live - the opening of a live: the flag, the national anthem, the motto, and (when they were added) the photo and the video.
// It is played to the audience when a live starts, can be skipped, and ends by itself with the anthem.
'use strict';
(function () {
  let info = null, running = false;
  const load = () => info ? Promise.resolve(info) : fetch('/api/opening', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ on: false })).then((d) => (info = d));
  const css = `
  .opening{position:fixed;inset:0;z-index:2000;background:#5a0000;overflow:hidden;opacity:0;transition:opacity 1s ease;display:flex;align-items:center;justify-content:center;direction:rtl}
  .opening.on{opacity:1}
  .opening .op-flag,.opening .op-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .opening .op-flag{background:url(/opening/flag.webp) center/cover no-repeat;animation:op-zoom 70s ease-out forwards;transition:opacity 2s ease}
  .opening .op-video{opacity:0;transition:opacity 2s ease}
  .opening .op-shade{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 40%,rgba(0,0,0,.55) 100%),linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0) 40%)}
  .opening .op-king{position:relative;width:min(34vw,34vh);aspect-ratio:3/4;border-radius:50% / 42%;object-fit:cover;border:3px solid #d8b24c;box-shadow:0 0 40px rgba(0,0,0,.6),0 0 0 8px rgba(216,178,76,.25);opacity:0;transform:scale(.94);transition:opacity 2s ease,transform 6s ease;margin-bottom:6vh}
  .opening .op-king.on{opacity:1;transform:scale(1)}
  .opening .op-motto{position:absolute;bottom:9vh;left:0;right:0;text-align:center;color:#fff;font:700 clamp(26px,5vw,56px)/1.3 'Amiri','Scheherazade New','Noto Naskh Arabic',serif;letter-spacing:.04em;text-shadow:0 2px 18px rgba(0,0,0,.8);opacity:0;transition:opacity 2.4s ease 1.2s}
  .opening.on .op-motto{opacity:1}
  .opening .op-bar{position:absolute;left:0;bottom:0;height:4px;width:100%;background:rgba(255,255,255,.18)}
  .opening .op-bar i{display:block;height:100%;width:0;background:#d8b24c}
  .opening .op-skip,.opening .op-tap{position:absolute;border:1px solid rgba(255,255,255,.7);background:rgba(0,0,0,.45);color:#fff;border-radius:999px;padding:8px 18px;font:600 15px system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px)}
  .opening .op-skip{top:max(14px,env(safe-area-inset-top));left:14px}
  .opening .op-tap{bottom:18vh;left:50%;transform:translateX(-50%)}
  @keyframes op-zoom{from{transform:scale(1)}to{transform:scale(1.12)}}
  @media (prefers-reduced-motion:reduce){.opening .op-flag{animation:none}}`;
  function play(opts = {}) {
    const from = Math.max(0, Number(opts.from) || 0);
    return load().then((d) => new Promise((done) => {
      if (running || !d.on) return done(false);
      running = true;
      if (!document.getElementById('opening-css')) { const st = document.createElement('style'); st.id = 'opening-css'; st.textContent = css; document.head.append(st); }
      const el = (tag, cls, attrs = {}) => Object.assign(document.createElement(tag), { className: cls }, attrs);
      const root = el('div', 'opening'), bar = el('div', 'op-bar'), fill = document.createElement('i');
      bar.append(fill);
      const flag = el('div', 'op-flag');
      root.append(flag);
      let video = null;
      if (d.video) { video = el('video', 'op-video'); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.src = '/opening/' + d.video; root.append(video); }
      root.append(el('div', 'op-shade'));
      let king = null;
      if (d.king) { king = el('img', 'op-king', { alt: '', src: '/opening/' + d.king }); root.append(king); }
      root.append(el('div', 'op-motto', { textContent: 'الله · الوطن · الملك' }));
      const skip = el('button', 'op-skip', { type: 'button', textContent: (window.T || ((x) => x))('تخطى') });
      root.append(skip, bar);
      const audio = new Audio('/opening/hymne.mp3'); audio.preload = 'auto';
      if (from > 0) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(from, Math.max(0, (audio.duration || 68) - 2)); } catch {} }, { once: true });      // came in late: joins the anthem where it is
      let over = false, timer = null;
      const finish = () => {
        if (over) return; over = true; clearInterval(timer);
        try { audio.pause(); } catch {}
        root.classList.remove('on');
        setTimeout(() => { root.remove(); if (video) video.src = ''; running = false; done(true); }, 1000);
      };
      skip.onclick = finish;
      audio.onended = finish;
      audio.onerror = () => setTimeout(finish, 10000);            // no sound: the picture alone, ten seconds
      document.body.append(root);
      requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('on'); if (king) setTimeout(() => king.classList.add('on'), 800); }));
      const start = () => audio.play().then(() => true, () => false);
      start().then((ok) => {
        if (ok) return;
        // the browser wants a touch before it lets sound play: one button, and the anthem starts
        const tap = el('button', 'op-tap', { type: 'button', textContent: (window.T || ((x) => x))('المس باش تسمع النشيد') });
        tap.onclick = () => { tap.remove(); start(); };
        root.append(tap);
      });
      timer = setInterval(() => {
        const t = audio.currentTime || 0, len = audio.duration || 68;
        fill.style.width = Math.min(100, (t / len) * 100) + '%';
        if (video && t > 14 && !video.dataset.on) { video.dataset.on = '1'; video.play().catch(() => {}); video.style.opacity = 1; flag.style.opacity = 0; }
      }, 250);
    }));
  }
  window.RegamOpening = { play, preload: load };
})();
