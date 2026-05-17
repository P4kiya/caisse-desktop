const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { setupUpdaterIpc, attachMainWindow } = require('./updater');
const { ensureBackendRunning } = require('./backend-launcher');

let mainWindow = null;

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

function createWindow() {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
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

app.whenReady().then(async () => {
  setupUpdaterIpc(ipcMain);
  Menu.setApplicationMenu(null);

  const backend = await ensureBackendRunning();
  if (!backend.ok) {
    dialog.showErrorBox(
      'Caisse — serveur indisponible',
      backend.error ||
        'Impossible de demarrer le serveur. Verifiez que MySQL est installe et demarre.',
    );
  } else if (backend.firstDepsInstall) {
    console.log('Premiere configuration du serveur terminee (base de donnees creee si besoin).');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
