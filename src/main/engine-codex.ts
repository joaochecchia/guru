import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AiModel, CodexStatus } from '../shared/types'
import type { Task } from './engine'

const exec = promisify(execFile)
const timeoutMs = 5 * 60 * 1000
const imageExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

function candidates(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') return [path.join(home, '.local', 'bin', 'codex.exe'), 'codex.exe']
  return [
    path.join(home, '.local', 'bin', 'codex'),
    '/usr/lib/chatgpt/resources/codex',
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    'codex'
  ]
}

let cached: CodexStatus | null = null

export async function detectCodex(refresh = false): Promise<CodexStatus> {
  if (cached && !refresh) return cached
  for (const candidate of candidates()) {
    try {
      const { stdout } = await exec(candidate, ['--version'], { timeout: 15000 })
      cached = { found: true, path: candidate, version: stdout.trim().split(/\s+/).at(-1) ?? '' }
      return cached
    } catch {
      // Tenta o próximo caminho.
    }
  }
  cached = { found: false, path: null, version: null }
  return cached
}

function spawnCodex(cliPath: string, args: string[], cwd: string, prompt: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { cwd, env: process.env, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error(`Não foi possível executar o Codex CLI (${error.message}).`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return resolve()
      if (code === 0) return resolve()
      reject(new Error(`O Codex CLI encerrou com código ${code}. ${stderr.trim().slice(0, 600)}`))
    })
    child.stdin.end(prompt)
  })
}

export async function runWithCodex<S extends z.ZodType>(
  cliPath: string,
  model: AiModel,
  task: Task<S>,
  signal?: AbortSignal,
  onText?: (text: string) => void
): Promise<z.infer<S>> {
  const jobDir = path.join(app.getPath('userData'), 'codex', `${Date.now()}-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(jobDir, { recursive: true, mode: 0o700 })
  try {
    const promptParts = [task.system]
    if (task.context) promptParts.push(task.context)
    let imageCount = 0
    const args = [
      'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only',
      '--cd', jobDir, '--color', 'never', '--output-schema', path.join(jobDir, 'schema.json'),
      '--output-last-message', path.join(jobDir, 'response.json')
    ]
    if (model !== 'codex-default') args.push('--model', model)
    for (const part of task.parts) {
      if (part.type === 'text') {
        promptParts.push(part.text)
      } else {
        const extension = part.type === 'pdf' ? 'pdf' : imageExt[part.mediaType]
        const name = `anexo-${++imageCount}.${extension}`
        await fs.writeFile(path.join(jobDir, name), Buffer.from(part.data, 'base64'), { mode: 0o600 })
        if (part.type === 'pdf') promptParts.push(`Leia o PDF anexado usando o caminho ${name}.`)
        else args.push('--image', path.join(jobDir, name))
      }
    }
    const { $schema: _dialect, ...schema } = z.toJSONSchema(task.schema) as Record<string, unknown>
    await fs.writeFile(path.join(jobDir, 'schema.json'), JSON.stringify(schema), { mode: 0o600 })
    promptParts.push('Responda somente no formato JSON definido pelo schema de saída.')
    await spawnCodex(cliPath, args.concat('--', '-'), jobDir, promptParts.join('\n\n'), signal)
    if (signal?.aborted) return undefined as z.infer<S>
    const raw = await fs.readFile(path.join(jobDir, 'response.json'), 'utf8')
    onText?.(raw)
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error(`O Codex devolveu uma resposta inesperada: ${raw.slice(0, 300)}`)
    }
    const parsed = task.schema.safeParse(value)
    if (!parsed.success) throw new Error('O Codex devolveu dados fora do formato esperado. Tente de novo.')
    return parsed.data
  } catch (error) {
    if (signal?.aborted) return undefined as z.infer<S>
    throw error
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true })
  }
}
