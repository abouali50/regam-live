// REGAM Live - the desktop application (Windows, macOS, Linux). Author: Aziz Mernissi.
// A window of its own on the REGAM Live site: camera, microphone, screen sharing and notifications work as in
// the browser; links to other sites open in the computer's browser.
'use strict';
const { app, BrowserWindow, shell, session, desktopCapturer, Menu, dialog } = require('electron');
const path = require('path');
const SITE = require('./config.json').site.replace(/\/$/, '');
const HOST = new URL(SITE).host;

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;

function open() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 560, title: 'REGAM Live', backgroundColor: '#141a52', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const mine = (url) => { try { return new URL(url).host === HOST; } catch { return false; } };
  // the site's own pages stay in the window; everything else (PayPal aside, which must come back here) goes to the browser
  const stays = (url) => mine(url) || /(^|\.)paypal\.com$/.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
  win.webContents.setWindowOpenHandler(({ url }) => { if (stays(url)) return { action: 'allow' }; shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!stays(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (e, code, text, url, main) => {
    if (!main || code === -3) return;                                    // -3: a load replaced by another
    win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.loadURL(SITE);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  // camera, microphone, notifications, full screen: for the REGAM Live site only
  const wanted = new Set(['media', 'notifications', 'fullscreen', 'display-capture', 'clipboard-sanitized-write', 'speaker-selection']);
  const fromSite = (wc) => { try { return new URL(wc.getURL()).host === HOST; } catch { return false; } };
  ses.setPermissionRequestHandler((wc, permission, done) => done(fromSite(wc) && wanted.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => !!wc && fromSite(wc) && wanted.has(permission));
  // "share the screen": the person picks the screen or the window to show
  ses.setDisplayMediaRequestHandler(async (request, done) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return done({});
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'REGAM Live', message: 'Partager / Share / مشاركة', buttons: [...sources.slice(0, 12).map((s) => s.name), 'Annuler'], cancelId: Math.min(sources.length, 12) });
      const pick = sources[response];
      done(pick ? { video: pick, audio: process.platform === 'win32' ? 'loopback' : undefined } : {});
    } catch { done({}); }
  }, { useSystemPicker: true });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'REGAM Live', submenu: [
      { label: 'Accueil', click: () => win && win.loadURL(SITE) },
      { label: 'Studio', click: () => win && win.loadURL(SITE + '/studio') },
      { label: 'Support', click: () => win && win.loadURL(SITE + '/support') },
      { type: 'separator' }, { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
    ] },
    { role: 'windowMenu' },
  ]));
  open();
  app.on('activate', () => { if (!win) open(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
