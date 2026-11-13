import type Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs/promises'
import path from 'node:path'

export const RESUME_FILE_EXTENSIONS = ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md']

const MAX_BYTES = 20 * 1024 * 1024

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
} as const

/** Converte o arquivo do currículo em um bloco de conteúdo que o Claude consegue ler. */
export async function readResumeFile(filePath: string): Promise<Anthropic.Beta.BetaContentBlockParam> {
  const ext = path.extname(filePath).toLowerCase()
  const { size } = await fs.stat(filePath)
  if (size > MAX_BYTES) throw new Error('O arquivo passa de 20 MB. Exporte uma versão menor do currículo.')

  if (ext === '.pdf') {
    const data = (await fs.readFile(filePath)).toString('base64')
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }

  if (ext in IMAGE_TYPES) {
    const data = (await fs.readFile(filePath)).toString('base64')
    const media_type = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES]
    return { type: 'image', source: { type: 'base64', media_type, data } }
  }

  let text: string
  if (ext === '.docx') {
    // Importado sob demanda: o pacote só é carregado quando alguém importa um DOCX.
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ path: filePath })).value
  } else if (ext === '.txt' || ext === '.md') {
    text = await fs.readFile(filePath, 'utf8')
  } else if (ext === '.doc') {
    throw new Error('O formato .doc antigo não é suportado. Salve o arquivo como .docx ou PDF e tente de novo.')
  } else {
    throw new Error(`Formato ${ext || 'desconhecido'} não suportado. Use PDF, DOCX, imagem ou TXT.`)
  }

  if (!text.trim()) throw new Error('Não encontrei texto neste arquivo. Se ele for escaneado, envie como PDF ou imagem.')
  return { type: 'text', text: `<curriculo>\n${text.trim()}\n</curriculo>` }
}
