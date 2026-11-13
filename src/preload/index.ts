import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CaptureEvent, GuruApi, LiveEvent } from '../shared/types'

const api: GuruApi = {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  setShortcut: (accelerator) => ipcRenderer.invoke('settings:setShortcut', accelerator),
  setAi: (choice) => ipcRenderer.invoke('settings:setAi', choice),
  detectClaudeCode: () => ipcRenderer.invoke('settings:detectClaudeCode'),
  detectCodex: () => ipcRenderer.invoke('settings:detectCodex'),
  captureNow: () => ipcRenderer.invoke('capture:now'),
  onCapture: (callback) => {
    const listener = (_event: IpcRendererEvent, capture: CaptureEvent) => callback(capture)
    ipcRenderer.on('capture:done', listener)
    return () => ipcRenderer.removeListener('capture:done', listener)
  },
  generate: (request) => ipcRenderer.invoke('resume:generate', request),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('resume:exportPdf', html, suggestedName),
  analyzeGithub: (username, profile) => ipcRenderer.invoke('github:analyze', username, profile),
  getGithubCatalog: () => ipcRenderer.invoke('github:catalog'),
  importResumeFile: () => ipcRenderer.invoke('profile:importResumeFile'),

  setLiveShortcut: (accelerator) => ipcRenderer.invoke('settings:setLiveShortcut', accelerator),
  liveRun: (request) => ipcRenderer.invoke('live:run', request),
  liveCancel: (requestId) => ipcRenderer.send('live:cancel', requestId),
  onLiveEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: LiveEvent) => callback(payload)
    ipcRenderer.on('live:event', listener)
    return () => ipcRenderer.removeListener('live:event', listener)
  },
  onPanelStart: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('panel:start', listener)
    return () => ipcRenderer.removeListener('panel:start', listener)
  },
  panelGeometry: () => ipcRenderer.invoke('panel:geometry'),
  closePanel: () => ipcRenderer.send('panel:close'),
  sendToResume: (images, notes) => ipcRenderer.send('panel:toResume', images, notes)
}

contextBridge.exposeInMainWorld('guru', api)
