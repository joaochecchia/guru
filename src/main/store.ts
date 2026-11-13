import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { emptyProfile, type AiEngine, type AiModel, type GithubCatalog, type Profile } from '../shared/types'

export const DEFAULT_SHORTCUT = 'CommandOrControl+Y'
/** Padrão anterior, trocado porque o Ctrl+Shift+G já é usado pelos navegadores (busca anterior). */
const LEGACY_DEFAULT_SHORTCUT = 'CommandOrControl+Shift+G'

interface SettingsFile {
  shortcut: string
  apiKeyEncrypted: string | null
  openAiApiKeyEncrypted?: string | null
  engine: AiEngine
  model: AiModel
  liveShortcut?: string
}

const DEFAULT_SETTINGS: SettingsFile = {
  shortcut: DEFAULT_SHORTCUT,
  apiKeyEncrypted: null,
  engine: 'anthropic-api',
  model: 'opus'
}

function file(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file(name), 'utf8')) }
  } catch {
    return fallback
  }
}

function writeJson(name: string, data: unknown): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  const target = file(name)
  // Grava em arquivo temporário e renomeia, para não corromper os dados se o app fechar no meio.
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(`${target}.tmp`, target)
}

export function getProfile(): Profile {
  const stored = readJson<Profile>('profile.json', emptyProfile)
  return { ...stored, personal: { ...emptyProfile.personal, ...stored.personal } }
}

export function saveProfile(profile: Profile): void {
  writeJson('profile.json', profile)
}

export function getGithubCatalog(): GithubCatalog | null {
  const catalog = readJson<GithubCatalog | null>('github.json', null)
  return catalog && Array.isArray(catalog.repos) ? catalog : null
}

export function saveGithubCatalog(catalog: GithubCatalog): void {
  writeJson('github.json', catalog)
}

function getSettings(): SettingsFile {
  return readJson<SettingsFile>('settings.json', DEFAULT_SETTINGS)
}

export function getShortcut(): string {
  const { shortcut } = getSettings()
  return !shortcut || shortcut === LEGACY_DEFAULT_SHORTCUT ? DEFAULT_SHORTCUT : shortcut
}

export function getAi(): { engine: AiEngine; model: AiModel } {
  const { engine, model } = getSettings()
  const validEngines: AiEngine[] = ['anthropic-api', 'claude-code', 'openai-api', 'codex']
  const validModels: AiModel[] = ['opus', 'sonnet', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra', 'codex-default']
  return {
    engine: validEngines.includes(engine) ? engine : 'anthropic-api',
    model: validModels.includes(model) ? model : 'opus'
  }
}

export function setAi(choice: { engine?: AiEngine; model?: AiModel }): void {
  writeJson('settings.json', { ...getSettings(), ...getAi(), ...choice })
}

export const DEFAULT_LIVE_SHORTCUT = 'CommandOrControl+Alt+Y'

export function getLiveShortcut(): string {
  return getSettings().liveShortcut || DEFAULT_LIVE_SHORTCUT
}

export function setLiveShortcut(liveShortcut: string): void {
  writeJson('settings.json', { ...getSettings(), liveShortcut })
}

export function setShortcut(shortcut: string): void {
  writeJson('settings.json', { ...getSettings(), shortcut })
}

// Usa a API assíncrona do safeStorage. A síncrona (encryptString/decryptString) está depreciada
// e, no Linux, não grava a senha no chaveiro: cada execução sorteava uma senha nova e a chave
// salva deixava de ser legível ao reabrir o app.

async function canEncrypt(): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  // Sem chaveiro no Linux o Electron cai para uma senha fixa, o que não protege nada.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

async function encrypt(plain: string): Promise<string> {
  return (await safeStorage.encryptStringAsync(plain)).toString('base64')
}

export async function setApiKey(provider: 'anthropic' | 'openai', key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) {
    writeJson('settings.json', provider === 'anthropic'
      ? { ...getSettings(), apiKeyEncrypted: null }
      : { ...getSettings(), openAiApiKeyEncrypted: null })
    return
  }
  if (!(await canEncrypt())) {
    throw new Error(
      'O sistema não tem um cofre de senhas disponível para guardar a chave com segurança. ' +
        `Defina a variável de ambiente ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} antes de abrir o app.`
    )
  }
  const encrypted = await encrypt(trimmed)
  writeJson('settings.json', provider === 'anthropic'
    ? { ...getSettings(), apiKeyEncrypted: encrypted }
    : { ...getSettings(), openAiApiKeyEncrypted: encrypted })
}

export async function getApiKey(provider: 'anthropic' | 'openai'): Promise<{ key: string | null; source: 'stored' | 'env' | 'none' }> {
  const { apiKeyEncrypted } = getSettings()
  const settings = getSettings()
  const encrypted = provider === 'anthropic' ? apiKeyEncrypted : settings.openAiApiKeyEncrypted
  if (encrypted) {
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
      if (shouldReEncrypt) {
        const replacement = await encrypt(result)
        writeJson('settings.json', provider === 'anthropic'
          ? { ...getSettings(), apiKeyEncrypted: replacement }
          : { ...getSettings(), openAiApiKeyEncrypted: replacement })
      }
      return { key: result, source: 'stored' }
    } catch {
      // Cofre indisponível ou chave gravada em outra máquina: cai para a variável de ambiente.
    }
  }
  const env = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  return env ? { key: env, source: 'env' } : { key: null, source: 'none' }
}
