import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CaptureEvent, GuruApi } from '../shared/types'

const api: GuruApi = {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  setShortcut: (accelerator) => ipcRenderer.invoke('settings:setShortcut', accelerator),
  captureNow: () => ipcRenderer.invoke('capture:now'),
  onCapture: (callback) => {
    const listener = (_event: IpcRendererEvent, capture: CaptureEvent) => callback(capture)
    ipcRenderer.on('capture:done', listener)
    return () => ipcRenderer.removeListener('capture:done', listener)
  },
  generate: (request) => ipcRenderer.invoke('resume:generate', request),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('resume:exportPdf', html, suggestedName),
  importGithub: (username) => ipcRenderer.invoke('github:import', username),
  importResumeFile: () => ipcRenderer.invoke('profile:importResumeFile')
}

contextBridge.exposeInMainWorld('guru', api)
