const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let rendererReady = false;
let checkInFlight = null;
let startupPromptDone = false;

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

async function promptDownloadedInstall(version) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Mise à jour prête',
    message: `La version ${version || ''} est prête à être installée.`,
    detail: 'Redémarrez l’application pour terminer la mise à jour.',
    buttons: ['Redémarrer', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
}

async function promptUpdateAvailable(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Mise à jour disponible',
    message: `La version ${payload.latestVersion} est disponible.`,
    detail: `Vous utilisez actuellement la version ${payload.currentVersion}.`,
    buttons: ['Télécharger', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (response !== 0) return;

  try {
    send('update-download-progress', { percent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error?.message || String(error);
    log.error('Download failed:', message);
    send('update-error', { message });
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Échec du téléchargement',
      message,
      buttons: ['OK'],
      noLink: true,
    });
  }
}

async function promptUpToDate(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'À jour',
    message: 'Vous utilisez déjà la dernière version disponible.',
    detail: `Version installée : ${payload.currentVersion}`,
    buttons: ['OK'],
    noLink: true,
  });
}

async function promptDevMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Mises à jour',
    message: 'Les mises à jour automatiques ne fonctionnent qu’avec l’application installée (.exe).',
    detail: 'Lancez « Caisse Setup » depuis le menu Démarrer, pas npm run dev.',
    buttons: ['OK'],
    noLink: true,
  });
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
  ipcMain.handle('update-check', async (_event, options = {}) => {
    const payload = {
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
      updateAvailable: false,
      devMode: true,
    };

    if (options.interactive) {
      await promptDevMode();
    }

    return payload;
  });
  ipcMain.handle('update-download', async () => {
    throw new Error('Mises à jour indisponibles en mode développement.');
  });
  ipcMain.handle('update-install', () => {});
  ipcMain.handle('updater-renderer-ready', async () => {
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
    promptDownloadedInstall(info.version).catch((error) => {
      log.error('Install prompt failed:', error?.message || error);
    });
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error?.message || error);
    send('update-error', { message: error?.message || String(error) });
  });

  ipcMain.handle('update-check', async (_event, options = {}) => {
    try {
      const payload = await performUpdateCheck();

      if (options.interactive) {
        if (payload.updateAvailable) {
          await promptUpdateAvailable(payload);
        } else {
          await promptUpToDate(payload);
        }
      }

      return payload;
    } catch (error) {
      if (options.interactive && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Erreur de mise à jour',
          message: error?.message || String(error),
          buttons: ['OK'],
          noLink: true,
        });
      }
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

  ipcMain.handle('updater-renderer-ready', async () => {
    rendererReady = true;

    try {
      const payload = await performUpdateCheck();
      if (payload.updateAvailable && !startupPromptDone) {
        startupPromptDone = true;
        await promptUpdateAvailable(payload);
      }
      return payload;
    } catch (error) {
      log.warn('Startup update check failed:', error?.message || error);
      return null;
    }
  });

  setInterval(() => {
    if (rendererReady) {
      performUpdateCheck().catch(() => {});
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdater, registerBaseIpc };
