# REGAM Live - voice service. POST /tts {"lang": "ar|fr|en", "text": "..."} answers a WAV file; GET /health tells which voices are ready.
# The voices are downloaded the first time the service starts (and kept in /models), so the picture of the site never waits for them.
# Author: Aziz Mernissi
import io, json, os, subprocess, sys, threading, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULTS = 'ar=ar_JO-kareem-medium,fr=fr_FR-siwis-medium,en=en_US-lessac-medium'
VOICES = dict(p.split('=', 1) for p in os.environ.get('TTS_VOICES', DEFAULTS).split(',') if '=' in p)
MODELS = os.environ.get('TTS_MODELS', '/models')
READY, LOCKS = {}, {lang: threading.Lock() for lang in VOICES}

def prepare(lang, name):
    from piper import PiperVoice
    path = os.path.join(MODELS, name + '.onnx')
    while True:
        try:
            if not os.path.exists(path):
                subprocess.run([sys.executable, '-m', 'piper.download_voices', name, '--download-dir', MODELS], check=True, timeout=900)
            READY[lang] = PiperVoice.load(path)
            print('voice ready:', lang, name, flush=True)
            return
        except Exception as e:
            print('voice not ready yet:', lang, name, str(e)[:200], flush=True)
            time.sleep(60)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, body, ctype='application/json'):
        if not isinstance(body, bytes): body = json.dumps(body).encode()
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == '/health': return self.reply(200, {lang: lang in READY for lang in VOICES})
        self.reply(404, {'error': 'not found'})
    def do_POST(self):
        if self.path != '/tts': return self.reply(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n <= 0 or n > 8192: return self.reply(400, {'error': 'bad size'})
            b = json.loads(self.rfile.read(n))
            lang, text = str(b.get('lang', '')), str(b.get('text', '')).strip()[:600]
        except Exception:
            return self.reply(400, {'error': 'bad request'})
        if not text or lang not in VOICES: return self.reply(400, {'error': 'bad request'})
        voice = READY.get(lang)
        if voice is None: return self.reply(503, {'error': 'voice not ready'})
        try:
            buf = io.BytesIO()
            with LOCKS[lang]:
                with wave.open(buf, 'wb') as w:
                    voice.synthesize_wav(text, w)
            self.reply(200, buf.getvalue(), 'audio/wav')
        except Exception as e:
            print('synthesis failed:', lang, str(e)[:200], flush=True)
            self.reply(500, {'error': 'synthesis failed'})

if __name__ == '__main__':
    os.makedirs(MODELS, exist_ok=True)
    for lang, name in VOICES.items():
        threading.Thread(target=prepare, args=(lang, name), daemon=True).start()
    print('voice service listening on :5002', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 5002), Handler).serve_forever()
