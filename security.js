// REGAM Live - protections shared by every request.
//   headers : what each answer tells the browser (HTTPS only, no framing by other sites, which
//             scripts and addresses the pages may use)
//   journal : a file of suspicious events (failed sign-ins, blocked addresses, changes made by the
//             administrator), shown in the administration page
//   limits  : how many requests one network address may send
// Author: Aziz Mernissi
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function security({ env, dataDir, hlsPublicUrl = '', onBurst = () => {} }) {
  const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
  const cdn = originOf(hlsPublicUrl);
  const CSP_MODE = ['off', 'report'].includes(env.CSP) ? env.CSP : 'on';     // CSP=report only tells, CSP=off sends none

  // ---------------------------------------------------------------- headers --
  // The pages only run their own scripts (no script written inside a page, none from another site).
  // 'wasm-unsafe-eval' is for the virtual background (its picture model is WebAssembly).
  function policy(host) {
    const local = /^(localhost|127\.)/.test(host);
    const ws = host ? `${local ? 'ws' : 'wss'}://${host}` : '';
    return [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob: https:",                 // the waiting sound comes from another site
      `connect-src 'self' data: blob: ${ws} ${cdn}`.replace(/\s+/g, ' ').trim(),
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ');
  }
  function headers(req, res) {
    const host = /^[a-z0-9.-]+(:\d+)?$/i.test(String(req.headers.host || '')) ? String(req.headers.host) : '';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
    // a browser that came once over HTTPS never comes back over plain HTTP (not said on a test machine)
    if (host && !/^(localhost|127\.)/.test(host)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (CSP_MODE !== 'off') res.setHeader(CSP_MODE === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', policy(host));
  }

  // ---------------------------------------------------------------- journal --
  // One line per event: { at, kind, ip, ... }. Never a password, a code or a key.
  const LOG = path.join(dataDir, 'security.log'), LOG_MAX = 5 * 1024 * 1024;
  const recent = [];
  try { for (const l of fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-300)) { try { recent.push(JSON.parse(l)); } catch { /* a broken line */ } } } catch { /* no journal yet */ }
  const short = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
  const bursts = new Map();                        // kind -> [timestamps] of the last quarter of an hour
  function audit(kind, ip, detail = {}) {
    const line = { at: Date.now(), kind: short(kind), ip: short(ip) };
    for (const [k, v] of Object.entries(detail)) line[k] = typeof v === 'number' || typeof v === 'boolean' ? v : short(v);
    recent.push(line); if (recent.length > 300) recent.shift();
    fs.stat(LOG, (e, st) => {
      const write = () => fs.appendFile(LOG, JSON.stringify(line) + '\n', { mode: 0o600 }, () => {});
      if (!e && st.size > LOG_MAX) fs.rename(LOG, LOG + '.1', write); else write();
    });
    // many failures in a short time, from wherever they come: the administrator is told (once a day, by the caller)
    if (/fail|blocked|denied/.test(kind)) {
      const now = Date.now(), list = (bursts.get(kind) || []).filter((t) => t > now - 15 * 60e3);
      list.push(now); bursts.set(kind, list);
      if (list.length === 30) onBurst(kind, list.length);
    }
  }
  const view = () => ({ list: recent.slice(-200).reverse(), csp: CSP_MODE });

  // ----------------------------------------------------------------- limits --
  // A counter per key (an address, an account...) over a sliding window.
  const hits = new Map();
  function allowed(key, max, windowMs) {
    const now = Date.now(), list = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    return true;
  }
  const count = (key, windowMs) => (hits.get(key) || []).filter((t) => t > Date.now() - windowMs).length;
  setInterval(() => { const now = Date.now(); for (const [k, l] of hits) if (!l.some((t) => t > now - 3600e3)) hits.delete(k); if (hits.size > 200000) hits.clear(); }, 300e3).unref();

  // Every request to the programs of the site (not the pages, the pictures or the video) counts for its address.
  // The ceiling is high on purpose: a whole class often comes from one address (a school, a phone operator).
  const API_PER_MIN = Number(env.API_PER_MIN) || 6000;
  const blockedSaid = new Map();
  function apiAllowed(ip, pathName) {
    if (allowed('api:' + ip, API_PER_MIN, 60e3)) return true;
    const now = Date.now();
    if (now - (blockedSaid.get(ip) || 0) > 60e3) { blockedSaid.set(ip, now); if (blockedSaid.size > 5000) blockedSaid.clear(); audit('rate.blocked', ip, { path: pathName }); }
    return false;
  }

  // ------------------------------------------------------- settings at start --
  // What is missing or weak in the settings is said in the server's log when it starts.
  function checkEnv() {
    const out = [], prod = env.NODE_ENV === 'production';
    if (!env.SECRET) out.push('SECRET is not set: every session ends each time the server restarts.');
    else if (String(env.SECRET).length < 32) out.push('SECRET is shorter than 32 characters.');
    if (prod && !env.MTX_PASS) out.push('MTX_PASS is not set: the media server is not protected by a password.');
    if (String(env.ADMIN_PASSWORD || '').length < 12) out.push('ADMIN_PASSWORD is shorter than 12 characters: choose a longer one.');
    if (/^(admin|password|studio|regam|12345678|azerty)/i.test(String(env.ADMIN_PASSWORD || ''))) out.push('ADMIN_PASSWORD starts with a common word.');
    if (prod && env.PUBLIC_ORIGIN && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(env.PUBLIC_ORIGIN)) out.push('PUBLIC_ORIGIN must look like https://live.example.com');
    if (prod && (env.MAIL_OUTBOX || env.PUSH_TEST_HOST || env.PAY_URL || env.AI_URL)) out.push('A setting meant for tests (MAIL_OUTBOX, PUSH_TEST_HOST, PAY_URL, AI_URL) is present in production.');
    for (const w of out) console.warn('[security] ' + w);
    return out;
  }

  return { headers, audit, view, allowed, count, apiAllowed, checkEnv, policy };
};
