const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentWriter', {
  pickArticle: () => ipcRenderer.invoke('article:pick'),
});
