import { randomUUID } from 'node:crypto'
import type { Project } from '../shared/types'

interface Repo {
  name: string
  description: string | null
  html_url: string
  language: string | null
  topics?: string[]
  fork: boolean
  archived: boolean
}

/** Aceita "usuario", "@usuario" ou a URL do perfil e devolve os repositórios públicos próprios. */
export async function importGithubProjects(input: string): Promise<Project[]> {
  const username = input.trim().replace(/\/+$/, '').split('/').pop()?.replace(/^@/, '') ?? ''
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) {
    throw new Error('Informe um usuário do GitHub válido em Dados pessoais.')
  }
  const token = process.env.GITHUB_TOKEN?.trim()
  const response = await fetch(
    `https://api.github.com/users/${username}/repos?per_page=100&sort=pushed&type=owner`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'guru-desktop',
        // Opcional: com token o limite sobe de 60 para 5.000 requisições por hora.
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }
  )
  if (response.status === 401) throw new Error('O GITHUB_TOKEN configurado é inválido ou expirou.')
  if (response.status === 404) throw new Error(`Usuário "${username}" não encontrado no GitHub.`)
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      token
        ? 'O GitHub limitou as requisições deste token. Tente de novo mais tarde.'
        : 'O GitHub limitou as requisições anônimas. Tente de novo em alguns minutos ou defina GITHUB_TOKEN no .env.'
    )
  }
  if (!response.ok) throw new Error(`O GitHub respondeu com erro ${response.status}.`)

  const repos = (await response.json()) as Repo[]
  return repos
    .filter((repo) => !repo.fork && !repo.archived)
    .map((repo) => ({
      id: randomUUID(),
      name: repo.name,
      description: repo.description ?? '',
      technologies: [repo.language, ...(repo.topics ?? [])].filter(Boolean).join(', '),
      url: repo.html_url
    }))
}
