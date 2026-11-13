import { z } from 'zod'
import type { AiModel } from '../shared/types'
import type { Part, Task } from './engine'

const endpoint = 'https://api.openai.com/v1/responses'
const allowedModels = new Set(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'])

function apiModel(model: AiModel): string {
  const selected = model === 'codex-default' ? 'gpt-6.1-sol' : model
  if (!allowedModels.has(selected)) throw new Error('Escolha um modelo OpenAI em Configurações.')
  return selected
}

function inputPart(part: Part): Record<string, unknown> {
  if (part.type === 'text') return { type: 'input_text', text: part.text }
  if (part.type === 'image') {
    return { type: 'input_image', image_url: `data:${part.mediaType};base64,${part.data}` }
  }
  return {
    type: 'input_file',
    filename: 'curriculo.pdf',
    file_data: `data:application/pdf;base64,${part.data}`
  }
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  return json
}

async function request(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Sem conexão com a API da OpenAI. Verifique sua internet.')
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null
    const code = detail?.error?.code
    const message = detail?.error?.message ?? `HTTP ${response.status}`
    if (response.status === 401) throw new Error('Chave de API da OpenAI inválida. Confira em Configurações.')
    if (response.status === 429) throw new Error('Limite ou crédito da API da OpenAI atingido. Confira sua conta e tente novamente.')
    if (response.status === 403) throw new Error('Esta chave não tem acesso ao modelo escolhido.')
    throw new Error(`A API da OpenAI respondeu com erro ${code ?? response.status}: ${message}`)
  }
  return response
}

export async function runWithOpenAiApi<S extends z.ZodType>(
  apiKey: string,
  model: AiModel,
  task: Task<S>
): Promise<z.infer<S>> {
  const response = await request(apiKey, {
    model: apiModel(model),
    instructions: [task.system, task.context].filter(Boolean).join('\n\n'),
    input: [{ role: 'user', content: task.parts.map(inputPart) }],
    text: { format: { type: 'json_schema', name: 'guru_response', strict: true, schema: jsonSchema(task.schema) } },
    max_output_tokens: 16000
  })
  const result = await response.json() as {
    status?: string
    output_text?: string
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
    incomplete_details?: { reason?: string }
    error?: { message?: string }
  }
  if (result.status === 'incomplete') throw new Error('A resposta veio incompleta. Tente de novo.')
  if (result.error) throw new Error(result.error.message ?? 'A API da OpenAI não concluiu a tarefa.')
  const outputText = result.output_text ?? result.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('')
  if (!outputText) throw new Error('A API da OpenAI devolveu uma resposta vazia. Tente de novo.')
  let value: unknown
  try {
    value = JSON.parse(outputText)
  } catch {
    throw new Error('A API da OpenAI devolveu uma resposta fora do formato JSON esperado.')
  }
  const parsed = task.schema.safeParse(value)
  if (!parsed.success) throw new Error('A API da OpenAI devolveu dados fora do formato esperado. Tente de novo.')
  return parsed.data
}

export interface OpenAiLiveTurn {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

export async function runOpenAiLive(
  apiKey: string,
  model: AiModel,
  instructions: string,
  turns: OpenAiLiveTurn[],
  handlers: { onThinking(text: string): void; onText(text: string): void },
  signal: AbortSignal
): Promise<void> {
  const input = turns.filter((turn) => turn.text.trim() || turn.images?.length).map((turn) => turn.role === 'assistant'
    ? { role: 'assistant', content: turn.text }
    : {
        role: 'user',
        content: [
          ...(turn.images ?? []).map((image) => ({ type: 'input_image', image_url: image })),
          { type: 'input_text', text: turn.text }
        ]
      })
  const response = await request(apiKey, {
    model: apiModel(model), instructions, input, stream: true,
    reasoning: { effort: 'low', summary: 'auto' }
  }, signal)
  if (!response.body) throw new Error('A API da OpenAI não iniciou o fluxo de resposta.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const eventBlock = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = eventBlock.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
        if (!data || data === '[DONE]') continue
        let event: { type?: string; delta?: string; message?: string }
        try { event = JSON.parse(data) } catch { continue }
        if (event.type === 'response.output_text.delta' && event.delta) handlers.onText(event.delta)
        else if (event.type === 'response.reasoning_summary_text.delta' && event.delta) handlers.onThinking(event.delta)
        else if (event.type === 'response.failed') throw new Error(event.message ?? 'A API da OpenAI não concluiu a resposta.')
      }
    }
  } finally {
    reader.releaseLock()
  }
}
