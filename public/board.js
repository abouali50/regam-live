// REGAM Live - whiteboard for the studio.
// The host draws and types on a 1920x1080 canvas, on white or over a document opened on it (PDF,
// picture, Word or text file, video, sound); the canvas is sent into the broadcast mixer exactly like a shared screen.
'use strict';

function createBoard(canvas, typer) {
  const W = 1920, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let items = [];                   // what is drawn on the page being shown, in drawing order
  // A document opened on the board (PDF, picture, Word or text file, video, sound). It lies under the
  // drawings; each of its pages keeps its own drawings. Nothing is uploaded: the file is read in the
  // studio's browser and reaches the viewers as part of the picture (and of the sound, for video and audio).
  const ink = document.createElement('canvas'); ink.width = W; ink.height = H;       // the drawings, apart, so the eraser never rubs out the document
  const ictx = ink.getContext('2d');
  const blank = items;              // the drawings of the plain white board
  let doc = null;                   // { kind: 'pages' | 'video' | 'audio', name, count, page, draw(i), marks: [items per page], el }
  let onDoc = () => {};             // tells the studio the document, page or playback changed
  let fast = null;                  // quick repaint while a video plays
  let tool = 'pen', color = '#14181f', size = 2;        // size: 1 small, 2 medium, 3 large
  let stroke = null;                // line being drawn
  let text = null;                  // text being typed { x, y, value, color, px }
  let caretOn = true;
  let voiceOn = false, nextY = 90;    // dictation in progress; where the next spoken line starts

  const PEN = { 1: 4, 2: 8, 3: 14 };
  const MARK = { 1: 24, 2: 38, 3: 56 };
  const ERASE = { 1: 30, 2: 60, 3: 110 };
  const FONT = { 1: 40, 2: 60, 3: 88 };
  const isRtl = (s) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s);

  function drawLine(it) {
    ictx.save();
    ictx.lineCap = 'round'; ictx.lineJoin = 'round';
    ictx.strokeStyle = it.color; ictx.lineWidth = it.width; ictx.globalAlpha = it.alpha;
    if (it.erase) ictx.globalCompositeOperation = 'destination-out';
    ictx.beginPath();
    const p = it.points;
    ictx.moveTo(p[0].x, p[0].y);
    if (p.length === 1) ictx.lineTo(p[0].x + 0.01, p[0].y);
    for (let i = 1; i < p.length; i++) ictx.lineTo(p[i].x, p[i].y);
    ictx.stroke();
    ictx.restore();
  }
  function drawText(it, caret) {
    ictx.save();
    ictx.fillStyle = it.color;
    ictx.font = `600 ${it.px}px "SF Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif`;
    ictx.textBaseline = 'top';
    const lines = it.value.split('\n');
    lines.forEach((line, i) => {
      const rtl = isRtl(line);
      ictx.direction = rtl ? 'rtl' : 'ltr';
      ictx.textAlign = rtl ? 'right' : 'left';
      const y = it.y + i * it.px * 1.3;
      ictx.fillText(line, it.x, y);
      if (caret && i === lines.length - 1) {
        const w = ictx.measureText(line).width;
        ictx.fillRect(rtl ? it.x - w - 6 : it.x + w + 4, y, 4, it.px * 1.05);
      }
    });
    ictx.restore();
  }
  const fit = (w, h) => { const z = Math.min(W / w, H / h); return [(W - w * z) / 2, (H - h * z) / 2, w * z, h * z]; };
  const clock = (t) => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function drawDoc() {
    if (doc.kind === 'pages') { const pg = doc.draw(doc.page); if (pg) ctx.drawImage(pg, ...fit(pg.width, pg.height)); return; }
    const m = doc.el;
    if (doc.kind === 'video') {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (m.videoWidth) ctx.drawImage(m, ...fit(m.videoWidth, m.videoHeight));
      return;
    }
    // a sound: its name, and how far it has played
    ctx.fillStyle = '#0f1535'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd84a'; ctx.font = '700 150px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('♪', W / 2, 330);
    ctx.fillStyle = '#fff'; ctx.font = '600 56px "Segoe UI", "Noto Sans Arabic", system-ui, sans-serif';
    ctx.fillText(doc.name.length > 48 ? doc.name.slice(0, 47) + '…' : doc.name, W / 2, 520);
    const d = m.duration || 0, x = 360, w = W - 720;
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x, 640, w, 14);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, 640, d ? w * Math.min(1, m.currentTime / d) : 0, 14);
    ctx.fillStyle = '#cfd4ff'; ctx.font = '500 40px system-ui, sans-serif';
    ctx.fillText(clock(m.currentTime) + ' / ' + clock(d), W / 2, 720);
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (doc) drawDoc();
    ictx.clearRect(0, 0, W, H);
    for (const it of items) (it.kind === 'text' ? drawText(it, false) : drawLine(it));
    if (stroke) drawLine(stroke);
    if (text) drawText(text, caretOn);
    ctx.drawImage(ink, 0, 0);
  }

  // ---- drawing with the mouse / trackpad / pen
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  function commitText() {
    if (!text) return;
    if (text.value.trim()) {
      items.push({ kind: 'text', x: text.x, y: text.y, value: text.value.replace(/\s+$/, ''), color: text.color, px: text.px });
      nextY = text.y + text.value.split('\n').length * text.px * 1.3 + 14;
      if (nextY > H - 160) nextY = 90;
    }
    text = null; typer.value = ''; typer.blur();
    render();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = at(e);
    if (tool === 'text') {
      commitText();
      text = { x: p.x, y: p.y - FONT[size] / 2, value: '', color, px: FONT[size] };
      typer.value = '';
      typer.focus();
      setTimeout(() => typer.focus(), 0);
      render();
      return;
    }
    commitText();
    canvas.setPointerCapture(e.pointerId);
    stroke = tool === 'eraser' ? { kind: 'line', erase: true, color: '#ffffff', width: ERASE[size], alpha: 1, points: [p] }
      : tool === 'marker' ? { kind: 'line', color: '#ffd84a', width: MARK[size], alpha: 0.45, points: [p] }
        : { kind: 'line', color, width: PEN[size], alpha: 1, points: [p] };
    render();
  });
  // a click on the board must not take the keyboard away from the text being typed
  canvas.addEventListener('mousedown', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) stroke.points.push(at(ev));
    render();
  });
  const endStroke = () => { if (stroke) { items.push(stroke); stroke = null; render(); } };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // ---- typing: a real (invisible) text field receives the keys, so accents,
  // Arabic and every keyboard layout work; the canvas mirrors what is typed.
  typer.addEventListener('input', () => { if (text) { text.value = typer.value; text.fixed = typer.value; caretOn = true; render(); } });
  typer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); commitText(); } });
  typer.addEventListener('blur', () => setTimeout(() => { if (text && !voiceOn && document.activeElement !== typer) commitText(); }, 150));

  // ---- documents on the board
  const info = () => (doc ? { kind: doc.kind, name: doc.name, page: doc.page + 1, pages: doc.count,
    playing: !!doc.el && !doc.el.paused && !doc.el.ended, time: doc.el ? doc.el.currentTime : 0, duration: doc.el ? doc.el.duration || 0 : 0 } : null);
  const told = () => { render(); onDoc(info()); };
  function setFast(on) { clearInterval(fast); fast = on ? setInterval(render, 40) : null; }
  function closeDoc() {
    commitText();
    if (doc && doc.el) { doc.el.pause(); URL.revokeObjectURL(doc.el.src); doc.el.removeAttribute('src'); doc.el.load(); doc.el.remove(); }
    if (doc && doc.close) doc.close();
    setFast(false);
    doc = null; items = blank;
    told();
  }
  function show(next) {
    closeDoc();
    doc = next; doc.page = 0;
    if (doc.kind === 'pages') { doc.marks = Array.from({ length: doc.count }, () => []); items = doc.marks[0]; } else items = [];
    told();
  }
  function goPage(n) {
    if (!doc || doc.kind !== 'pages') return;
    n = Math.max(0, Math.min(doc.count - 1, n));
    commitText();
    doc.page = n; items = doc.marks[n];
    told();
  }
  const kindOf = (file) => {
    const n = file.name.toLowerCase(), t = file.type || '';
    return t === 'application/pdf' || n.endsWith('.pdf') ? 'pdf' : t.startsWith('image/') ? 'image' : t.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(n) ? 'video'
      : t.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac)$/.test(n) ? 'audio' : n.endsWith('.docx') ? 'docx' : t.startsWith('text/') || /\.(txt|md|csv)$/.test(n) ? 'text' : '';
  };
  const script = (src) => new Promise((ok, bad) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => bad(new Error('load')); document.head.append(el); });
  async function openPdf(file) {
    if (!window.pdfjsLib) { await script('/vendor/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; }
    const task = window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }), pdf = await task.promise;
    const pages = [], asked = new Set();
    const need = (i) => {                        // a page is drawn the first time it is shown, then kept
      if (asked.has(i) || i < 0 || i >= pdf.numPages) return;
      asked.add(i);
      pdf.getPage(i + 1).then(async (page) => {
        const base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(W / base.width, H / base.height) * 1.5 });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        pages[i] = c; render();
      }).catch(() => asked.delete(i));
    };
    return { kind: 'pages', name: file.name, count: pdf.numPages, draw: (i) => { need(i); need(i + 1); return pages[i]; }, close: () => task.destroy() };
  }
  async function openImage(file) {
    const img = new Image(), url = URL.createObjectURL(file);
    try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
    return { kind: 'pages', name: file.name, count: 1, draw: () => img };
  }
  // Text laid out on white pages (text files, and the text of Word files: the words, not the layout).
  function textPages(name, paras) {
    const pages = [], M = 130, LH = 62, font = '500 44px "SF Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif';
    let c = null, g = null, y = 0;
    const page = () => { c = document.createElement('canvas'); c.width = W; c.height = H; g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#14181f'; g.font = font; g.textBaseline = 'top'; y = 90; pages.push(c); };
    page();
    for (const para of paras) {
      const rtl = isRtl(para), words = para.split(/\s+/).filter(Boolean), lines = [];
      let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (line && g.measureText(t).width > W - 2 * M) { lines.push(line); line = w; } else line = t; }
      lines.push(line);
      for (const l of lines) {
        if (y + LH > H - 80) page();
        g.direction = rtl ? 'rtl' : 'ltr'; g.textAlign = rtl ? 'right' : 'left';
        g.fillText(l, rtl ? W - M : M, y);
        y += LH;
      }
      y += 22;
      if (pages.length >= 200) break;
    }
    return { kind: 'pages', name, count: pages.length, draw: (i) => pages[i] };
  }
  // A .docx is a zip; its text is in word/document.xml.
  async function docxParas(file) {
    const buf = await file.arrayBuffer(), v = new DataView(buf), u8 = new Uint8Array(buf);
    let e = buf.byteLength - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a docx');
    let p = v.getUint32(e + 16, true);
    const n = v.getUint16(e + 10, true), dec = new TextDecoder();
    for (let i = 0; i < n && v.getUint32(p, true) === 0x02014b50; i++) {
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), at = v.getUint32(p + 42, true);
      if (dec.decode(u8.subarray(p + 46, p + 46 + nl)) === 'word/document.xml') {
        const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true), raw = u8.subarray(start, start + size);
        const xml = method === 0 ? dec.decode(raw) : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
        const dom = new DOMParser().parseFromString(xml, 'application/xml');
        return [...dom.getElementsByTagName('w:p')].map((par) => [...par.querySelectorAll('*')].map((x) => (x.tagName === 'w:t' ? x.textContent : x.tagName === 'w:tab' ? ' ' : x.tagName === 'w:br' ? ' ' : '')).join('')).filter((t) => t.trim());
      }
      p += 46 + nl + xl + cl;
    }
    throw new Error('not a docx');
  }
  function openMedia(file, kind) {
    return new Promise((ok, bad) => {
      const el = document.createElement(kind);
      el.playsInline = true; el.preload = 'auto'; el.src = URL.createObjectURL(file);
      el.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none';     // on the page, so phones keep decoding it
      document.body.append(el);
      el.onloadedmetadata = () => ok({ kind, name: file.name, count: 1, el });
      el.onerror = () => { URL.revokeObjectURL(el.src); bad(new Error('cannot play')); };
      el.onplay = () => { setFast(kind === 'video'); onDoc(info()); };
      el.onpause = el.onended = () => { setFast(false); told(); };
      el.onseeked = () => told();
      el.ontimeupdate = () => { if (kind === 'audio') render(); onDoc(info()); };
    });
  }

  let ticker = null, track = null;
  return {
    // Puts a file on the board. Returns '' or why it could not: 'type' (not a kind the board can show), 'read'.
    async open(file) {
      const k = kindOf(file);
      if (!k) return 'type';
      try {
        show(k === 'pdf' ? await openPdf(file) : k === 'image' ? await openImage(file) : k === 'docx' ? textPages(file.name, await docxParas(file))
          : k === 'text' ? textPages(file.name, (await file.text()).split(/\r?\n/).filter((t) => t.trim())) : await openMedia(file, k));
        return '';
      } catch (err) { console.error('document', err); return 'read'; }
    },
    closeDoc, info,
    page(delta) { if (doc) goPage(doc.page + delta); },
    toggle() { if (doc && doc.el) { if (doc.el.paused || doc.el.ended) doc.el.play().catch(() => {}); else doc.el.pause(); } },
    seek(frac) { if (doc && doc.el && doc.el.duration) doc.el.currentTime = Math.max(0, Math.min(1, frac)) * doc.el.duration; },
    get media() { return doc && doc.el ? doc.el : null; },
    set onDoc(fn) { onDoc = fn; },
    get track() { return track; },
    start() {
      render();
      track = canvas.captureStream(25).getVideoTracks()[0];
      // repaint regularly: keeps the caret blinking and keeps frames flowing to the mixer
      ticker = setInterval(() => { caretOn = !caretOn; render(); }, 500);
      setTimeout(render, 100);
      return track;
    },
    stop() {
      commitText();
      if (doc && doc.el) doc.el.pause();
      setFast(false);
      clearInterval(ticker);
      if (track) { track.stop(); track = null; }
    },
    setTool(t) { commitText(); tool = t; canvas.style.cursor = t === 'text' ? 'text' : 'crosshair'; },
    setColor(c) { color = c; if (text) { text.color = c; render(); } },
    setSize(n) { size = n; if (text) { text.px = FONT[n]; render(); } },
    // Dictation: spoken words land in the text being typed, or start a new line of text.
    voiceState(on) {
      voiceOn = on;
      if (on) {
        if (!text) text = { x: 110, y: nextY, value: '', color, px: FONT[size] };
        text.fixed = text.value ? text.value.replace(/\s+$/, '') + ' ' : '';
      } else if (text) typer.focus();                      // keep typing, or press Escape to finish
      render();
    },
    voice(fin, interim) {
      if (!text) return;
      if (fin) text.fixed = (text.fixed || '') + fin.trim() + ' ';
      text.value = (text.fixed || '') + interim;
      typer.value = text.value; caretOn = true;
      render();
    },
    undo() { if (text) { text = null; typer.value = ''; } else items.pop(); render(); },
    clear() { text = null; typer.value = ''; items.length = 0; render(); },
    get count() { return items.length; },
  };
}
