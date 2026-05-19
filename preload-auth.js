const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caisseAuth', {
  unlock: (payload) => ipcRenderer.invoke('auth-unlock', payload || {}),
  getRole: () => ipcRenderer.invoke('auth-get-role'),
});
