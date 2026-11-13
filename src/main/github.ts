import type { GithubRepoInfo } from '../shared/types'

const MAX_REPOS = 30
const MAX_README_CHARS = 4000
const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README', 'README.rst', 'README.txt']

interface ApiRepo {
  name: string
  full_name: string
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  topics?: string[]
  stargazers_count: number
  pushed_at: string
  default_branch: string
  fork: boolean
  private: boolean
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || undefined
}

function authHeaders(): Record<string, string> {
  const t = token()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** Aceita "usuario", "@usuario" ou a URL do perfil. */
export function parseGithubUsername(input: string): string {
  const username = input.trim().replace(/\/+$/, '').split('/').pop()?.replace(/^@/, '') ?? ''
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) {
    throw new Error('Informe um usuário do GitHub válido em Dados pessoais.')
  }
  return username
}

async function listRepos(username: string): Promise<ApiRepo[]> {
  // Com token, /user/repos inclui os repositórios privados do dono do token.
  const url = token()
    ? 'https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=100'
    : `https://api.github.com/users/${username}/repos?type=owner&sort=pushed&per_page=100`
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'guru-desktop', ...authHeaders() }
  })
  if (response.status === 401) throw new Error('O GITHUB_TOKEN configurado é inválido ou expirou.')
  if (response.status === 404) throw new Error(`Usuário "${username}" não encontrado no GitHub.`)
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      token()
        ? 'O GitHub limitou as requisições deste token. Tente de novo mais tarde.'
        : 'O GitHub limitou as requisições anônimas. Tente de novo em alguns minutos ou defina GITHUB_TOKEN no .env.'
    )
  }
  if (!response.ok) throw new Error(`O GitHub respondeu com erro ${response.status}.`)
  return (await response.json()) as ApiRepo[]
}

/** Lê o README pelo raw.githubusercontent.com, que não consome o limite da API do GitHub. */
async function fetchReadme(repo: ApiRepo): Promise<string> {
  for (const name of README_NAMES) {
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/${repo.full_name}/${encodeURIComponent(repo.default_branch)}/${name}`,
        { headers: { 'User-Agent': 'guru-desktop', ...(repo.private ? authHeaders() : {}) } }
      )
      if (response.ok) {
        const text = (await response.text()).trim()
        return text.length > MAX_README_CHARS ? `${text.slice(0, MAX_README_CHARS)}\n[README truncado]` : text
      }
    } catch {
      // Falha de rede em um README não deve derrubar a sincronização inteira.
    }
  }
  return ''
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

/** Busca os repositórios próprios mais recentes, com README, para o Claude analisar. */
export async function fetchGithubRepos(input: string): Promise<{ username: string; repos: GithubRepoInfo[] }> {
  const username = parseGithubUsername(input)
  const repos = (await listRepos(username)).filter((repo) => !repo.fork).slice(0, MAX_REPOS)
  if (repos.length === 0) throw new Error('Nenhum repositório próprio encontrado nesta conta do GitHub.')

  const readmes = await mapLimit(repos, 6, fetchReadme)
  return {
    username,
    repos: repos.map((repo, i) => ({
      name: repo.name,
      url: repo.html_url,
      description: repo.description ?? '',
      homepage: repo.homepage ?? '',
      language: repo.language ?? '',
      topics: repo.topics ?? [],
      stars: repo.stargazers_count,
      pushedAt: repo.pushed_at,
      private: repo.private,
      readme: readmes[i]
    }))
  }
}
