export interface Topic {
  title: string
  body: string
}

export interface ParsedResponse {
  /** Texto antes do primeiro "## ": a resposta curta do chat. */
  intro: string
  topics: Topic[]
}

/** Separa uma resposta em Markdown (possivelmente ainda incompleta, em streaming) em introdução e tópicos. */
export function parseResponse(text: string): ParsedResponse {
  const lines = text.split('\n')
  const intro: string[] = []
  const topics: Topic[] = []
  let current: { title: string; body: string[] } | null = null
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading && !line.startsWith('###')) {
      if (current) topics.push({ title: current.title, body: current.body.join('\n').trim() })
      current = { title: heading[1], body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      intro.push(line)
    }
  }
  if (current) topics.push({ title: current.title, body: current.body.join('\n').trim() })
  return { intro: intro.join('\n').trim(), topics }
}

export const topicKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ')

/** "Aguardando vaga" é um aviso de estado, não um cartão. */
export const isWaitingTopic = (title: string) => topicKey(title) === 'aguardando vaga'

/** Substitui os tópicos de mesmo título e acrescenta os novos ao fim, preservando a ordem existente. */
export function mergeTopics(base: Topic[], updates: Topic[]): Topic[] {
  const result = base.map((topic) => ({ ...topic }))
  for (const update of updates) {
    if (isWaitingTopic(update.title)) continue
    const index = result.findIndex((topic) => topicKey(topic.title) === topicKey(update.title))
    if (index >= 0) result[index] = update
    else result.push(update)
  }
  return result
}

/** Converte o Markdown de um tópico em texto simples para colar em formulários. */
export function toPlainText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/(^|[\s(])[*_](\S.*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
    )
    .join('\n')
    .trim()
}
