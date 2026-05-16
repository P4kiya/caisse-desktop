const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_DELAY_MS = 4000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
    send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    send('update-not-available', { version: info?.version });
  });

  autoUpdater.on('error', (error) => {
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

  const runCheck = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      log.warn('Update check failed:', error?.message || error);
    });
  };

  setTimeout(runCheck, CHECK_DELAY_MS);
  setInterval(runCheck, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdater };
