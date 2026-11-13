import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AiModel, ClaudeCodeStatus } from '../shared/types'
import type { Task } from './engine'

/**
 * Motor experimental: executa a tarefa pelo Claude Code instalado na máquina (`claude -p`), com a
 * assinatura da própria pessoa em vez da API.
 *
 * Isolamento: --restricted remove as ferramentas que executam comandos, confina a leitura de arquivos
 * à pasta da tarefa e ignora as configurações pessoais do Claude Code; --tools Read deixa só a leitura.
 * Os anexos (print, PDF) são gravados numa pasta temporária que é apagada ao final.
 */

const run = promisify(execFile)
const TIMEOUT_MS = 5 * 60 * 1000

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

/** Caminhos comuns de instalação; um app aberto pelo atalho do sistema pode não ter o PATH do terminal. */
function candidatePaths(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [path.join(home, '.local', 'bin', 'claude.exe'), 'claude.exe']
  }
  return [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    'claude'
  ]
}

let cached: ClaudeCodeStatus | null = null

/** Procura o Claude Code e lê a versão. O resultado fica em cache até `refresh`. */
export async function detectClaudeCode(refresh = false): Promise<ClaudeCodeStatus> {
  if (cached && !refresh) return cached
  for (const candidate of candidatePaths()) {
    try {
      const { stdout } = await run(candidate, ['--version'], { timeout: 15000, env: cleanEnv() })
      cached = { found: true, path: candidate, version: stdout.trim().split(/\s+/)[0] ?? '' }
      return cached
    } catch {
      // Tenta o próximo caminho.
    }
  }
  cached = { found: false, path: null, version: null }
  return cached
}

/**
 * Remove do ambiente a chave de API (senão o Claude Code cobraria da API em vez de usar a assinatura)
 * e as variáveis de uma sessão do Claude Code em andamento, que confundem o processo filho.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key === 'ANTHROPIC_API_KEY' ||
      key === 'ANTHROPIC_AUTH_TOKEN' ||
      key === 'CLAUDECODE' ||
      key === 'CLAUDE_PID' ||
      key === 'ELECTRON_RUN_AS_NODE' ||
      key.startsWith('CLAUDE_CODE_') ||
      key.startsWith('CLAUDE_AGENT_SDK')
    ) {
      delete env[key]
    }
  }
  return env
}

export interface CliResult {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  structured_output?: unknown
}

function spawnClaude(cliPath: string, args: string[], cwd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('O Claude Code demorou mais de 5 minutos e foi interrompido. Tente de novo.'))
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Não foi possível executar o Claude Code (${error.message}).`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // Com --output-format json o resultado vem no stdout mesmo quando a tarefa falha.
      if (stdout.trim()) resolve(stdout)
      else reject(new Error(`O Claude Code encerrou com código ${code}. ${stderr.trim().slice(0, 500)}`))
    })
    child.stdin.end(input)
  })
}

export function explainFailure(result: CliResult): string {
  const text = result.result ?? ''
  if (/login|log in|api key|authenticat|credential/i.test(text)) {
    return 'O Claude Code não está logado. Abra um terminal, rode `claude` e entre com sua conta usando /login.'
  }
  if (/limit|usage|quota/i.test(text)) {
    return `Limite de uso da assinatura atingido: ${text.slice(0, 300)}`
  }
  return `O Claude Code não concluiu a tarefa${text ? `: ${text.slice(0, 400)}` : '.'}`
}

export async function runWithClaudeCode<S extends z.ZodType>(
  cliPath: string,
  model: AiModel,
  task: Task<S>
): Promise<z.infer<S>> {
  const jobDir = path.join(app.getPath('userData'), 'claude-code', `${Date.now()}-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(jobDir, { recursive: true, mode: 0o700 })
  try {
    // Texto vai no próprio pedido; imagens e PDFs viram arquivos que o Claude Code lê com a ferramenta Read.
    const promptParts: string[] = []
    if (task.context) promptParts.push(task.context)
    let n = 0
    for (const part of task.parts) {
      if (part.type === 'text') {
        promptParts.push(part.text)
        continue
      }
      const name = `anexo-${++n}.${part.type === 'pdf' ? 'pdf' : EXT[part.mediaType]}`
      await fs.writeFile(path.join(jobDir, name), Buffer.from(part.data, 'base64'), { mode: 0o600 })
      promptParts.push(`Arquivo anexado: ./${name} (leia com a ferramenta Read antes de responder).`)
    }

    const system =
      `${task.system}\n\n` +
      'Os arquivos anexados estão na pasta de trabalho atual. Leia-os com a ferramenta Read. ' +
      'Entregue a resposta no formato estruturado solicitado, sem texto adicional.'

    // O validador do Claude Code não conhece a referência de dialeto que o Zod inclui; o schema em si é igual.
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(task.schema) as Record<string, unknown>

    const args = [
      '-p',
      '--output-format',
      'json',
      '--restricted',
      '--strict-mcp-config',
      '--tools',
      'Read',
      '--no-session-persistence',
      '--model',
      model,
      '--system-prompt',
      system,
      '--json-schema',
      JSON.stringify(jsonSchema)
    ]

    const stdout = await spawnClaude(cliPath, args, jobDir, promptParts.join('\n\n'))
    let result: CliResult
    try {
      result = JSON.parse(stdout) as CliResult
    } catch {
      throw new Error(`O Claude Code devolveu uma resposta inesperada: ${stdout.slice(0, 300)}`)
    }
    if (result.is_error || result.subtype !== 'success') throw new Error(explainFailure(result))

    const parsed = task.schema.safeParse(result.structured_output)
    if (!parsed.success) throw new Error('O Claude Code devolveu dados fora do formato esperado. Tente de novo.')
    return parsed.data
  } finally {
    // A pasta tem o print da vaga e possivelmente o currículo: não fica no disco.
    await fs.rm(jobDir, { recursive: true, force: true })
  }
}
