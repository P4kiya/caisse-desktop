const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let rendererReady = false;

function compareVersions(left, right) {
  const parse = (value) =>
    String(value || '')
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runUpdateCheck() {
  if (!rendererReady) {
    return Promise.resolve();
  }

  return autoUpdater.checkForUpdates().catch((error) => {
    const message = error?.message || String(error);
    log.warn('Update check failed:', message);
    send('update-error', { message });
  });
}

function initAutoUpdater(win, { ipcMain }) {
  if (!app.isPackaged) {
    return;
  }

  mainWindow = win;

  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  if (process.platform === 'win32') {
    autoUpdater.verifyUpdateCodeSignature = false;
  }

  autoUpdater.on('checking-for-update', () => {
    send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available. Current:', app.getVersion(), 'Latest:', info?.version);
    send('update-not-available', { version: info?.version });
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error?.message || error);
    send('update-error', { message: error?.message || String(error) });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('update-download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('update-downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  ipcMain.handle('update-check', async () => {
    const currentVersion = app.getVersion();

    try {
      const result = await autoUpdater.checkForUpdates();
      const latestVersion = result?.updateInfo?.version || null;
      const updateAvailable =
        latestVersion != null &&
        compareVersions(latestVersion, currentVersion) > 0;

      return {
        currentVersion,
        latestVersion: latestVersion || currentVersion,
        updateAvailable,
        releaseNotes: result?.updateInfo?.releaseNotes ?? null,
        releaseDate: result?.updateInfo?.releaseDate ?? null,
      };
    } catch (error) {
      send('update-error', { message: error?.message || String(error) });
      throw error;
    }
  });

  ipcMain.handle('update-download', async () => {
    try {
      return await autoUpdater.downloadUpdate();
    } catch (error) {
      send('update-error', { message: error?.message || String(error) });
      throw error;
    }
  });

  ipcMain.handle('update-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('app-get-version', () => app.getVersion());
  ipcMain.handle('app-is-packaged', () => app.isPackaged);

  ipcMain.handle('updater-renderer-ready', () => {
    rendererReady = true;
    return runUpdateCheck();
  });

  setInterval(runUpdateCheck, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdater };
