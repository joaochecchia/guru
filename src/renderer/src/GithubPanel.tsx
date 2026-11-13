import { useEffect, useState } from 'react'
import { applyGithubSuggestions, type GithubSelection } from '../../shared/merge'
import type { GithubCatalog, GithubSuggestions, Profile } from '../../shared/types'
import { errorMessage, newId } from './util'

interface Props {
  profile: Profile
  onApply: (profile: Profile) => void
}

const allIndexes = (items: unknown[]) => new Set(items.map((_, i) => i))

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function GithubPanel({ profile, onApply }: Props) {
  const [catalog, setCatalog] = useState<GithubCatalog | null>(null)
  const [suggestions, setSuggestions] = useState<GithubSuggestions | null>(null)
  const [selection, setSelection] = useState<GithubSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    window.guru.getGithubCatalog().then(setCatalog, () => setCatalog(null))
  }, [])

  const username = profile.personal.github.trim()

  async function analyze() {
    setBusy(true)
    setMessage(null)
    setSuggestions(null)
    try {
      const result = await window.guru.analyzeGithub(username, profile)
      setCatalog(result.catalog)
      const s = result.suggestions
      const total = s.newProjects.length + s.projectUpdates.length + s.newSkills.length + s.experienceNotes.length
      if (total === 0) {
        setMessage({
          kind: 'ok',
          text: `${result.catalog.repos.length} repositórios analisados. Seu perfil já cobre o que há neles.`
        })
        return
      }
      setSuggestions(s)
      // Tudo começa marcado; a pessoa desmarca o que não quiser.
      setSelection({
        newProjects: allIndexes(s.newProjects),
        projectUpdates: allIndexes(s.projectUpdates),
        newSkills: allIndexes(s.newSkills)
      })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  function toggle(group: keyof GithubSelection, index: number) {
    setSelection((current) => {
      if (!current) return current
      const next = new Set(current[group])
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return { ...current, [group]: next }
    })
  }

  function apply() {
    if (!suggestions || !selection) return
    onApply(applyGithubSuggestions(profile, suggestions, selection, newId))
    const count = selection.newProjects.size + selection.projectUpdates.size + selection.newSkills.size
    setSuggestions(null)
    setSelection(null)
    setMessage({ kind: 'ok', text: `${count} sugestão(ões) aplicada(s). Revise os campos abaixo.` })
  }

  const projectName = (id: string) => profile.projects.find((p) => p.id === id)?.name ?? 'Projeto'

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>GitHub</h2>
          <p className="hint">
            O Claude lê seus repositórios e READMEs, aponta projetos que faltam no perfil, dados incompletos e
            habilidades não listadas. Ao gerar currículos, ele também pode usar um repositório relevante para a vaga.
          </p>
        </div>
        <button className="primary" onClick={analyze} disabled={busy || !username}>
          {busy ? 'Analisando…' : catalog ? 'Sincronizar de novo' : 'Analisar repositórios'}
        </button>
      </div>

      {!username && <p className="hint">Preencha seu usuário do GitHub em Dados pessoais.</p>}
      {catalog && !busy && (
        <p className="hint">
          {catalog.repos.length} repositórios de <strong>{catalog.username}</strong> no catálogo, sincronizado em{' '}
          {formatDate(catalog.syncedAt)}.
        </p>
      )}
      {busy && (
        <div className="notice progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Buscando repositórios e lendo os READMEs. Pode levar um minuto.</span>
        </div>
      )}
      {message && (
        <div className={message.kind === 'ok' ? 'notice ok' : 'notice error'} role="status">
          {message.text}
        </div>
      )}

      {suggestions && selection && (
        <div className="suggestions">
          {suggestions.newProjects.length > 0 && (
            <div>
              <h3>Projetos que não estão no seu perfil</h3>
              {suggestions.newProjects.map((p, i) => (
                <label key={p.url} className="suggestion">
                  <input
                    type="checkbox"
                    checked={selection.newProjects.has(i)}
                    onChange={() => toggle('newProjects', i)}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="hint"> · {p.technologies}</span>
                    <br />
                    {p.description}
                    <br />
                    <em className="hint">{p.reason}</em>
                  </span>
                </label>
              ))}
            </div>
          )}

          {suggestions.projectUpdates.length > 0 && (
            <div>
              <h3>Projetos com informação faltando</h3>
              {suggestions.projectUpdates.map((u, i) => (
                <label key={u.projectId} className="suggestion">
                  <input
                    type="checkbox"
                    checked={selection.projectUpdates.has(i)}
                    onChange={() => toggle('projectUpdates', i)}
                  />
                  <span>
                    <strong>{projectName(u.projectId)}</strong>
                    <span className="hint"> · {u.reason}</span>
                    <br />
                    {u.description}
                    <br />
                    <span className="hint">Tecnologias: {u.technologies}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {suggestions.newSkills.length > 0 && (
            <div>
              <h3>Habilidades encontradas nos repositórios</h3>
              <div className="chips">
                {suggestions.newSkills.map((s, i) => (
                  <label key={s.skill} className="chip" title={`Aparece em: ${s.evidence}`}>
                    <input type="checkbox" checked={selection.newSkills.has(i)} onChange={() => toggle('newSkills', i)} />
                    {s.skill}
                  </label>
                ))}
              </div>
            </div>
          )}

          {suggestions.experienceNotes.length > 0 && (
            <div>
              <h3>Observações sobre suas experiências</h3>
              <p className="hint">Não são aplicadas automaticamente. Se fizer sentido, acrescente à experiência à mão.</p>
              <ul>
                {suggestions.experienceNotes.map((n, i) => (
                  <li key={i}>
                    <strong>{n.experience}:</strong> {n.note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="actions end">
            <button
              className="ghost"
              onClick={() => {
                setSuggestions(null)
                setSelection(null)
              }}
            >
              Descartar
            </button>
            <button className="primary" onClick={apply}>
              Aplicar selecionadas
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
