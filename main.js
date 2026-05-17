const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const { setupUpdaterIpc, attachMainWindow } = require('./updater');
const { ensureBackendRunning } = require('./backend-launcher');

let mainWindow = null;

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
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#f5f4f1',
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
        'Impossible de demarrer le serveur. Executez Caisse.cmd dans le dossier d installation.',
    );
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
