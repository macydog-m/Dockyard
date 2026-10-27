import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Progress } from './contracts';

const api: DesktopApi = {
  isDevelopment: process.argv.includes('--dockyard-development'),
  getLanguage: () => ipcRenderer.invoke('dockyard:language:get'),
  setLanguage: language => ipcRenderer.invoke('dockyard:language', language),
  getTheme: () => ipcRenderer.invoke('dockyard:theme:get'),
  setTheme: theme => ipcRenderer.invoke('dockyard:theme', theme),
  resize: (height, width, collapsed) => ipcRenderer.invoke('dockyard:resize', height, width, collapsed),
  setSurfaces: surfaces => ipcRenderer.invoke('dockyard:surfaces', surfaces),
  onMaterialChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, mode: 'acrylic' | 'translucent' | 'solid') => callback(mode);
    ipcRenderer.on('dockyard:material', listener);
    return () => ipcRenderer.removeListener('dockyard:material', listener);
  },
  close: () => ipcRenderer.invoke('dockyard:close'),
  capture: mode => ipcRenderer.invoke('dockyard:capture', mode),
  screenshotAction: (action, dataUrl) => ipcRenderer.invoke('dockyard:screenshot', action, dataUrl),
  copyText: text => ipcRenderer.invoke('dockyard:copy-text', text),
  onBlur: callback => {
    const listener = () => callback();
    ipcRenderer.on('dockyard:blur', listener);
    return () => ipcRenderer.removeListener('dockyard:blur', listener);
  },
  state: () => ipcRenderer.invoke('dockyard:command', { type: 'state' }),
  bindingConfig: id => ipcRenderer.invoke('dockyard:command', { type: 'bindingConfig', id }),
  updateConfiguration: (id, componentId, expectedRevision, definitionRevision, action) => ipcRenderer.invoke('dockyard:command', { type: 'configuration', id, componentId, expectedRevision, definitionRevision, action }),
  importConfiguration: (id, expectedRevision, component) => ipcRenderer.invoke('dockyard:command', { type: 'importConfiguration', id, expectedRevision, component }),
  notebook: id => ipcRenderer.invoke('dockyard:command', { type: 'notebook', id }),
  saveNotebook: (id, notebook) => ipcRenderer.invoke('dockyard:command', { type: 'saveNotebook', id, notebook }),
  restartApp: () => ipcRenderer.invoke('dockyard:restart-app'),
  save: component => ipcRenderer.invoke('dockyard:command', { type: 'save', component }),
  remove: id => ipcRenderer.invoke('dockyard:command', { type: 'remove', id }),
  refresh: id => ipcRenderer.invoke('dockyard:command', { type: 'refresh', id }),
  createWorkspace: name => ipcRenderer.invoke('dockyard:command', { type: 'createWorkspace', name }),
  renameWorkspace: (id, name) => ipcRenderer.invoke('dockyard:command', { type: 'renameWorkspace', id, name }),
  switchWorkspace: id => ipcRenderer.invoke('dockyard:command', { type: 'switchWorkspace', id }),
  select: (id, componentIds) => ipcRenderer.invoke('dockyard:command', { type: 'select', id, componentIds }),
  setResourceEnabled: (id, componentId, enabled) => ipcRenderer.invoke('dockyard:command', { type: 'enable', id, componentId, enabled }),
  setDesign: (id, design) => ipcRenderer.invoke('dockyard:command', { type: 'design', id, design }),
  pickSource: kind => ipcRenderer.invoke('dockyard:pick', kind),
  diagnose: () => ipcRenderer.invoke('dockyard:command', { type: 'diagnose' }),
  connectionPlan: () => ipcRenderer.invoke('dockyard:command', { type: 'connectionPlan' }),
  connectCodex: (token, replace) => ipcRenderer.invoke('dockyard:command', { type: 'connectCodex', token, replace }),
  restoreConnection: id => ipcRenderer.invoke('dockyard:command', { type: 'restoreConnection', id }),
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on('dockyard:progress', listener);
    return () => ipcRenderer.removeListener('dockyard:progress', listener);
  },
};
contextBridge.exposeInMainWorld('dockyard', Object.freeze(api));
