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

const shopName = (process.env.SHOP_NAME || 'Caisse').trim() || 'Caisse';
const printAuto = process.env.PRINT_AUTO !== '0';
// Default: print directly to the default printer (no dialog, no PDF file).
const printSilent = process.env.PRINT_SILENT !== '0';
const printDeviceName = (process.env.PRINT_PRINTER || '').trim();

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

contextBridge.exposeInMainWorld('caissePrint', {
  shopName,
  autoPrint: printAuto,
  defaultSilent: printSilent,
  deviceName: printDeviceName,
  printReceipt: (order, options) =>
    ipcRenderer.invoke('print-receipt', { order, options }),
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
