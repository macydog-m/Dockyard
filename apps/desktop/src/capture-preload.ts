import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('captureTools', Object.freeze({
  onFrame: (callback: (frame: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: unknown) => callback(frame);
    ipcRenderer.on('dockyard:capture-frame', listener);
    return () => ipcRenderer.removeListener('dockyard:capture-frame', listener);
  },
  onReset: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('dockyard:capture-reset', listener);
    return () => ipcRenderer.removeListener('dockyard:capture-reset', listener);
  },
  ready: (session: number, viewport: { width: number; height: number }) => ipcRenderer.invoke('dockyard:capture-ready', session, viewport),
  select: (session: number, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('dockyard:capture-select', session, rect),
  cancel: (session: number) => ipcRenderer.invoke('dockyard:capture-cancel', session),
}));
