const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);

const UPDATE_CHANNELS = [
  'update-checking',
  'update-available',
  'update-not-available',
  'update-error',
  'update-download-progress',
  'update-downloaded',
];

contextBridge.exposeInMainWorld('caisseConfig', {
  apiBaseUrl,
});

contextBridge.exposeInMainWorld('caisseUpdater', {
  check: () => ipcRenderer.invoke('update-check'),
  download: () => ipcRenderer.invoke('update-download'),
  install: () => ipcRenderer.invoke('update-install'),
  getVersion: () => ipcRenderer.invoke('app-get-version'),
  isPackaged: () => ipcRenderer.invoke('app-is-packaged'),
  onStatus: (callback) => {
    UPDATE_CHANNELS.forEach((channel) => {
      ipcRenderer.on(channel, (_event, payload) => {
        callback(channel, payload);
      });
    });
  },
});
