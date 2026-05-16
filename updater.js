const path = require('path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_FEED_URL =
  'https://github.com/P4kiya/caisse-desktop/releases/latest/download';

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
    if (yamlVersion) {
      payload.latestVersion = yamlVersion;
      payload.updateAvailable =
        compareVersions(yamlVersion, currentVersion) > 0;
    }
  } catch (error) {
    log.warn('latest.yml fallback failed:', error?.message || error);
  }

  return payload;
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
    log.info('Update downloaded, restarting:', info.version);
    send('update-downloaded', { version: info.version });
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 400);
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error?.message || error);
    send('update-error', { message: error?.message || String(error) });
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

  ipcMain.handle('update-check', () => performUpdateCheck());

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
