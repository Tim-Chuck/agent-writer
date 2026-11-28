const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentWriter', {
  pickArticle: () => ipcRenderer.invoke('article:pick'),
  pickToolFile: purpose => ipcRenderer.invoke('agent:pick-file', purpose),
  saveTxt: (filename, text) => ipcRenderer.invoke('export:save-txt', filename, text),
});
