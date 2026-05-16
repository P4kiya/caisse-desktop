const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_FEED_URL =
  'https://github.com/P4kiya/caisse-desktop/releases/latest/download';
const RELEASES_PAGE_URL = 'https://github.com/P4kiya/caisse-desktop/releases/latest';

let mainWindow = null;
let ipcRegistered = false;
let autoUpdaterConfigured = false;
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

async function fetchLatestVersionFromYaml() {
  const response = await fetch(`${UPDATE_FEED_URL}/latest.yml`, {
    headers: { 'User-Agent': 'Caisse-Desktop-Updater' },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Impossible de lire latest.yml (HTTP ${response.status})`);
  }

  const text = await response.text();
  const match = text.match(/^version:\s*([^\s#]+)/m);
  return match ? match[1].trim() : null;
}

async function resolveUpdatePayload(result, currentVersion) {
  let payload = buildCheckPayload(result, currentVersion);

  try {
    const yamlVersion = await fetchLatestVersionFromYaml();
    if (yamlVersion && compareVersions(yamlVersion, currentVersion) > 0) {
      if (!payload.updateAvailable || payload.latestVersion !== yamlVersion) {
        log.info('Using latest.yml version:', yamlVersion);
      }
      payload = {
        ...payload,
        latestVersion: yamlVersion,
        updateAvailable: true,
      };
    } else if (yamlVersion) {
      payload.latestVersion = yamlVersion;
      payload.updateAvailable =
        compareVersions(yamlVersion, currentVersion) > 0;
    }
  } catch (error) {
    log.warn('latest.yml fallback failed:', error?.message || error);
  }

  return payload;
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
  autoUpdater.disableDifferentialDownload = true;

  if (process.platform === 'win32') {
    autoUpdater.verifyUpdateCodeSignature = false;
  }

  const token = String(process.env.GH_TOKEN || '').trim();
  if (token && !token.includes('votre_token')) {
    autoUpdater.requestHeaders = {
      ...(autoUpdater.requestHeaders || {}),
      Authorization: `token ${token}`,
    };
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_FEED_URL,
  });

  log.info('Auto-updater feed:', UPDATE_FEED_URL);

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
    buttons: ['Télécharger', 'Page web', 'Plus tard'],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 1) {
    shell.openExternal(RELEASES_PAGE_URL);
    return;
  }

  if (response !== 0) return;

  try {
    send('update-download-progress', { percent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error?.message || String(error);
    log.error('Download failed:', message);
    send('update-error', { message });

    const { response: retryResponse } = await showAppDialog({
      type: 'error',
      title: 'Échec du téléchargement',
      message,
      detail: 'Vous pouvez télécharger l’installateur manuellement depuis GitHub.',
      buttons: ['Page web', 'OK'],
      defaultId: 0,
    });

    if (retryResponse === 0) {
      shell.openExternal(RELEASES_PAGE_URL);
    }
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
  await showAppDialog({
    type: 'info',
    title: 'Mises à jour',
    message: 'Les mises à jour automatiques ne fonctionnent qu’avec l’application installée (.exe).',
    detail:
      'Désinstallez les anciennes versions, installez « Caisse Setup » depuis GitHub Releases, puis lancez Caisse depuis le menu Démarrer (pas npm run dev).',
    buttons: ['Ouvrir GitHub', 'OK'],
    defaultId: 1,
  }).then(({ response }) => {
    if (response === 0) shell.openExternal(RELEASES_PAGE_URL);
  });
}

async function promptUpdateError(message, currentVersion) {
  const { response } = await showAppDialog({
    type: 'error',
    title: 'Erreur de mise à jour',
    message,
    detail: currentVersion
      ? `Version actuelle détectée : ${currentVersion}. Vous pouvez installer manuellement depuis GitHub.`
      : 'Vous pouvez installer manuellement depuis GitHub.',
    buttons: ['Page web', 'OK'],
    defaultId: 0,
  });

  if (response === 0) {
    shell.openExternal(RELEASES_PAGE_URL);
  }
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
      const payload = await resolveUpdatePayload(result, currentVersion);
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
      log.warn('electron-updater check failed:', message);

      try {
        const yamlVersion = await fetchLatestVersionFromYaml();
        if (yamlVersion) {
          const payload = {
            currentVersion,
            latestVersion: yamlVersion,
            updateAvailable: compareVersions(yamlVersion, currentVersion) > 0,
            releaseNotes: null,
            releaseDate: null,
          };
          log.info('Recovered via latest.yml:', payload);
          send('update-check-result', payload);
          return payload;
        }
      } catch (yamlError) {
        log.warn('latest.yml recovery failed:', yamlError?.message || yamlError);
      }

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

  log.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'logs', 'main.log');

  ipcMain.handle('app-get-version', () => app.getVersion());
  ipcMain.handle('app-is-packaged', () => app.isPackaged);

  ipcMain.handle('update-check', async () => {
    const currentVersion = app.getVersion();
    log.info('update-check invoked', { currentVersion });
    return performUpdateCheck();
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
      return await performUpdateCheck();
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
