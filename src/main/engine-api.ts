import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import type { AiModel } from '../shared/types'
import type { Part, Task } from './engine'

const API_MODELS: Record<AiModel, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5'
}

function toContent(part: Part): Anthropic.Beta.BetaContentBlockParam {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } }
    case 'pdf':
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } }
  }
}

/** Executa a tarefa pela API da Anthropic, com saída estruturada validada pelo servidor. */
export async function runWithApi<S extends z.ZodType>(apiKey: string, model: AiModel, task: Task<S>): Promise<z.infer<S>> {
  const client = new Anthropic({ apiKey })
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: task.system }]
  if (task.context) system.push({ type: 'text', text: task.context, cache_control: { type: 'ephemeral' } })

  try {
    const response = await client.beta.messages.parse({
      model: API_MODELS[model],
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(task.schema) },
      // Se o modelo principal recusar o pedido, a API tenta de novo em um modelo alternativo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: task.parts.map(toContent) }]
    })

    if (response.stop_reason === 'refusal') {
      throw new Error('O Claude recusou este pedido. Confira o conteúdo enviado e tente de novo.')
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new Error('A resposta veio incompleta. Tente de novo.')
    }
    return response.parsed_output
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new Error('Chave de API inválida. Confira a chave em Configurações.')
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      throw new Error('Esta chave de API não tem acesso ao modelo escolhido.')
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new Error('Limite de requisições atingido. Aguarde um pouco e tente de novo.')
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new Error('Sem conexão com a API da Anthropic. Verifique sua internet.')
    }
    if (error instanceof Anthropic.APIError) {
      throw new Error(`A API da Anthropic respondeu com erro ${error.status ?? ''}: ${error.message}`)
    }
    throw error
  }
}
