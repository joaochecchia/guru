import { useEffect, useRef, useState } from 'react'
import { mergeImportedProfile, type MergeSummary } from '../../shared/merge'
import type { Course, Education, Experience, Language, Personal, Profile, Project } from '../../shared/types'
import { errorMessage, newId } from './util'

function describeImport(added: MergeSummary): string[] {
  const count = (n: number, one: string, many: string) => (n ? [`${n} ${n === 1 ? one : many}`] : [])
  return [
    ...count(added.personal, 'dado pessoal', 'dados pessoais'),
    ...(added.summary ? ['resumo profissional'] : []),
    ...count(added.experiences, 'experiência', 'experiências'),
    ...count(added.education, 'formação', 'formações'),
    ...count(added.courses, 'curso', 'cursos'),
    ...count(added.projects, 'projeto', 'projetos'),
    ...count(added.skills, 'habilidade', 'habilidades'),
    ...count(added.languages, 'idioma', 'idiomas'),
    ...(added.extras ? ['outras informações'] : [])
  ]
}

interface FieldDef<T> {
  key: keyof T & string
  label: string
  placeholder?: string
  multiline?: boolean
  wide?: boolean
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  wide?: boolean
}) {
  return (
    <label className={props.wide || props.multiline ? 'field wide' : 'field'}>
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea rows={4} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </label>
  )
}

function ListEditor<T extends { id: string }>(props: {
  title: string
  addLabel: string
  items: T[]
  fields: FieldDef<T>[]
  onChange: (items: T[]) => void
  extraAction?: React.ReactNode
}) {
  const { items, fields, onChange } = props
  const add = () => {
    const blank = Object.fromEntries(fields.map((f) => [f.key, ''])) as Record<string, string>
    onChange([...items, { ...blank, id: newId() } as unknown as T])
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>{props.title}</h2>
        <div className="actions">
          {props.extraAction}
          <button onClick={add}>{props.addLabel}</button>
        </div>
      </div>
      {items.length === 0 && <p className="hint">Nada cadastrado ainda.</p>}
      {items.map((item) => (
        <div className="entry" key={item.id}>
          <div className="grid">
            {fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                multiline={f.multiline}
                wide={f.wide}
                value={String(item[f.key] ?? '')}
                onChange={(value) => onChange(items.map((it) => (it.id === item.id ? { ...it, [f.key]: value } : it)))}
              />
            ))}
          </div>
          <button className="ghost danger" onClick={() => onChange(items.filter((it) => it.id !== item.id))}>
            Remover
          </button>
        </div>
      ))}
    </section>
  )
}

const PERSONAL_FIELDS: FieldDef<Personal>[] = [
  { key: 'name', label: 'Nome completo' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefone' },
  { key: 'location', label: 'Cidade / Estado' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/usuario' },
  { key: 'github', label: 'GitHub', placeholder: 'usuario' },
  { key: 'portfolio', label: 'Portfólio', placeholder: 'meusite.dev' }
]

const EXPERIENCE_FIELDS: FieldDef<Experience>[] = [
  { key: 'role', label: 'Cargo' },
  { key: 'company', label: 'Empresa' },
  { key: 'start', label: 'Início', placeholder: 'mar/2023' },
  { key: 'end', label: 'Fim', placeholder: 'atual' },
  {
    key: 'description',
    label: 'O que você fez',
    multiline: true,
    placeholder: 'Escreva com detalhes: responsabilidades, entregas, números. O Claude seleciona o que importa para cada vaga.'
  },
  { key: 'technologies', label: 'Tecnologias', wide: true, placeholder: 'TypeScript, React, PostgreSQL' }
]

const EDUCATION_FIELDS: FieldDef<Education>[] = [
  { key: 'degree', label: 'Curso', placeholder: 'Bacharelado em Ciência da Computação' },
  { key: 'institution', label: 'Instituição' },
  { key: 'start', label: 'Início', placeholder: '2021' },
  { key: 'end', label: 'Conclusão', placeholder: '2025 ou "cursando"' },
  { key: 'notes', label: 'Observações', wide: true, placeholder: 'TCC, iniciação científica, monitoria' }
]

const COURSE_FIELDS: FieldDef<Course>[] = [
  { key: 'name', label: 'Curso ou certificação', wide: true },
  { key: 'provider', label: 'Instituição' },
  { key: 'year', label: 'Ano' }
]

const PROJECT_FIELDS: FieldDef<Project>[] = [
  { key: 'name', label: 'Nome' },
  { key: 'url', label: 'Link' },
  { key: 'description', label: 'Descrição', multiline: true },
  { key: 'technologies', label: 'Tecnologias', wide: true }
]

const LANGUAGE_FIELDS: FieldDef<Language>[] = [
  { key: 'language', label: 'Idioma' },
  { key: 'level', label: 'Nível', placeholder: 'Avançado' }
]

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importingResume, setImportingResume] = useState(false)
  const [importReport, setImportReport] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const dirty = useRef(false)
  // Sempre aponta para o perfil da última renderização; usado depois de operações demoradas.
  const latestProfile = useRef(profile)
  latestProfile.current = profile

  useEffect(() => {
    window.guru.getProfile().then(setProfile, (e) => setStatus(errorMessage(e)))
  }, [])

  // Salva sozinho pouco depois da última alteração.
  useEffect(() => {
    if (!profile || !dirty.current) return
    const timer = setTimeout(() => {
      window.guru.saveProfile(profile).then(
        () => setStatus('Alterações salvas'),
        (e) => setStatus(`Erro ao salvar: ${errorMessage(e)}`)
      )
    }, 500)
    return () => clearTimeout(timer)
  }, [profile])

  if (!profile) return <div className="page">{status || 'Carregando…'}</div>

  const update = (patch: Partial<Profile>) => {
    dirty.current = true
    setStatus('Salvando…')
    setProfile({ ...profile, ...patch })
  }

  async function importGithub() {
    if (!profile) return
    setImporting(true)
    try {
      const repos = await window.guru.importGithub(profile.personal.github)
      const known = new Set(profile.projects.map((p) => p.url))
      const fresh = repos.filter((repo) => !known.has(repo.url))
      update({ projects: [...profile.projects, ...fresh] })
      setStatus(fresh.length ? `${fresh.length} projeto(s) importado(s) do GitHub` : 'Nenhum projeto novo no GitHub')
    } catch (e) {
      setStatus(errorMessage(e))
    } finally {
      setImporting(false)
    }
  }

  async function importResume() {
    setImportingResume(true)
    setImportReport(null)
    try {
      const imported = await window.guru.importResumeFile()
      const current = latestProfile.current
      if (!imported || !current) return
      // Mescla sobre o perfil mais recente, para não perder o que foi digitado durante a leitura.
      const merged = mergeImportedProfile(current, imported, newId)
      dirty.current = true
      setStatus('Salvando…')
      setProfile(merged.profile)
      const parts = describeImport(merged.added)
      setImportReport(
        parts.length
          ? { kind: 'ok', text: `Adicionado ao perfil: ${parts.join(', ')}. Revise os campos abaixo.` }
          : { kind: 'ok', text: 'O currículo foi lido, mas tudo o que ele contém já estava no seu perfil.' }
      )
    } catch (e) {
      setImportReport({ kind: 'error', text: errorMessage(e) })
    } finally {
      setImportingResume(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Meu perfil</h1>
        <p>
          Cadastre tudo o que você já fez, com detalhes. Estes dados ficam no seu computador e servem de base para
          cada currículo.
        </p>
        <span className="status" aria-live="polite">
          {status}
        </span>
      </header>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Importar currículo existente</h2>
            <p className="hint">
              O Claude lê o arquivo (PDF, DOCX, imagem ou TXT) e preenche os campos abaixo. Nada que você já
              cadastrou é apagado: só entram campos vazios e itens novos.
            </p>
          </div>
          <button className="primary" onClick={importResume} disabled={importingResume}>
            {importingResume ? 'Lendo currículo…' : 'Escolher arquivo'}
          </button>
        </div>
        {importReport && (
          <div className={importReport.kind === 'ok' ? 'notice ok' : 'notice error'} role="status">
            {importReport.text}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Dados pessoais</h2>
        <div className="grid">
          {PERSONAL_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              value={profile.personal[f.key]}
              onChange={(value) => update({ personal: { ...profile.personal, [f.key]: value } })}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Resumo profissional</h2>
        <Field
          label="Quem é você profissionalmente"
          multiline
          value={profile.summary}
          onChange={(summary) => update({ summary })}
          placeholder="Uma versão base. O Claude adapta o resumo a cada vaga."
        />
      </section>

      <ListEditor
        title="Experiências"
        addLabel="Adicionar experiência"
        items={profile.experiences}
        fields={EXPERIENCE_FIELDS}
        onChange={(experiences) => update({ experiences })}
      />
      <ListEditor
        title="Formação"
        addLabel="Adicionar formação"
        items={profile.education}
        fields={EDUCATION_FIELDS}
        onChange={(education) => update({ education })}
      />
      <ListEditor
        title="Cursos e certificações"
        addLabel="Adicionar curso"
        items={profile.courses}
        fields={COURSE_FIELDS}
        onChange={(courses) => update({ courses })}
      />
      <ListEditor
        title="Projetos"
        addLabel="Adicionar projeto"
        items={profile.projects}
        fields={PROJECT_FIELDS}
        onChange={(projects) => update({ projects })}
        extraAction={
          <button onClick={importGithub} disabled={importing || !profile.personal.github.trim()}>
            {importing ? 'Importando…' : 'Importar do GitHub'}
          </button>
        }
      />

      <section className="card">
        <h2>Habilidades</h2>
        <Field
          label="Separe por vírgula"
          multiline
          value={profile.skills}
          onChange={(skills) => update({ skills })}
          placeholder="TypeScript, React, Node.js, SQL, Docker, comunicação, trabalho em equipe"
        />
      </section>

      <ListEditor
        title="Idiomas"
        addLabel="Adicionar idioma"
        items={profile.languages}
        fields={LANGUAGE_FIELDS}
        onChange={(languages) => update({ languages })}
      />

      <section className="card">
        <h2>Outras informações</h2>
        <Field
          label="Voluntariado, prêmios, publicações, disponibilidade, modelo de trabalho"
          multiline
          value={profile.extras}
          onChange={(extras) => update({ extras })}
        />
      </section>
    </div>
  )
}
