const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caisseAuth', {
  unlock: () => ipcRenderer.invoke('auth-unlock'),
});
