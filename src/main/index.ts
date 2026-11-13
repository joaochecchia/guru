import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  CaptureEvent,
  GenerateRequest,
  GenerateResult,
  GithubAnalysisResult,
  GithubCatalog,
  Profile,
  SettingsInfo
} from '../shared/types'
import { captureScreen } from './capture'
import { analyzeGithubRepos, extractProfile, generateResume } from './claude'
import type { EngineConfig } from './engine'
import { detectClaudeCode } from './engine-claude-code'
import { installGnomeShortcut, isGnomeWayland } from './gnome-shortcut'
import { fetchGithubRepos } from './github'
import { htmlToPdf, renderResumeHtml } from './pdf'
import { readResumeFile, RESUME_FILE_EXTENSIONS } from './resume-file'
import * as store from './store'

// Em desenvolvimento, carrega o .env da raiz do projeto (modelo em .env.example).
// Variáveis já definidas no ambiente têm prioridade. O app empacotado não lê .env: a chave fica em Configurações.
if (!app.isPackaged) {
  const envFile = path.join(app.getAppPath(), '.env')
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile)
    } catch (error) {
      console.error(`[guru] não foi possível ler o .env: ${error instanceof Error ? error.message : error}`)
    }
  }
}

const CAPTURE_FLAG = '--capture'
const isWayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland'

// No GNOME com Wayland o atalho é criado nas configurações de teclado do sistema (veja gnome-shortcut.ts).
const useSystemShortcut = isGnomeWayland()

// Em outros ambientes Wayland os atalhos globais só funcionam pelo portal do sistema (xdg-desktop-portal).
if (process.platform === 'linux' && !useSystemShortcut) {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let shortcutRegistered = false
let shortcutError: string | null = null
let capturing = false
let isQuitting = false

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Guru',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  window.on('close', (event) => {
    // Fechar a janela só a esconde: o app continua vivo para o atalho funcionar.
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return window
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** autoGenerate: veio do atalho ou da bandeja, então a interface já começa a gerar o currículo. */
async function captureAndShow(autoGenerate = false): Promise<string> {
  if (!mainWindow) throw new Error('Janela principal indisponível.')
  // Esconde a própria janela para ela não aparecer na captura.
  if (mainWindow.isVisible()) {
    mainWindow.hide()
    await delay(350)
  }
  try {
    const image = await captureScreen()
    mainWindow.webContents.send('capture:done', { image, autoGenerate } satisfies CaptureEvent)
    return image
  } finally {
    showWindow()
  }
}

function captureFromShortcut(): void {
  // Ignora toques repetidos no atalho enquanto uma captura ainda está em andamento.
  if (capturing) return
  capturing = true
  captureAndShow(true)
    .catch((error: Error) => dialog.showErrorBox('Guru', error.message))
    .finally(() => {
      capturing = false
    })
}

async function registerShortcut(): Promise<void> {
  globalShortcut.unregisterAll()
  shortcutError = null
  if (useSystemShortcut) {
    try {
      await installGnomeShortcut(store.getShortcut())
      shortcutRegistered = true
    } catch (error) {
      shortcutRegistered = false
      shortcutError = error instanceof Error ? error.message : String(error)
    }
  } else {
    try {
      shortcutRegistered = globalShortcut.register(store.getShortcut(), captureFromShortcut)
    } catch {
      shortcutRegistered = false
    }
  }
  console.log(
    `[guru] atalho ${store.getShortcut()} ${shortcutRegistered ? 'registrado' : 'NÃO registrado'}` +
      (useSystemShortcut ? ' (configurações de teclado do GNOME)' : '') +
      (shortcutError ? `: ${shortcutError}` : '')
  )
  if (shortcutError && mainWindow) {
    // Sem isso a falha só aparecia na tela de Configurações e o atalho parecia simplesmente não funcionar.
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Guru',
      message: 'Não foi possível criar o atalho de captura.',
      detail: `${shortcutError}\n\nVocê ainda pode capturar pelo botão "Capturar tela" ou pelo ícone na bandeja.`
    })
  }
}

/** Monta o motor escolhido em Configurações, ou explica o que falta para usá-lo. */
async function getEngine(): Promise<EngineConfig> {
  const { engine, model } = store.getAi()
  if (engine === 'claude-code') {
    const status = await detectClaudeCode()
    if (!status.found || !status.path) {
      throw new Error('Claude Code não encontrado. Instale-o ou volte para o modo API em Configurações.')
    }
    return { engine, model, cliPath: status.path }
  }
  const { key } = await store.getApiKey()
  if (!key) throw new Error('Cadastre sua chave de API da Anthropic em Configurações.')
  return { engine, model, apiKey: key }
}

async function settingsInfo(): Promise<SettingsInfo> {
  const { key, source } = await store.getApiKey()
  return {
    hasApiKey: Boolean(key),
    apiKeySource: source,
    shortcut: store.getShortcut(),
    shortcutRegistered,
    shortcutError,
    shortcutViaSystem: useSystemShortcut,
    wayland: isWayland,
    ...store.getAi(),
    claudeCode: await detectClaudeCode()
  }
}

function createTray(): void {
  // Ícone gerado em código (quadrado azul) até o projeto ter uma identidade visual.
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) pixels.set([0xdb, 0x5b, 0x3b, 0xff], i * 4) // BGRA
  try {
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: size, height: size }))
    tray.setToolTip('Guru')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir o Guru', click: showWindow },
        { label: 'Capturar vaga', click: captureFromShortcut },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() }
      ])
    )
    tray.on('click', showWindow)
  } catch {
    tray = null // Sem bandeja no sistema: abrir o app de novo traz a janela de volta.
  }
}

function registerIpc(): void {
  ipcMain.handle('profile:get', () => store.getProfile())
  ipcMain.handle('profile:save', (_event, profile: Profile) => store.saveProfile(profile))

  ipcMain.handle('settings:get', () => settingsInfo())
  ipcMain.handle('settings:setApiKey', async (_event, key: string) => {
    await store.setApiKey(key)
    return settingsInfo()
  })
  ipcMain.handle('settings:setAi', (_event, choice: { engine?: unknown; model?: unknown }) => {
    store.setAi({
      ...(choice.engine === 'api' || choice.engine === 'claude-code' ? { engine: choice.engine } : {}),
      ...(choice.model === 'opus' || choice.model === 'sonnet' ? { model: choice.model } : {})
    })
    return settingsInfo()
  })
  ipcMain.handle('settings:detectClaudeCode', async () => {
    await detectClaudeCode(true)
    return settingsInfo()
  })
  ipcMain.handle('settings:setShortcut', async (_event, accelerator: string) => {
    store.setShortcut(accelerator.trim() || store.DEFAULT_SHORTCUT)
    await registerShortcut()
    return settingsInfo()
  })

  ipcMain.handle('capture:now', () => captureAndShow())

  ipcMain.handle('resume:generate', async (_event, request: GenerateRequest): Promise<GenerateResult> => {
    const engine = await getEngine()
    if (!request.imageDataUrl && !request.jobText.trim()) {
      throw new Error('Capture a tela da vaga ou cole o texto dela.')
    }
    const profile = store.getProfile()
    const resume = await generateResume(engine, profile, request, store.getGithubCatalog())
    return { resume, html: renderResumeHtml(resume, profile.personal) }
  })

  ipcMain.handle('resume:exportPdf', async (_event, html: string, suggestedName: string) => {
    const safeName = suggestedName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Curriculo'
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Salvar currículo',
      defaultPath: path.join(app.getPath('documents'), `${safeName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, await htmlToPdf(html))
    return result.filePath
  })

  ipcMain.handle('github:catalog', () => store.getGithubCatalog())

  ipcMain.handle('github:analyze', async (_event, username: string, profile: Profile): Promise<GithubAnalysisResult> => {
    const engine = await getEngine()
    const fetched = await fetchGithubRepos(username)
    const analysis = await analyzeGithubRepos(engine, profile, fetched.repos)

    // Links e metadados vêm do GitHub, nunca do texto do modelo; sugestões sem repositório real são descartadas.
    const byName = new Map(fetched.repos.map((repo) => [repo.name.toLowerCase(), repo]))
    const repoOf = (name: string) => byName.get(name.trim().toLowerCase())
    const projectIds = new Set(profile.projects.map((p) => p.id))
    const knownSkills = new Set(profile.skills.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))

    const catalog: GithubCatalog = {
      username: fetched.username,
      syncedAt: new Date().toISOString(),
      repos: fetched.repos.map((repo) => {
        const analyzed = analysis.repos.find((r) => r.name.toLowerCase() === repo.name.toLowerCase())
        return {
          name: repo.name,
          url: repo.url,
          summary: analyzed?.summary || repo.description,
          technologies: analyzed?.technologies || [repo.language, ...repo.topics].filter(Boolean).join(', '),
          stars: repo.stars,
          pushedAt: repo.pushedAt
        }
      })
    }
    store.saveGithubCatalog(catalog)

    return {
      catalog,
      suggestions: {
        newProjects: analysis.newProjects.flatMap((p) => {
          const repo = repoOf(p.repo)
          return repo ? [{ ...p, url: repo.url }] : []
        }),
        projectUpdates: analysis.projectUpdates.flatMap((u) => {
          const repo = repoOf(u.repo)
          return repo && projectIds.has(u.projectId) ? [{ ...u, url: repo.url }] : []
        }),
        newSkills: analysis.newSkills.filter((s) => s.skill.trim() && !knownSkills.has(s.skill.trim().toLowerCase())),
        experienceNotes: analysis.experienceNotes
      }
    }
  })

  ipcMain.handle('profile:importResumeFile', async () => {
    const engine = await getEngine()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Importar currículo existente',
      properties: ['openFile'],
      filters: [
        { name: 'Currículo', extensions: RESUME_FILE_EXTENSIONS },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return extractProfile(engine, await readResumeFile(result.filePaths[0]))
  })
}

if (!app.requestSingleInstanceLock()) {
  // Já existe um Guru rodando: ele recebe nossos argumentos pelo evento second-instance.
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // `guru --capture` permite ligar a captura a um atalho do próprio sistema.
    if (argv.includes(CAPTURE_FLAG)) captureFromShortcut()
    else showWindow()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => {
    // O app segue rodando em segundo plano; sair é pela bandeja.
  })

  void app.whenReady().then(() => {
    registerIpc()
    mainWindow = createWindow()
    createTray()
    void registerShortcut()
    mainWindow.once('ready-to-show', () => {
      if (process.argv.includes(CAPTURE_FLAG)) captureFromShortcut()
      else showWindow()
    })
  })
}
