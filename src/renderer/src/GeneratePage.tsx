import { useEffect, useRef, useState } from 'react'
import type { GenerateResult } from '../../shared/types'
import { errorMessage } from './util'

interface Props {
  /** Um print (atalho de captura) ou vários (leitura enviada pelo painel ao vivo). */
  captures: string[]
  /** Ajustes pedidos no chat do painel ao vivo. */
  notes: string
  /** Muda a cada captura feita pelo atalho; cada mudança dispara a geração automática. */
  autoGenerateSignal: number
  onCapturesChange: (images: string[]) => void
  onOpenSettings: () => void
}

export function GeneratePage({ captures, notes, autoGenerateSignal, onCapturesChange, onOpenSettings }: Props) {
  const hasCapture = captures.length > 0
  const [jobText, setJobText] = useState('')
  const [busy, setBusy] = useState<'capture' | 'generate' | 'export' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const previewRef = useRef<HTMLIFrameElement>(null)

  async function run(kind: NonNullable<typeof busy>, task: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const captureNow = () => run('capture', async () => void (await window.guru.captureNow()))

  // Só a geração mais recente pode atualizar a tela: um novo atalho no meio de uma geração a substitui.
  const latestRequest = useRef(0)

  async function generateFor(images: string[], text: string) {
    const id = ++latestRequest.current
    setBusy('generate')
    setError(null)
    setSavedPath(null)
    try {
      const generated = await window.guru.generate({ images, jobText: text, notes })
      if (id === latestRequest.current) setResult(generated)
    } catch (e) {
      if (id === latestRequest.current) setError(errorMessage(e))
    } finally {
      if (id === latestRequest.current) setBusy(null)
    }
  }

  const generate = () => generateFor(captures, jobText)

  useEffect(() => {
    if (autoGenerateSignal === 0 || !hasCapture) return
    // Captura nova pelo atalho é uma vaga nova: descarta o texto colado e o currículo anterior.
    setJobText('')
    setResult(null)
    void generateFor(captures, '')
    // Reage só ao sinal; os prints chegam na mesma renderização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateSignal])

  const exportPdf = () =>
    run('export', async () => {
      if (!result) return
      // Exporta o HTML da prévia, já com as edições feitas à mão.
      const doc = previewRef.current?.contentDocument
      const html = doc ? `<!doctype html>${doc.documentElement.outerHTML}` : result.html
      const { title, company } = result.resume.job
      const path = await window.guru.exportPdf(html, ['Curriculo', title, company].filter(Boolean).join(' - '))
      if (path) setSavedPath(path)
    })

  // Erros que se resolvem em Configurações (chave, motor, Claude Code) ganham um atalho para lá.
  const needsSettings = /chave de API|Configurações|Claude Code/i.test(error ?? '')

  return (
    <div className="page">
      <header className="page-header">
        <h1>Gerar currículo</h1>
        <p>Capture a tela com a vaga aberta, ou cole o texto dela, e gere um currículo sob medida.</p>
      </header>

      <div className="card">
        <div className="card-head">
          <h2>Vaga</h2>
          <div className="actions">
            {hasCapture && (
              <button className="ghost" onClick={() => onCapturesChange([])} disabled={busy !== null}>
                {captures.length > 1 ? 'Remover prints' : 'Remover captura'}
              </button>
            )}
            <button onClick={captureNow} disabled={busy !== null}>
              {busy === 'capture' ? 'Capturando…' : hasCapture ? 'Capturar de novo' : 'Capturar tela'}
            </button>
          </div>
        </div>
        {captures.length === 1 && <img className="capture" src={captures[0]} alt="Captura da tela com a vaga" />}
        {captures.length > 1 && (
          <div className="capture-strip" aria-label={`${captures.length} prints da vaga`}>
            {captures.map((image, i) => (
              <img key={i} src={image} alt={`Print ${i + 1} da vaga`} />
            ))}
          </div>
        )}
        {notes && (
          <p className="hint">
            Ajustes pedidos no modo ao vivo entram na geração: <em>{notes}</em>
          </p>
        )}
        <label className="field">
          <span>Texto da vaga (opcional se houver captura)</span>
          <textarea
            rows={hasCapture ? 3 : 8}
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
            placeholder="Cole aqui a descrição da vaga. Útil quando ela não cabe em uma tela só."
          />
        </label>
        <div className="actions end">
          <button className="primary" onClick={generate} disabled={busy !== null || (!hasCapture && !jobText.trim())}>
            {busy === 'generate' ? 'Gerando, pode levar um minuto…' : result ? 'Gerar de novo' : 'Gerar currículo'}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          {needsSettings && (
            <button className="link" onClick={onOpenSettings}>
              Abrir Configurações
            </button>
          )}
        </div>
      )}

      {busy === 'generate' && !result && (
        <div className="notice progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>O Claude está montando seu currículo para esta vaga.</strong>
            <p className="hint">Isso costuma levar menos de um minuto. A prévia aparece aqui quando estiver pronta.</p>
          </div>
        </div>
      )}

      {result && (
        <>
          {result.resume.gaps.length > 0 && (
            <div className="notice warn">
              <strong>Requisitos da vaga que seu perfil não cobre</strong>
              <ul>
                {result.resume.gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>
                  {result.resume.job.title}
                  {result.resume.job.company && ` · ${result.resume.job.company}`}
                </h2>
                <p className="hint">Clique no texto da prévia para editar antes de exportar.</p>
              </div>
              <button className="primary" onClick={exportPdf} disabled={busy !== null}>
                {busy === 'export' ? 'Exportando…' : 'Exportar PDF'}
              </button>
            </div>
            {savedPath && <div className="notice ok">PDF salvo em {savedPath}</div>}
            <iframe
              ref={previewRef}
              className="preview"
              title="Prévia do currículo"
              sandbox="allow-same-origin"
              srcDoc={result.html}
              onLoad={(e) => {
                const doc = e.currentTarget.contentDocument
                if (doc) doc.designMode = 'on'
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
