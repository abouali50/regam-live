// REGAM Live - picture mixer. Runs in a worker so it keeps producing frames
// while the studio tab is in the background (e.g. during a screen share).
// Inputs: "cam", "screen", "guest" (streams of VideoFrame). Output: one mixed stream.
'use strict';

const FPS = 25;
const inputs = {};           // name -> { reader, frame }
let writer = null, canvas = null, ctx = null, guestName = '', brand = 'REGAM Live', busy = false;

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
  else if (data.type === 'guestName') guestName = data.name || '';
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
function tile(f, x, y, w, h, label) {     // rounded picture-in-picture bubble
  const r = Math.round(h * 0.08);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  cover(f, x, y, w, h);
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
  const screen = frameOf('screen'), cam = frameOf('cam'), guest = frameOf('guest');
  const W = screen ? 1920 : 1280, H = screen ? 1080 : 720;
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }

  ctx.fillStyle = '#0c0f14';
  ctx.fillRect(0, 0, W, H);
  if (screen) {
    contain(screen, 0, 0, W, H);
    const tw = Math.round(W * 0.19), th = Math.round(tw * 0.75), m = Math.round(W * 0.012);
    let y = H - m - th;
    if (cam) { tile(cam, W - m - tw, y, tw, th, ''); y -= th + m; }
    if (guest) tile(guest, W - m - tw, y, tw, th, guestName);
  } else if (cam && guest) {
    cover(cam, 0, 0, W / 2 - 2, H);
    cover(guest, W / 2 + 2, 0, W / 2 - 2, H);
    if (guestName) nameTag(guestName, W / 2 + 2, 0, W / 2 - 2, H, Math.round(H * 0.04));
  } else if (cam || guest) {
    cover(cam || guest, 0, 0, W, H);
    if (!cam && guestName) nameTag(guestName, 0, 0, W, H, Math.round(H * 0.04));
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
