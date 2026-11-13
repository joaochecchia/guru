import type { GithubSuggestions, Personal, Profile, ProfileImport } from './types'

/** Índices das sugestões que a pessoa marcou para aplicar. */
export interface GithubSelection {
  newProjects: Set<number>
  projectUpdates: Set<number>
  newSkills: Set<number>
}

/** Aplica as sugestões do GitHub selecionadas. Projetos com o mesmo link não são duplicados. */
export function applyGithubSuggestions(
  profile: Profile,
  suggestions: GithubSuggestions,
  selection: GithubSelection,
  newId: () => string
): Profile {
  const updates = new Map(
    suggestions.projectUpdates.filter((_, i) => selection.projectUpdates.has(i)).map((u) => [u.projectId, u])
  )
  const projects = profile.projects.map((project) => {
    const update = updates.get(project.id)
    if (!update) return project
    return {
      ...project,
      description: update.description.trim() || project.description,
      technologies: update.technologies.trim() || project.technologies,
      url: project.url.trim() || update.url
    }
  })

  const knownUrls = new Set(projects.map((p) => norm(p.url)).filter(Boolean))
  for (const [i, suggestion] of suggestions.newProjects.entries()) {
    if (!selection.newProjects.has(i) || knownUrls.has(norm(suggestion.url))) continue
    knownUrls.add(norm(suggestion.url))
    projects.push({
      id: newId(),
      name: suggestion.name,
      description: suggestion.description,
      technologies: suggestion.technologies,
      url: suggestion.url
    })
  }

  const currentSkills = profile.skills.split(',').map((s) => s.trim()).filter(Boolean)
  const knownSkills = new Set(currentSkills.map(norm))
  for (const [i, { skill }] of suggestions.newSkills.entries()) {
    const clean = skill.trim()
    if (!selection.newSkills.has(i) || !clean || knownSkills.has(norm(clean))) continue
    knownSkills.add(norm(clean))
    currentSkills.push(clean)
  }

  return { ...profile, projects, skills: currentSkills.join(', ') }
}

export interface MergeSummary {
  personal: number
  experiences: number
  education: number
  courses: number
  projects: number
  skills: number
  languages: number
  summary: boolean
  extras: boolean
}

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

/** Adiciona ao fim da lista os itens importados que ainda não existem, comparando pela chave. */
function appendNew<T, I>(
  existing: T[],
  imported: I[],
  keyOf: (item: T | I) => string,
  build: (item: I) => T
): { items: T[]; added: number } {
  const seen = new Set(existing.map(keyOf).filter(Boolean))
  const fresh: T[] = []
  for (const item of imported) {
    const key = keyOf(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(build(item))
  }
  return { items: [...existing, ...fresh], added: fresh.length }
}

/**
 * Mescla um currículo importado no perfil sem apagar nada que a pessoa já cadastrou:
 * campos de texto só são preenchidos se estiverem vazios, e listas só ganham itens novos.
 */
export function mergeImportedProfile(
  profile: Profile,
  imported: ProfileImport,
  newId: () => string
): { profile: Profile; added: MergeSummary } {
  const personal = { ...profile.personal }
  let personalFilled = 0
  for (const key of Object.keys(personal) as (keyof Personal)[]) {
    const value = imported.personal[key]?.trim()
    if (!personal[key].trim() && value) {
      personal[key] = value
      personalFilled++
    }
  }

  const experiences = appendNew(
    profile.experiences,
    imported.experiences,
    (e) => (e.company || e.role ? `${norm(e.company)}|${norm(e.role)}|${norm(e.start)}` : ''),
    (e) => ({ id: newId(), ...e })
  )
  const education = appendNew(
    profile.education,
    imported.education,
    (e) => (e.institution || e.degree ? `${norm(e.institution)}|${norm(e.degree)}` : ''),
    (e) => ({ id: newId(), ...e })
  )
  const courses = appendNew(
    profile.courses,
    imported.courses,
    (c) => norm(c.name),
    (c) => ({ id: newId(), ...c })
  )
  const projects = appendNew(
    profile.projects,
    imported.projects,
    (p) => norm(p.url) || norm(p.name),
    (p) => ({ id: newId(), ...p })
  )
  const languages = appendNew(
    profile.languages,
    imported.languages,
    (l) => norm(l.language),
    (l) => ({ id: newId(), ...l })
  )

  const currentSkills = profile.skills.split(',').map((s) => s.trim()).filter(Boolean)
  const knownSkills = new Set(currentSkills.map(norm))
  const newSkills: string[] = []
  for (const raw of imported.skills) {
    const skill = raw.trim()
    if (!skill || knownSkills.has(norm(skill))) continue
    knownSkills.add(norm(skill))
    newSkills.push(skill)
  }
  const skills = [...currentSkills, ...newSkills].join(', ')

  const fillSummary = !profile.summary.trim() && Boolean(imported.summary.trim())
  const fillExtras = !profile.extras.trim() && Boolean(imported.extras.trim())

  return {
    profile: {
      personal,
      summary: fillSummary ? imported.summary.trim() : profile.summary,
      experiences: experiences.items,
      education: education.items,
      courses: courses.items,
      projects: projects.items,
      skills,
      languages: languages.items,
      extras: fillExtras ? imported.extras.trim() : profile.extras
    },
    added: {
      personal: personalFilled,
      experiences: experiences.added,
      education: education.added,
      courses: courses.added,
      projects: projects.added,
      skills: newSkills.length,
      languages: languages.added,
      summary: fillSummary,
      extras: fillExtras
    }
  }
}
