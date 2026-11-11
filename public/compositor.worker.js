// REGAM Live - picture mixer. Runs in a worker so it keeps producing frames
// while the studio tab is in the background (e.g. during a screen share).
// Inputs: "cam", "screen", "guest1".."guest12" (streams of VideoFrame). Output: one mixed stream.
'use strict';
importScripts('/mixer.js');

const FPS = 25;
const inputs = {};           // name -> { reader, frame }
let writer = null, canvas = null, painter = null, busy = false;
const early = [];             // names and camera states that arrive before the mixer starts

onmessage = ({ data }) => {
  if (data.type === 'init') {
    writer = data.writable.getWriter();
    canvas = new OffscreenCanvas(1280, 720);
    painter = createPainter(canvas, { brand: data.brand });
    early.splice(0).forEach(note);
    setInterval(draw, 1000 / FPS);
  } else if (data.type === 'input') {
    drop(data.name);
    pump(data.name, data.readable.getReader());
  } else if (data.type === 'remove') drop(data.name);
  else if (painter) note(data); else early.push(data);
};
function note(data) {
  if (data.type === 'guestName') painter.state.names[data.slot] = data.name || '';
  else if (data.type === 'guestCam') painter.state.off[data.slot] = !data.on;
}

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

async function draw() {
  if (!writer || busy) return;
  painter.paint(frameOf);

  busy = true;
  const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
  try { await writer.write(frame); } catch { /* output closed */ }
  frame.close();
  busy = false;
}
