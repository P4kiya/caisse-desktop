const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { setupUpdaterIpc, attachMainWindow } = require('./updater');
const { ensureBackendRunning } = require('./backend-launcher');
const { printOrderReceipt } = require('./receipt-print');

let mainWindow = null;
let authWindow = null;
let appUnlocked = false;

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'logo-2.png'),
    path.join(__dirname, 'logo.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function injectAppVersionIntoPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const version = String(app.getVersion() || '').trim();
  if (!version) return;

  const label = version.replace(/^v/i, '');
  const script = `(() => {
    const el = document.getElementById('appVersion');
    if (!el) return;
    el.textContent = 'v${label}';
    el.hidden = false;
    el.removeAttribute('hidden');
  })();`;

  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

function createAuthWindow() {
  const iconPath = resolveAppIconPath();
  authWindow = new BrowserWindow({
    width: 400,
    height: 580,
    resizable: false,
    fullscreenable: true,
    backgroundColor: '#f5f4f1',
    ...(iconPath ? { icon: iconPath } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload-auth.js'),
    },
  });

  authWindow.once('ready-to-show', () => {
    authWindow.setFullScreen(true);
    authWindow.show();
    authWindow.focus();
  });

  authWindow.loadFile(path.join(__dirname, 'auth.html'));

  authWindow.on('closed', () => {
    authWindow = null;
    if (!appUnlocked) {
      app.quit();
    }
  });
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    backgroundColor: '#f5f4f1',
    fullscreenable: true,
    ...(iconPath ? { icon: iconPath } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  attachMainWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.setFullScreen(true);
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', injectAppVersionIntoPage);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    attachMainWindow(null);
  });
}

ipcMain.handle('auth-unlock', async () => {
  if (appUnlocked) {
    return { ok: true };
  }
  appUnlocked = true;

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  return { ok: true };
});

ipcMain.handle('print-receipt', async (_event, payload) => {
  const { order, options = {} } = payload || {};
  const shopName = process.env.SHOP_NAME || 'Caisse';
  const deviceName =
    options.deviceName ||
    (process.env.PRINT_PRINTER || '').trim() ||
    undefined;
  await printOrderReceipt(order, { shopName, deviceName, ...options });
  return { ok: true };
});

app.whenReady().then(async () => {
  setupUpdaterIpc(ipcMain);
  Menu.setApplicationMenu(null);

  let backend = await ensureBackendRunning();
  if (!backend.ok) {
    const retry = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Caisse — serveur indisponible',
      message: 'Le serveur local ne demarre pas',
      detail:
        backend.error ||
        'Verifiez que Node.js et MySQL sont installes, puis reessayez.',
      buttons: ['Reessayer', 'Ouvrir quand meme'],
      defaultId: 0,
      cancelId: 1,
    });
    if (retry === 0) {
      backend = await ensureBackendRunning();
      if (!backend.ok) {
        dialog.showErrorBox('Caisse — serveur indisponible', backend.error);
      }
    }
  } else if (backend.firstDepsInstall) {
    console.log('Premiere configuration du serveur terminee (base de donnees creee si besoin).');
  }

  createAuthWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      appUnlocked = false;
      createAuthWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
