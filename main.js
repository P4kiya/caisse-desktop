const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { setupUpdaterIpc, attachMainWindow } = require('./updater');
const { ensureBackendRunning } = require('./backend-launcher');
const { printOrderReceipt, printDaySummaryReceipt } = require('./receipt-print');

let mainWindow = null;
let appUnlocked = false;
let authRole = 'user';

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

function applyAuthWindowLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }
  mainWindow.setMinimumSize(400, 580);
  mainWindow.setResizable(false);
  mainWindow.setMaximizable(false);
  mainWindow.setSize(400, 580);
  mainWindow.center();
}

function applyMainWindowLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setResizable(true);
  mainWindow.setMaximizable(true);
  mainWindow.setMinimumSize(800, 500);
  if (!mainWindow.isMaximized()) {
    mainWindow.maximize();
  }
}

async function loadAuthPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  applyAuthWindowLayout();
  await mainWindow.loadFile(path.join(__dirname, 'auth.html'));
}

async function loadMainPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  applyMainWindowLayout();
  injectAppVersionIntoPage();
}

function createAppWindow() {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 400,
    height: 580,
    center: true,
    minWidth: 400,
    minHeight: 580,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#f5f4f1',
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
    if (appUnlocked) {
      applyMainWindowLayout();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (appUnlocked) {
      injectAppVersionIntoPage();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    appUnlocked = false;
    authRole = 'user';
    attachMainWindow(null);
  });

  if (appUnlocked) {
    loadMainPage();
  } else {
    loadAuthPage();
  }
}

ipcMain.handle('auth-unlock', async (_event, payload) => {
  const role = payload?.role === 'admin' ? 'admin' : 'user';
  authRole = role;

  if (appUnlocked) {
    return { ok: true, role: authRole };
  }
  appUnlocked = true;

  if (!mainWindow || mainWindow.isDestroyed()) {
    createAppWindow();
    return { ok: true, role: authRole };
  }

  await loadMainPage();
  return { ok: true, role: authRole };
});

ipcMain.handle('auth-get-role', () => ({
  role: appUnlocked && authRole === 'admin' ? 'admin' : 'user',
}));

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

ipcMain.handle('print-day-summary', async (_event, payload) => {
  const { orders, options = {} } = payload || {};
  const shopName = process.env.SHOP_NAME || 'Caisse';
  const deviceName =
    options.deviceName ||
    (process.env.PRINT_PRINTER || '').trim() ||
    undefined;
  await printDaySummaryReceipt(orders, { shopName, deviceName, ...options });
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

  createAppWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      appUnlocked = false;
      createAppWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
