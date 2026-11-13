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

// ---------- Contratos de IPC ----------

export interface SettingsInfo {
  hasApiKey: boolean
  apiKeySource: 'stored' | 'env' | 'none'
  shortcut: string
  shortcutRegistered: boolean
  shortcutError: string | null
  /** true quando o atalho é criado nas configurações de teclado do sistema (GNOME com Wayland). */
  shortcutViaSystem: boolean
  wayland: boolean
}

export interface CaptureEvent {
  image: string
  /** true quando a captura veio do atalho ou da bandeja: a geração começa sozinha. */
  autoGenerate: boolean
}

export interface GenerateRequest {
  imageDataUrl: string | null
  jobText: string
}

export interface GenerateResult {
  resume: TailoredResume
  html: string
}

export interface GuruApi {
  getProfile(): Promise<Profile>
  saveProfile(profile: Profile): Promise<void>
  getSettings(): Promise<SettingsInfo>
  setApiKey(key: string): Promise<SettingsInfo>
  setShortcut(accelerator: string): Promise<SettingsInfo>
  captureNow(): Promise<string>
  onCapture(callback: (capture: CaptureEvent) => void): () => void
  generate(request: GenerateRequest): Promise<GenerateResult>
  exportPdf(html: string, suggestedName: string): Promise<string | null>
  importGithub(username: string): Promise<Project[]>
  /** Abre o seletor de arquivo e devolve o que o Claude extraiu, ou null se a pessoa cancelar. */
  importResumeFile(): Promise<ProfileImport | null>
}
