import { contextBridge, ipcRenderer } from 'electron'

export type SaveResult =
  | { status: 'saved'; path: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  secureStorage: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
    set: (key: string, value: string): Promise<boolean> =>
      ipcRenderer.invoke('secure:set', key, value),
    remove: (key: string): Promise<boolean> => ipcRenderer.invoke('secure:remove', key)
  },
  exportExcel: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('file:saveBinary', defaultName, data, 'xlsx'),
  exportJson: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('file:saveBinary', defaultName, data, 'json'),
  savePdf: (defaultName: string, html: string, landscape: boolean): Promise<SaveResult> =>
    ipcRenderer.invoke('file:savePdf', defaultName, html, landscape)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api