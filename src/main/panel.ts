import { BrowserWindow, screen, shell } from 'electron'
import path from 'node:path'
import type { PanelGeometry } from '../shared/types'

const WIDTH = 410
const HEIGHT = 680
const MARGIN = 12
/** Altura da barra superior do GNOME, onde fica o ícone do Guru; o painel abre logo abaixo dela. */
const TOP_BAR = 36

let panel: BrowserWindow | null = null

function placement(): { x: number; y: number; width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const y = area.y === 0 ? TOP_BAR + 4 : area.y + 4
  return {
    x: area.x + area.width - WIDTH - MARGIN,
    y,
    width: WIDTH,
    height: Math.min(HEIGHT, area.y + area.height - y - MARGIN)
  }
}

function createPanel(): BrowserWindow {
  const window = new BrowserWindow({
    ...placement(),
    show: false,
    frame: false,
    resizable: true,
    minWidth: 340,
    minHeight: 360,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Guru ao vivo',
    backgroundColor: '#15171c',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // 'floating' mantém o painel acima das janelas comuns sem cobrir menus e diálogos do sistema.
  window.setAlwaysOnTop(true, 'floating')
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.on('closed', () => {
    panel = null
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/panel.html'))
  return window
}

/** Mostra o painel no canto superior direito. Com start, pede para ele começar a observar a tela. */
export function openPanel(start: boolean): void {
  if (!panel) {
    panel = createPanel()
    panel.once('ready-to-show', () => {
      panel?.show()
      if (start) panel?.webContents.send('panel:start')
    })
    return
  }
  panel.setBounds(placement())
  panel.show()
  panel.focus()
  if (start) panel.webContents.send('panel:start')
}

export function hidePanel(): void {
  panel?.hide()
}

export function togglePanel(): void {
  if (panel?.isVisible()) hidePanel()
  else openPanel(true)
}

export function panelGeometry(): PanelGeometry {
  const bounds = panel?.getBounds() ?? placement()
  const display = screen.getDisplayMatching(bounds)
  return { panel: bounds, display: display.bounds }
}
