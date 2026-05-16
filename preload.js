const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let bundledVersion = '';
try {
  bundledVersion = require('./package.json').version || '';
} catch (_) {
  bundledVersion = '';
}

const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);

const UPDATE_CHANNELS = [
  'update-checking',
  'update-check-result',
  'update-available',
  'update-not-available',
  'update-error',
  'update-download-progress',
  'update-downloaded',
];

const pendingUpdateEvents = [];
let updateStatusCallback = null;

function dispatchUpdateEvent(channel, payload) {
  if (updateStatusCallback) {
    updateStatusCallback(channel, payload);
  } else {
    pendingUpdateEvents.push({ channel, payload });
  }
}

UPDATE_CHANNELS.forEach((channel) => {
  ipcRenderer.on(channel, (_event, payload) => {
    dispatchUpdateEvent(channel, payload);
  });
});

contextBridge.exposeInMainWorld('caisseConfig', {
  apiBaseUrl,
});

contextBridge.exposeInMainWorld('caisseApp', {
  version: bundledVersion,
});

contextBridge.exposeInMainWorld('caisseUpdater', {
  check: (options) => ipcRenderer.invoke('update-check', options),
  download: () => ipcRenderer.invoke('update-download'),
  install: () => ipcRenderer.invoke('update-install'),
  getVersion: () => ipcRenderer.invoke('app-get-version'),
  isPackaged: () => ipcRenderer.invoke('app-is-packaged'),
  notifyReady: () => ipcRenderer.invoke('updater-renderer-ready'),
  onStatus: (callback) => {
    updateStatusCallback = callback;
    const queued = pendingUpdateEvents.splice(0);
    queued.forEach(({ channel, payload }) => callback(channel, payload));
  },
});
