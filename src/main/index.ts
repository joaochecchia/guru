import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  CaptureEvent,
  GenerateRequest,
  GenerateResult,
  GithubAnalysisResult,
  GithubCatalog,
  LiveEvent,
  LiveRequest,
  Profile,
  SettingsInfo
} from '../shared/types'
import { captureScreen } from './capture'
import { analyzeGithubRepos, extractProfile, generateResume } from './claude'
import type { EngineConfig } from './engine'
import { detectClaudeCode } from './engine-claude-code'
import { detectCodex } from './engine-codex'
import { installGnomeShortcuts, isGnomeWayland } from './gnome-shortcut'
import { fetchGithubRepos } from './github'
import { htmlToPdf, renderResumeHtml } from './pdf'
import { runLive } from './live'
import { hidePanel, openPanel, panelGeometry, togglePanel } from './panel'
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
const LIVE_FLAG = '--live'
const isWayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland'

// No GNOME com Wayland o atalho é criado nas configurações de teclado do sistema (veja gnome-shortcut.ts).
const useSystemShortcut = isGnomeWayland()

// No GNOME com Wayland o Guru roda via XWayland, para o painel ao vivo abrir no canto superior direito:
// no Wayland nativo o GNOME ignora a posição pedida para a janela. A opção vem na linha de comando
// (scripts/run.mjs e o comando dos atalhos do GNOME). Ativada aqui pelo código ela chegaria tarde: o
// processo principal já teria iniciado no Wayland e só os filhos iriam para o X11, deixando as janelas
// invisíveis. O app empacotado, se for aberto sem a opção, se reabre com ela.
export const XWAYLAND_ARGS = ['--ozone-platform=x11', '--enable-features=WebRTCPipeWireCapturer']
const wantsXWayland = useSystemShortcut && process.env.GURU_NATIVE_WAYLAND !== '1'
if (wantsXWayland && app.isPackaged && !process.argv.includes(XWAYLAND_ARGS[0])) {
  app.relaunch({ args: [...process.argv.slice(1), ...XWAYLAND_ARGS] })
  app.exit(0)
}
const chromiumFeatures: string[] = []
// Em outros ambientes Wayland os atalhos globais só funcionam pelo portal do sistema (xdg-desktop-portal).
if (process.platform === 'linux' && !useSystemShortcut) chromiumFeatures.push('GlobalShortcutsPortal')
if (chromiumFeatures.length) app.commandLine.appendSwitch('enable-features', chromiumFeatures.join(','))

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
    mainWindow.webContents.send('capture:done', { images: [image], autoGenerate } satisfies CaptureEvent)
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
      await installGnomeShortcuts([
        { id: 'guru', name: 'Guru: capturar vaga', flag: CAPTURE_FLAG, accelerator: store.getShortcut() },
        { id: 'guru-live', name: 'Guru: modo ao vivo', flag: LIVE_FLAG, accelerator: store.getLiveShortcut() }
      ])
      shortcutRegistered = true
    } catch (error) {
      shortcutRegistered = false
      shortcutError = error instanceof Error ? error.message : String(error)
    }
  } else {
    try {
      shortcutRegistered = globalShortcut.register(store.getShortcut(), captureFromShortcut)
      globalShortcut.register(store.getLiveShortcut(), togglePanel)
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
  if (engine === 'codex') {
    const status = await detectCodex()
    if (!status.found || !status.path) throw new Error('Codex CLI não encontrado. Instale-o, faça login e selecione novamente em Configurações.')
    return { engine, model, cliPath: status.path }
  }
  const provider = engine === 'openai-api' ? 'openai' : 'anthropic'
  const { key } = await store.getApiKey(provider)
  if (!key) throw new Error(`Cadastre sua chave de API ${provider === 'openai' ? 'da OpenAI' : 'da Anthropic'} em Configurações.`)
  return { engine, model, apiKey: key }
}

async function settingsInfo(): Promise<SettingsInfo> {
  const anthropicKey = await store.getApiKey('anthropic')
  const openAiKey = await store.getApiKey('openai')
  return {
    hasAnthropicApiKey: Boolean(anthropicKey.key),
    anthropicApiKeySource: anthropicKey.source,
    hasOpenAiApiKey: Boolean(openAiKey.key),
    openAiApiKeySource: openAiKey.source,
    shortcut: store.getShortcut(),
    shortcutRegistered,
    shortcutError,
    shortcutViaSystem: useSystemShortcut,
    liveShortcut: store.getLiveShortcut(),
    wayland: isWayland,
    ...store.getAi(),
    claudeCode: await detectClaudeCode(),
    codex: await detectCodex()
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
        { label: 'Modo ao vivo', click: () => openPanel(true) },
        { label: 'Capturar vaga (um print)', click: captureFromShortcut },
        { label: 'Abrir o Guru', click: showWindow },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() }
      ])
    )
    // No GNOME (AppIndicator) o clique abre o menu; onde o clique chega ao app, ele abre o painel.
    tray.on('click', togglePanel)
  } catch {
    tray = null // Sem bandeja no sistema: abrir o app de novo traz a janela de volta.
  }
}

function registerIpc(): void {
  ipcMain.handle('profile:get', () => store.getProfile())
  ipcMain.handle('profile:save', (_event, profile: Profile) => store.saveProfile(profile))

  ipcMain.handle('settings:get', () => settingsInfo())
  ipcMain.handle('settings:setApiKey', async (_event, provider: 'anthropic' | 'openai', key: string) => {
    await store.setApiKey(provider, key)
    return settingsInfo()
  })
  ipcMain.handle('settings:setAi', (_event, choice: { engine?: unknown; model?: unknown }) => {
    store.setAi({
      ...(choice.engine === 'anthropic-api' || choice.engine === 'claude-code' || choice.engine === 'openai-api' || choice.engine === 'codex' ? { engine: choice.engine } : {}),
      ...(choice.model === 'opus' || choice.model === 'sonnet' || choice.model === 'gpt-6.1-sol' || choice.model === 'gpt-6.1-terra' || choice.model === 'gpt-6-luna' || choice.model === 'gpt-6-astra' || choice.model === 'codex-default' ? { model: choice.model } : {})
    })
    return settingsInfo()
  })
  ipcMain.handle('settings:detectClaudeCode', async () => {
    await detectClaudeCode(true)
    return settingsInfo()
  })
  ipcMain.handle('settings:detectCodex', async () => {
    await detectCodex(true)
    return settingsInfo()
  })
  ipcMain.handle('settings:setShortcut', async (_event, accelerator: string) => {
    store.setShortcut(accelerator.trim() || store.DEFAULT_SHORTCUT)
    await registerShortcut()
    return settingsInfo()
  })

  ipcMain.handle('settings:setLiveShortcut', async (_event, accelerator: string) => {
    store.setLiveShortcut(accelerator.trim() || store.DEFAULT_LIVE_SHORTCUT)
    await registerShortcut()
    return settingsInfo()
  })

  ipcMain.handle('capture:now', () => captureAndShow())

  // ---------- Modo ao vivo ----------
  const liveRuns = new Map<string, AbortController>()

  ipcMain.handle('live:run', async (event, request: LiveRequest) => {
    const send = (payload: LiveEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('live:event', payload)
    }
    const controller = new AbortController()
    liveRuns.set(request.requestId, controller)
    try {
      const engine = await getEngine()
      await runLive(
        engine,
        store.getProfile(),
        store.getGithubCatalog(),
        request.turns,
        {
          onThinking: (text) => send({ requestId: request.requestId, kind: 'thinking', text }),
          onText: (text) => send({ requestId: request.requestId, kind: 'text', text })
        },
        controller.signal
      )
      send({ requestId: request.requestId, kind: 'done' })
    } catch (error) {
      send({ requestId: request.requestId, kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      liveRuns.delete(request.requestId)
    }
  })
  ipcMain.on('live:cancel', (_event, requestId: string) => liveRuns.get(requestId)?.abort())
  ipcMain.handle('panel:geometry', () => panelGeometry())
  ipcMain.on('panel:close', () => hidePanel())
  ipcMain.on('panel:toResume', (_event, images: string[], notes: string) => {
    if (!mainWindow || !Array.isArray(images) || images.length === 0) return
    showWindow()
    mainWindow.webContents.send('capture:done', {
      images: images.slice(-10),
      autoGenerate: true,
      notes: typeof notes === 'string' ? notes : ''
    } satisfies CaptureEvent)
  })

  ipcMain.handle('resume:generate', async (_event, request: GenerateRequest): Promise<GenerateResult> => {
    const engine = await getEngine()
    if (!request.images?.length && !request.jobText.trim()) {
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
    else if (argv.includes(LIVE_FLAG)) togglePanel()
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
    // Captura contínua do painel ao vivo (getDisplayMedia): no Linux o portal do sistema pergunta qual
    // tela compartilhar uma vez e a transmissão segue até o painel parar.
    session.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((sources) => callback(sources[0] ? { video: sources[0] } : null))
          .catch(() => callback(null))
      },
      { useSystemPicker: true }
    )
    registerIpc()
    mainWindow = createWindow()
    createTray()
    void registerShortcut()
    mainWindow.once('ready-to-show', () => {
      if (process.argv.includes(CAPTURE_FLAG)) captureFromShortcut()
      else if (process.argv.includes(LIVE_FLAG)) openPanel(true)
      else showWindow()
    })
  })
}
