// REGAM Live - whiteboard for the studio.
// The host draws and types on a 1920x1080 canvas; the canvas is sent into the
// broadcast mixer exactly like a shared screen.
'use strict';

function createBoard(canvas, typer) {
  const W = 1920, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const items = [];                 // everything on the board, in drawing order
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
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = it.color; ctx.lineWidth = it.width; ctx.globalAlpha = it.alpha;
    ctx.beginPath();
    const p = it.points;
    ctx.moveTo(p[0].x, p[0].y);
    if (p.length === 1) ctx.lineTo(p[0].x + 0.01, p[0].y);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.stroke();
    ctx.restore();
  }
  function drawText(it, caret) {
    ctx.save();
    ctx.fillStyle = it.color;
    ctx.font = `600 ${it.px}px "SF Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const lines = it.value.split('\n');
    lines.forEach((line, i) => {
      const rtl = isRtl(line);
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = rtl ? 'right' : 'left';
      const y = it.y + i * it.px * 1.3;
      ctx.fillText(line, it.x, y);
      if (caret && i === lines.length - 1) {
        const w = ctx.measureText(line).width;
        ctx.fillRect(rtl ? it.x - w - 6 : it.x + w + 4, y, 4, it.px * 1.05);
      }
    });
    ctx.restore();
  }
  function render() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (const it of items) (it.kind === 'text' ? drawText(it, false) : drawLine(it));
    if (stroke) drawLine(stroke);
    if (text) drawText(text, caretOn);
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
    stroke = tool === 'eraser' ? { kind: 'line', color: '#ffffff', width: ERASE[size], alpha: 1, points: [p] }
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

  let ticker = null, track = null;
  return {
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
