// REGAM Live - picture mixer. Runs in a worker so it keeps producing frames
// while the studio tab is in the background (e.g. during a screen share).
// Inputs: "cam", "screen", "guest1".."guest12" (streams of VideoFrame). Output: one mixed stream.
'use strict';

const FPS = 25;
const inputs = {};           // name -> { reader, frame }
let writer = null, canvas = null, ctx = null, brand = 'REGAM Live', busy = false;
const guestNames = {};        // slot -> name shown on the guest's picture
const guestOff = {};          // slot -> true when the guest's camera is off (a name card is shown instead)

onmessage = ({ data }) => {
  if (data.type === 'init') {
    writer = data.writable.getWriter();
    canvas = new OffscreenCanvas(1280, 720);
    ctx = canvas.getContext('2d', { alpha: false });
    brand = data.brand || brand;
    setInterval(draw, 1000 / FPS);
  } else if (data.type === 'input') {
    drop(data.name);
    pump(data.name, data.readable.getReader());
  } else if (data.type === 'remove') drop(data.name);
  else if (data.type === 'guestName') guestNames[data.slot] = data.name || '';
  else if (data.type === 'guestCam') guestOff[data.slot] = !data.on;
};

function drop(name) {
  const slot = inputs[name];
  if (!slot) return;
  delete inputs[name];
  slot.reader.cancel().catch(() => {});
  if (slot.frame) slot.frame.close();
}
async function pump(name, reader) {
  const slot = (inputs[name] = { reader, frame: null });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (inputs[name] !== slot) { value.close(); break; }
      if (slot.frame) slot.frame.close();
      slot.frame = value;                 // keep only the newest frame
    }
  } catch { /* track ended */ }
  if (inputs[name] === slot) drop(name);
}

const frameOf = (name) => (inputs[name] && inputs[name].frame) || null;

function cover(f, x, y, w, h) {           // fill the box, crop the overflow
  const fw = f.displayWidth, fh = f.displayHeight, s = Math.max(w / fw, h / fh);
  const sw = w / s, sh = h / s;
  ctx.drawImage(f, (fw - sw) / 2, (fh - sh) / 2, sw, sh, x, y, w, h);
}
function contain(f, x, y, w, h) {         // show everything, letterbox
  const fw = f.displayWidth, fh = f.displayHeight, s = Math.min(w / fw, h / fh);
  ctx.drawImage(f, x + (w - fw * s) / 2, y + (h - fh * s) / 2, fw * s, fh * s);
}
function card(label, x, y, w, h) {        // someone without a camera: their initial on a plain card
  ctx.fillStyle = '#1a2130';
  ctx.fillRect(x, y, w, h);
  const r = Math.min(w, h) * 0.2;
  ctx.fillStyle = '#e9b949';
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14181f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, "Segoe UI", Tahoma, sans-serif`;
  ctx.fillText([...(label || '?').trim()][0] || '?', x + w / 2, y + h / 2 + r * 0.06);
  ctx.textAlign = 'start';
}
const picture = (p, x, y, w, h) => (p.frame ? cover(p.frame, x, y, w, h) : card(p.label, x, y, w, h));
function tile(f, x, y, w, h, label) {     // rounded picture-in-picture bubble
  const r = Math.round(h * 0.08);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  picture({ frame: f, label }, x, y, w, h);
  if (label) nameTag(label, x, y, w, h, Math.max(14, Math.round(h * 0.11)));
  ctx.restore();
  ctx.lineWidth = Math.max(2, h * 0.012); ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();
}
function nameTag(text, x, y, w, h, size) {
  ctx.font = `600 ${size}px system-ui, "Segoe UI", Tahoma, sans-serif`;
  ctx.textBaseline = 'middle';
  const pad = size * 0.6, tw = Math.min(ctx.measureText(text).width, w - pad * 3);
  const bx = x + pad * 0.7, by = y + h - size * 1.9, bh = size * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.beginPath(); ctx.roundRect(bx, by, tw + pad * 2, bh, bh / 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx + pad, by + bh / 2 + 1, tw);
}

async function draw() {
  if (!writer || busy) return;
  const screen = frameOf('screen'), cam = frameOf('cam');
  // the people on screen: the host first, then the guests in the order of their slots
  const people = [];
  if (cam) people.push({ frame: cam, label: '' });
  for (let slot = 1; slot <= 12; slot++) { const f = frameOf('guest' + slot); if (f) people.push({ frame: guestOff[slot] ? null : f, label: guestNames[slot] || '' }); }
  const W = screen ? 1920 : 1280, H = screen ? 1080 : 720;
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }

  ctx.fillStyle = '#0c0f14';
  ctx.fillRect(0, 0, W, H);
  if (screen) {
    // the screen (or the whiteboard) fills the picture; people are small tiles down the right side
    contain(screen, 0, 0, W, H);
    const m = Math.round(W * 0.012), n = people.length;
    const perCol = n > 6 ? Math.ceil(n / 2) : Math.max(n, 1);            // more than six: two columns
    const tw = Math.round(Math.min(W * 0.19, ((H - m * (perCol + 1)) / perCol) / 0.75)), th = Math.round(tw * 0.75);
    people.forEach((p, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      tile(p.frame, W - (m + tw) * (col + 1), H - (m + th) * (row + 1), tw, th, p.label);
    });
  } else if (people.length) {
    // no screen: an even grid. 1 full, 2 side by side, up to 4 in two columns, up to 9 in three, then four
    const n = people.length, cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols), gap = n === 1 ? 0 : 4;
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
    people.forEach((p, i) => {
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols);
      const x0 = (W - (inRow * cw + (inRow - 1) * gap)) / 2;            // centre a short last row
      const x = x0 + (i - row * cols) * (cw + gap), y = row * (ch + gap);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
      picture(p, x, y, cw, ch);
      if (p.label) nameTag(p.label, x, y, cw, ch, Math.round(H * (rows > 1 ? 0.034 : 0.04)));
      ctx.restore();
    });
  } else {
    ctx.fillStyle = '#e9e4d8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(H * 0.11)}px system-ui, sans-serif`;
    ctx.fillText(brand, W / 2, H / 2);
    ctx.textAlign = 'start';
  }

  busy = true;
  const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
  try { await writer.write(frame); } catch { /* output closed */ }
  frame.close();
  busy = false;
}
