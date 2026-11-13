import type { z } from 'zod'
import type { AiModel } from '../shared/types'

/** Um pedaço da entrada de uma tarefa. Imagens e PDFs vão em base64. */
export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }
  | { type: 'pdf'; data: string }

/** Uma tarefa com saída estruturada, independente de qual motor vai executá-la. */
export interface Task<S extends z.ZodType> {
  schema: S
  /** Instruções da tarefa. */
  system: string
  /** Contexto grande e estável (perfil, catálogo). Na API vai em cache. */
  context?: string
  /** Entrada do pedido. */
  parts: Part[]
}

export type EngineConfig =
  | { engine: 'anthropic-api'; apiKey: string; model: AiModel }
  | { engine: 'claude-code'; cliPath: string; model: AiModel }
  | { engine: 'openai-api'; apiKey: string; model: AiModel }
  | { engine: 'codex'; cliPath: string; model: AiModel }

export async function runTask<S extends z.ZodType>(config: EngineConfig, task: Task<S>): Promise<z.infer<S>> {
  // Importados sob demanda para cada motor carregar só o que usa.
  if (config.engine === 'anthropic-api') {
    const { runWithApi } = await import('./engine-api')
    return runWithApi(config.apiKey, config.model, task)
  }
  if (config.engine === 'claude-code') {
    const { runWithClaudeCode } = await import('./engine-claude-code')
    return runWithClaudeCode(config.cliPath, config.model, task)
  }
  if (config.engine === 'openai-api') {
    const { runWithOpenAiApi } = await import('./engine-openai-api')
    return runWithOpenAiApi(config.apiKey, config.model, task)
  }
  const { runWithCodex } = await import('./engine-codex')
  return runWithCodex(config.cliPath, config.model, task)
}
