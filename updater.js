const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let rendererReady = false;
let checkInFlight = null;

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

function buildCheckPayload(result, currentVersion) {
  const latestVersion =
    result?.updateInfo?.version ||
    result?.versionInfo?.version ||
    currentVersion;

  const updateAvailable =
    result?.isUpdateAvailable === true ||
    (latestVersion != null && compareVersions(latestVersion, currentVersion) > 0);

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseNotes: result?.updateInfo?.releaseNotes ?? null,
    releaseDate: result?.updateInfo?.releaseDate ?? null,
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function performUpdateCheck() {
  if (checkInFlight) {
    return checkInFlight;
  }

  const currentVersion = app.getVersion();

  checkInFlight = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const payload = buildCheckPayload(result, currentVersion);
      log.info(
        'Update check:',
        payload.currentVersion,
        '->',
        payload.latestVersion,
        'available:',
        payload.updateAvailable,
      );
      send('update-check-result', payload);

      if (payload.updateAvailable) {
        send('update-available', {
          version: payload.latestVersion,
          releaseNotes: payload.releaseNotes,
          releaseDate: payload.releaseDate,
        });
      } else {
        send('update-not-available', { version: payload.latestVersion });
      }

      return payload;
    } catch (error) {
      const message = error?.message || String(error);
      log.warn('Update check failed:', message);
      send('update-error', { message });
      throw error;
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

function registerBaseIpc(ipcMain) {
  ipcMain.handle('app-get-version', () => app.getVersion());
  ipcMain.handle('app-is-packaged', () => app.isPackaged);
}

function registerDevUpdateIpc(ipcMain) {
  ipcMain.handle('update-check', async () => ({
    currentVersion: app.getVersion(),
    latestVersion: app.getVersion(),
    updateAvailable: false,
    devMode: true,
  }));
  ipcMain.handle('update-download', async () => {
    throw new Error('Mises à jour indisponibles en mode développement.');
  });
  ipcMain.handle('update-install', () => {});
  ipcMain.handle('updater-renderer-ready', () => {
    rendererReady = true;
    return null;
  });
}

function initAutoUpdater(win, { ipcMain }) {
  registerBaseIpc(ipcMain);
  mainWindow = win;

  if (!app.isPackaged) {
    registerDevUpdateIpc(ipcMain);
    return;
  }

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
    log.info('Update available event:', info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info(
      'Update not available event. Current:',
      app.getVersion(),
      'Latest:',
      info?.version,
    );
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

  ipcMain.handle('update-check', () => performUpdateCheck());

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

  ipcMain.handle('updater-renderer-ready', () => {
    rendererReady = true;
    return null;
  });

  setInterval(() => {
    if (rendererReady) {
      performUpdateCheck().catch(() => {});
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdater, registerBaseIpc };
