import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * No GNOME com Wayland o atalho global do Electron depende do portal GlobalShortcuts, que na prática
 * não liga a tecla para apps fora do Flatpak. O caminho confiável é um atalho personalizado do próprio
 * GNOME que executa o Guru com --capture; a instância aberta recebe o pedido pelo single-instance lock.
 */

const run = promisify(execFile)

const SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys'
const ITEM_SCHEMA = `${SCHEMA}.custom-keybinding`
const ITEM_BASE = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/'

export function isGnomeWayland(): boolean {
  return (
    process.platform === 'linux' &&
    process.env.XDG_SESSION_TYPE === 'wayland' &&
    (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase().split(':').includes('GNOME')
  )
}

/** Converte o formato do Electron ("CommandOrControl+Shift+G") para o do GNOME ("<Control><Shift>g"). */
export function toGnomeAccelerator(accelerator: string): string {
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key) throw new Error('Atalho vazio.')
  const modifiers: Record<string, string> = {
    commandorcontrol: '<Control>',
    cmdorctrl: '<Control>',
    control: '<Control>',
    ctrl: '<Control>',
    shift: '<Shift>',
    alt: '<Alt>',
    option: '<Alt>',
    super: '<Super>',
    meta: '<Super>',
    command: '<Super>',
    cmd: '<Super>'
  }
  const mods = parts.map((p) => {
    const mod = modifiers[p.toLowerCase()]
    if (!mod) throw new Error(`Modificador "${p}" não reconhecido.`)
    return mod
  })
  // Nomes de tecla do Electron que diferem dos keysyms do GTK.
  const keys: Record<string, string> = { space: 'space', plus: 'plus', enter: 'Return', esc: 'Escape' }
  return mods.join('') + (keys[key.toLowerCase()] ?? (key.length === 1 ? key.toLowerCase() : key))
}

/** Comando que o GNOME executa: abre o Guru com a flag (ou entrega o pedido à instância aberta). */
function commandFor(flag: string): string {
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  // Mesmas opções de scripts/run.mjs: no GNOME com Wayland o Guru roda via XWayland (veja index.ts).
  const platform = process.env.GURU_NATIVE_WAYLAND === '1' ? '' : ' --ozone-platform=x11 --enable-features=WebRTCPipeWireCapturer'
  if (app.isPackaged) return `${quote(process.execPath)}${platform} ${flag}`
  // Em desenvolvimento o Electron do npm não tem o chrome-sandbox configurado como root. No Ubuntu,
  // que restringe user namespaces pelo AppArmor, ele aborta ao ser aberto pelo GNOME (no terminal do
  // VS Code funciona porque herda o perfil do VS Code). Este processo só repassa o pedido de captura
  // ao Guru já aberto e encerra; o build empacotado precisa configurar o sandbox no instalador.
  return `${quote(process.execPath)} ${quote(app.getAppPath())} --no-sandbox${platform} ${flag}`
}

async function gsettings(...args: string[]): Promise<string> {
  try {
    const { stdout } = await run('gsettings', args)
    return stdout.trim()
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * O gsettings interpreta o valor como texto GVariant. Passar a string crua quebra quando ela contém
 * aspas (como o comando, que cita os caminhos), então todo valor vai como string GVariant escapada.
 */
function gvString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export interface GnomeShortcut {
  /** Identificador na lista de atalhos do GNOME (vira parte do caminho no dconf). */
  id: string
  name: string
  /** Flag passada ao Guru, como --capture ou --live. */
  flag: string
  accelerator: string
}

/** Cria ou atualiza atalhos personalizados do Guru no GNOME. */
export async function installGnomeShortcuts(shortcuts: GnomeShortcut[]): Promise<void> {
  const current = await gsettings('get', SCHEMA, 'custom-keybindings')
  const paths = [...current.matchAll(/'([^']*)'/g)].map((m) => m[1])
  const missing = shortcuts.map((s) => `${ITEM_BASE}${s.id}/`).filter((p) => !paths.includes(p))
  if (missing.length) {
    const list = [...paths, ...missing].map(gvString).join(', ')
    await gsettings('set', SCHEMA, 'custom-keybindings', `[${list}]`)
  }
  for (const shortcut of shortcuts) {
    const item = `${ITEM_SCHEMA}:${ITEM_BASE}${shortcut.id}/`
    // A tecla vai por último: o atalho só fica ativo quando o comando já está gravado.
    await gsettings('set', item, 'name', gvString(shortcut.name))
    await gsettings('set', item, 'command', gvString(commandFor(shortcut.flag)))
    await gsettings('set', item, 'binding', gvString(toGnomeAccelerator(shortcut.accelerator)))
  }
}
