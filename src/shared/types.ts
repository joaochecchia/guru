import { z } from 'zod'

// ---------- Perfil-mestre (fica só na máquina do usuário) ----------

export interface Personal {
  name: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  portfolio: string
}

export interface Experience {
  id: string
  company: string
  role: string
  start: string
  end: string
  description: string
  technologies: string
}

export interface Education {
  id: string
  institution: string
  degree: string
  start: string
  end: string
  notes: string
}

export interface Course {
  id: string
  name: string
  provider: string
  year: string
}

export interface Project {
  id: string
  name: string
  description: string
  technologies: string
  url: string
}

export interface Language {
  id: string
  language: string
  level: string
}

export interface Profile {
  personal: Personal
  summary: string
  experiences: Experience[]
  education: Education[]
  courses: Course[]
  projects: Project[]
  skills: string
  languages: Language[]
  extras: string
}

export const emptyProfile: Profile = {
  personal: { name: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '' },
  summary: '',
  experiences: [],
  education: [],
  courses: [],
  projects: [],
  skills: '',
  languages: [],
  extras: ''
}

// ---------- Currículo sob medida (saída estruturada do Claude) ----------

export const TailoredResumeSchema = z.object({
  job: z.object({
    title: z.string().describe('Título da vaga'),
    company: z.string().describe('Empresa da vaga; string vazia se não aparecer'),
    language: z.enum(['pt', 'en']).describe('Idioma em que a vaga foi escrita')
  }),
  headline: z.string().describe('Título profissional curto, alinhado à vaga'),
  summary: z.string().describe('Resumo profissional de 2 a 4 frases'),
  experiences: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      period: z.string(),
      bullets: z.array(z.string())
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      technologies: z.string(),
      url: z.string()
    })
  ),
  education: z.array(z.object({ institution: z.string(), degree: z.string(), period: z.string() })),
  courses: z.array(z.object({ name: z.string(), provider: z.string(), year: z.string() })),
  skills: z.array(z.string()),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  gaps: z
    .array(z.string())
    .describe('Requisitos da vaga que o perfil não cobre. Não entram no currículo; servem de aviso ao candidato.')
})

export type TailoredResume = z.infer<typeof TailoredResumeSchema>

// ---------- Importação de currículo existente (saída estruturada do Claude) ----------

export const ProfileImportSchema = z.object({
  personal: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string().describe('Cidade e estado, se aparecerem'),
    linkedin: z.string(),
    github: z.string().describe('Usuário ou URL do GitHub, como aparece no documento'),
    portfolio: z.string().describe('Site pessoal ou portfólio, exceto LinkedIn e GitHub')
  }),
  summary: z.string(),
  experiences: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      start: z.string().describe('Como aparece no documento, por exemplo "mar/2023" ou "2021"'),
      end: z.string().describe('Como aparece no documento; "atual" se for o emprego atual'),
      description: z.string().describe('Todas as atividades e resultados citados, um por linha'),
      technologies: z.string().describe('Tecnologias citadas nesta experiência, separadas por vírgula')
    })
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string(),
      start: z.string(),
      end: z.string(),
      notes: z.string()
    })
  ),
  courses: z.array(z.object({ name: z.string(), provider: z.string(), year: z.string() })),
  projects: z.array(
    z.object({ name: z.string(), description: z.string(), technologies: z.string(), url: z.string() })
  ),
  skills: z.array(z.string()),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  extras: z.string().describe('Voluntariado, prêmios, publicações e outras informações sem seção própria')
})

export type ProfileImport = z.infer<typeof ProfileImportSchema>

// ---------- GitHub ----------

/** Repositório como vem do GitHub, com README truncado. Vai para o Claude na análise. */
export interface GithubRepoInfo {
  name: string
  url: string
  description: string
  homepage: string
  language: string
  topics: string[]
  stars: number
  pushedAt: string
  private: boolean
  readme: string
}

export const GithubAnalysisSchema = z.object({
  repos: z
    .array(
      z.object({
        name: z.string().describe('Nome exato do repositório recebido'),
        summary: z.string().describe('1 ou 2 frases factuais sobre o que o projeto é e faz'),
        technologies: z.string().describe('Tecnologias principais, separadas por vírgula')
      })
    )
    .describe('Um item por repositório recebido, inclusive os triviais'),
  newProjects: z.array(
    z.object({
      repo: z.string().describe('Nome exato do repositório'),
      name: z.string().describe('Nome do projeto como deve aparecer no currículo'),
      description: z.string().describe('Descrição pronta para currículo, 1 a 3 frases'),
      technologies: z.string(),
      reason: z.string().describe('Por que vale incluir, em uma frase curta')
    })
  ),
  projectUpdates: z.array(
    z.object({
      projectId: z.string().describe('id do projeto já cadastrado no perfil'),
      repo: z.string().describe('Nome exato do repositório correspondente'),
      description: z.string().describe('Descrição completa melhorada, não só o trecho novo'),
      technologies: z.string().describe('Lista completa de tecnologias'),
      reason: z.string().describe('O que estava faltando, em uma frase curta')
    })
  ),
  newSkills: z.array(
    z.object({
      skill: z.string(),
      evidence: z.string().describe('Repositório(s) onde aparece')
    })
  ),
  experienceNotes: z.array(
    z.object({
      experience: z.string().describe('Cargo e empresa da experiência cadastrada'),
      note: z.string().describe('O que o repositório sugere que poderia ser acrescentado')
    })
  )
})

export type GithubAnalysis = z.infer<typeof GithubAnalysisSchema>

export interface GithubCatalogEntry {
  name: string
  url: string
  summary: string
  technologies: string
  stars: number
  pushedAt: string
}

/** Resumo dos repositórios, salvo localmente e usado na geração de currículos. */
export interface GithubCatalog {
  username: string
  syncedAt: string
  repos: GithubCatalogEntry[]
}

/** Sugestões já resolvidas: links vêm do GitHub, nunca do modelo. */
export interface GithubSuggestions {
  newProjects: (GithubAnalysis['newProjects'][number] & { url: string })[]
  projectUpdates: (GithubAnalysis['projectUpdates'][number] & { url: string })[]
  newSkills: GithubAnalysis['newSkills']
  experienceNotes: GithubAnalysis['experienceNotes']
}

export interface GithubAnalysisResult {
  catalog: GithubCatalog
  suggestions: GithubSuggestions
}

// ---------- Contratos de IPC ----------

/** Provedor e forma de execução da IA. */
export type AiEngine = 'anthropic-api' | 'claude-code' | 'openai-api' | 'codex'
export type AiModel = 'opus' | 'sonnet' | 'gpt-6.1-sol' | 'gpt-6.1-terra' | 'gpt-6-luna' | 'gpt-6-astra' | 'codex-default'

export interface ClaudeCodeStatus {
  found: boolean
  path: string | null
  version: string | null
}

export interface CodexStatus {
  found: boolean
  path: string | null
  version: string | null
}

export interface SettingsInfo {
  engine: AiEngine
  model: AiModel
  claudeCode: ClaudeCodeStatus
  codex: CodexStatus
  hasAnthropicApiKey: boolean
  anthropicApiKeySource: 'stored' | 'env' | 'none'
  hasOpenAiApiKey: boolean
  openAiApiKeySource: 'stored' | 'env' | 'none'
  shortcut: string
  shortcutRegistered: boolean
  shortcutError: string | null
  /** true quando o atalho é criado nas configurações de teclado do sistema (GNOME com Wayland). */
  shortcutViaSystem: boolean
  /** Atalho do modo ao vivo (painel com sugestões em tempo real). */
  liveShortcut: string
  wayland: boolean
}

export interface CaptureEvent {
  /** Um print (atalho de captura) ou vários (leitura completa enviada pelo painel ao vivo). */
  images: string[]
  /** true quando a captura veio do atalho, da bandeja ou do painel: a geração começa sozinha. */
  autoGenerate: boolean
  /** Ajustes que a pessoa pediu no chat do painel, para o PDF já sair com eles. */
  notes?: string
}

export interface GenerateRequest {
  images: string[]
  jobText: string
  notes?: string
}

// ---------- Modo ao vivo ----------

/** Um turno da conversa do painel. Prints vão como data URLs JPEG. */
export interface LiveTurn {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

export interface LiveRequest {
  requestId: string
  turns: LiveTurn[]
}

export type LiveEvent = { requestId: string } & (
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }
)

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Posição do painel e da tela, para o painel esconder a si mesmo nos prints. */
export interface PanelGeometry {
  panel: Rect
  display: Rect
}

export interface GenerateResult {
  resume: TailoredResume
  html: string
}

export interface GuruApi {
  getProfile(): Promise<Profile>
  saveProfile(profile: Profile): Promise<void>
  getSettings(): Promise<SettingsInfo>
  setApiKey(provider: 'anthropic' | 'openai', key: string): Promise<SettingsInfo>
  setShortcut(accelerator: string): Promise<SettingsInfo>
  setAi(choice: { engine?: AiEngine; model?: AiModel }): Promise<SettingsInfo>
  /** Procura o Claude Code de novo (depois de instalar, por exemplo). */
  detectClaudeCode(): Promise<SettingsInfo>
  detectCodex(): Promise<SettingsInfo>
  captureNow(): Promise<string>
  onCapture(callback: (capture: CaptureEvent) => void): () => void
  generate(request: GenerateRequest): Promise<GenerateResult>
  exportPdf(html: string, suggestedName: string): Promise<string | null>
  /** Busca os repositórios, pede ao Claude o catálogo e as sugestões, e salva o catálogo. */
  analyzeGithub(username: string, profile: Profile): Promise<GithubAnalysisResult>
  getGithubCatalog(): Promise<GithubCatalog | null>
  /** Abre o seletor de arquivo e devolve o que o Claude extraiu, ou null se a pessoa cancelar. */
  importResumeFile(): Promise<ProfileImport | null>

  // Modo ao vivo (usado pela janela do painel)
  setLiveShortcut(accelerator: string): Promise<SettingsInfo>
  /** Executa um turno com streaming; o texto chega por onLiveEvent. Resolve quando termina. */
  liveRun(request: LiveRequest): Promise<void>
  liveCancel(requestId: string): void
  onLiveEvent(callback: (event: LiveEvent) => void): () => void
  /** O processo principal pede ao painel para começar a observar (atalho ou bandeja). */
  onPanelStart(callback: () => void): () => void
  panelGeometry(): Promise<PanelGeometry>
  closePanel(): void
  /** Abre a janela principal gerando o PDF a partir dos prints e ajustes do painel. */
  sendToResume(images: string[], notes: string): void
}
