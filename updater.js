const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_AFTER_LOAD_MS = 1500;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let checkScheduled = false;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runUpdateCheck() {
  return autoUpdater.checkForUpdates().catch((error) => {
    log.warn('Update check failed:', error?.message || error);
  });
}

function scheduleUpdateCheck() {
  if (checkScheduled || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  checkScheduled = true;
  setTimeout(() => {
    checkScheduled = false;
    runUpdateCheck();
  }, CHECK_AFTER_LOAD_MS);
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
    try {
      return await autoUpdater.checkForUpdates();
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

  win.webContents.once('did-finish-load', scheduleUpdateCheck);
  setInterval(runUpdateCheck, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdater, scheduleUpdateCheck };
