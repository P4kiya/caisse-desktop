const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let ipcRegistered = false;
let autoUpdaterConfigured = false;
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

function getDialogParent() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isFocused()) {
      mainWindow.focus();
    }
    return mainWindow;
  }
  return BrowserWindow.getFocusedWindow() || null;
}

async function showAppDialog(options) {
  const parent = getDialogParent();
  return dialog.showMessageBox(parent ?? undefined, {
    noLink: true,
    ...options,
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function configureAutoUpdater() {
  if (autoUpdaterConfigured || !app.isPackaged) {
    return;
  }

  autoUpdaterConfigured = true;
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

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
}

async function promptDownloadedInstall(version) {
  const { response } = await showAppDialog({
    type: 'info',
    title: 'Mise à jour prête',
    message: `La version ${version || ''} est prête à être installée.`,
    detail: 'Redémarrez l’application pour terminer la mise à jour.',
    buttons: ['Redémarrer', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
}

async function promptUpdateAvailable(payload) {
  log.info('Showing update-available dialog', payload);

  const { response } = await showAppDialog({
    type: 'info',
    title: 'Mise à jour disponible',
    message: `La version ${payload.latestVersion} est disponible.`,
    detail: `Vous utilisez actuellement la version ${payload.currentVersion}.`,
    buttons: ['Télécharger', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response !== 0) return;

  try {
    send('update-download-progress', { percent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error?.message || String(error);
    log.error('Download failed:', message);
    send('update-error', { message });
    await showAppDialog({
      type: 'error',
      title: 'Échec du téléchargement',
      message,
      buttons: ['OK'],
    });
  }
}

async function promptUpToDate(payload) {
  log.info('Showing up-to-date dialog', payload);

  await showAppDialog({
    type: 'info',
    title: 'À jour',
    message: 'Vous utilisez déjà la dernière version disponible.',
    detail: `Version installée : ${payload.currentVersion}${
      payload.latestVersion ? ` — Dernière release : ${payload.latestVersion}` : ''
    }`,
    buttons: ['OK'],
  });
}

async function promptDevMode() {
  log.info('Showing dev-mode update dialog');

  await showAppDialog({
    type: 'info',
    title: 'Mises à jour',
    message: 'Les mises à jour automatiques ne fonctionnent qu’avec l’application installée (.exe).',
    detail:
      'Installez « Caisse Setup » depuis GitHub Releases, puis lancez Caisse depuis le menu Démarrer. npm run dev ne vérifie pas GitHub.',
    buttons: ['OK'],
  });
}

async function promptUpdateError(message) {
  await showAppDialog({
    type: 'error',
    title: 'Erreur de mise à jour',
    message,
    buttons: ['OK'],
  });
}

async function performUpdateCheck() {
  if (!app.isPackaged) {
    const currentVersion = app.getVersion();
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      devMode: true,
    };
  }

  if (checkInFlight) {
    return checkInFlight;
  }

  const currentVersion = app.getVersion();
  configureAutoUpdater();

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

function setupUpdaterIpc(ipcMain) {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle('app-get-version', () => app.getVersion());
  ipcMain.handle('app-is-packaged', () => app.isPackaged);

  ipcMain.handle('update-check', async (_event, options = {}) => {
    log.info('update-check invoked', { interactive: Boolean(options.interactive) });

    try {
      const payload = await performUpdateCheck();

      if (options.interactive) {
        if (payload.devMode) {
          await promptDevMode();
        } else if (payload.updateAvailable) {
          await promptUpdateAvailable(payload);
        } else {
          await promptUpToDate(payload);
        }
      }

      return payload;
    } catch (error) {
      const message = error?.message || String(error);
      if (options.interactive) {
        await promptUpdateError(message);
      }
      throw error;
    }
  });

  ipcMain.handle('update-download', async () => {
    if (!app.isPackaged) {
      throw new Error('Mises à jour indisponibles en mode développement.');
    }
    configureAutoUpdater();
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update-install', () => {
    if (!app.isPackaged) return;
    configureAutoUpdater();
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('updater-renderer-ready', async () => {
    log.info('Renderer ready, running startup update check');

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

  if (app.isPackaged) {
    configureAutoUpdater();
    setInterval(() => {
      performUpdateCheck().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }
}

function attachMainWindow(win) {
  mainWindow = win;
}

module.exports = { setupUpdaterIpc, attachMainWindow };
