import { useEffect, useRef, useState } from 'react'
import type { LiveEvent, LiveTurn } from '../../../shared/types'
import { Markdown } from './Markdown'
import { isWaitingTopic, mergeTopics, parseResponse, toPlainText, topicKey, type Topic } from './topics'
import { ScreenWatcher } from './watcher'

type Phase = 'idle' | 'starting' | 'watching' | 'paused' | 'error'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface Streaming {
  requestId: string
  text: string
  thinking: string
  /** Turno pedido no chat: a introdução da resposta vira balão. */
  fromChat: boolean
}

/** Máximo de prints mandados por pedido; os mais antigos saem da conversa. */
const MAX_IMAGES = 10
/** Intervalo mínimo entre análises automáticas, para não gastar a cada rolagem. */
const MIN_AUTO_INTERVAL_MS = 6000

const FIRST_TURN = 'Prints da página que estou vendo agora.'
const UPDATE_TURN = 'A tela mudou. Novos prints da página.'

/** Mantém só os prints mais recentes na conversa, para o pedido não crescer sem limite. */
function trimImages(turns: LiveTurn[]): LiveTurn[] {
  let budget = MAX_IMAGES
  return [...turns]
    .reverse()
    .map((turn) => {
      if (!turn.images?.length) return turn
      const keep = turn.images.slice(-Math.max(0, budget))
      budget -= keep.length
      if (keep.length === turn.images.length) return turn
      return { ...turn, images: keep, text: `${turn.text} (prints antigos omitidos)` }
    })
    .reverse()
}

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function Panel() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [startError, setStartError] = useState<string | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [notJob, setNotJob] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const turnsRef = useRef<LiveTurn[]>([])
  const pendingRef = useRef<string[]>([])
  const allFramesRef = useRef<string[]>([])
  const streamingRef = useRef<Streaming | null>(null)
  const topicsRef = useRef<Topic[]>([])
  const lastRunAt = useRef(0)
  const retryTimer = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const watcherRef = useRef<ScreenWatcher | null>(null)
  topicsRef.current = topics

  const busy = streaming !== null

  // ---------- Conversa com o Claude ----------

  function runTurn(turn: LiveTurn, fromChat: boolean) {
    const requestId = newRequestId()
    turnsRef.current = trimImages([...turnsRef.current, turn])
    const state: Streaming = { requestId, text: '', thinking: '', fromChat }
    streamingRef.current = state
    setStreaming(state)
    setRunError(null)
    lastRunAt.current = Date.now()
    window.guru.liveRun({ requestId, turns: turnsRef.current }).catch(() => {
      // Erros chegam pelo evento 'error'.
    })
  }

  function finish(event: Extract<LiveEvent, { kind: 'done' | 'error' }>) {
    const current = streamingRef.current
    if (!current) return
    streamingRef.current = null
    setStreaming(null)

    if (event.kind === 'error') {
      // Desfaz o turno do candidato para poder tentar de novo; prints voltam para a fila.
      const failed = turnsRef.current.pop()
      if (failed?.images?.length) pendingRef.current = [...failed.images, ...pendingRef.current]
      setRunError(event.message)
      return
    }
    if (!current.text.trim()) return

    turnsRef.current = [...turnsRef.current, { role: 'assistant', text: current.text }]
    const parsed = parseResponse(current.text)
    const onlyWaiting = parsed.topics.length > 0 && parsed.topics.every((t) => isWaitingTopic(t.title))
    setNotJob(onlyWaiting)
    setTopics((previous) => mergeTopics(previous, parsed.topics))
    setFresh(new Set(parsed.topics.map((t) => topicKey(t.title))))
    if (current.fromChat && parsed.intro) setChat((previous) => [...previous, { role: 'assistant', text: parsed.intro }])
    // Prints que chegaram durante a resposta são analisados em seguida.
    if (pendingRef.current.length) scheduleAnalysis()
  }

  useEffect(
    () =>
      window.guru.onLiveEvent((event) => {
        const current = streamingRef.current
        if (!current || event.requestId !== current.requestId) return
        if (event.kind === 'text' || event.kind === 'thinking') {
          const next =
            event.kind === 'text'
              ? { ...current, text: current.text + event.text }
              : { ...current, thinking: current.thinking + event.text }
          streamingRef.current = next
          setStreaming(next)
        } else {
          finish(event)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  function scheduleAnalysis() {
    if (retryTimer.current !== null) return
    const wait = Math.max(0, MIN_AUTO_INTERVAL_MS - (Date.now() - lastRunAt.current))
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null
      analyzePending()
    }, wait)
  }

  function analyzePending() {
    if (streamingRef.current || pendingRef.current.length === 0) return
    if (Date.now() - lastRunAt.current < MIN_AUTO_INTERVAL_MS) return scheduleAnalysis()
    const images = pendingRef.current
    pendingRef.current = []
    runTurn({ role: 'user', text: turnsRef.current.length === 0 ? FIRST_TURN : UPDATE_TURN, images }, false)
  }

  // ---------- Observação da tela ----------

  function getWatcher(): ScreenWatcher {
    if (!watcherRef.current) {
      watcherRef.current = new ScreenWatcher({
        onFrame: (image) => {
          pendingRef.current = [...pendingRef.current, image]
          allFramesRef.current = [...allFramesRef.current, image].slice(-MAX_IMAGES)
          setFrameCount((n) => n + 1)
        },
        onSettled: () => analyzePending(),
        onEnded: () => setPhase('idle')
      })
    }
    return watcherRef.current
  }

  async function start() {
    const watcher = getWatcher()
    if (watcher.running) {
      watcher.paused = false
      setPhase('watching')
      return
    }
    setPhase('starting')
    setStartError(null)
    try {
      await watcher.start()
      setPhase('watching')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setStartError(
        /denied|permission|abort|cancel/i.test(message)
          ? 'O compartilhamento de tela foi cancelado. Clique em Observar e escolha a tela onde está a vaga.'
          : `Não foi possível capturar a tela: ${message}`
      )
      setPhase('error')
    }
  }

  useEffect(
    () =>
      window.guru.onPanelStart(() => {
        if (!watcherRef.current?.running) void start()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => () => watcherRef.current?.stop(), [])

  function togglePause() {
    const watcher = watcherRef.current
    if (!watcher?.running) return void start()
    watcher.paused = !watcher.paused
    setPhase(watcher.paused ? 'paused' : 'watching')
  }

  function cancelRun() {
    const current = streamingRef.current
    if (current) window.guru.liveCancel(current.requestId)
  }

  function newJob() {
    cancelRun()
    streamingRef.current = null
    setStreaming(null)
    turnsRef.current = []
    pendingRef.current = []
    allFramesRef.current = []
    watcherRef.current?.reset()
    setTopics([])
    setChat([])
    setFresh(new Set())
    setFrameCount(0)
    setRunError(null)
    setNotJob(false)
  }

  function close() {
    cancelRun()
    watcherRef.current?.stop()
    setPhase('idle')
    window.guru.closePanel()
  }

  function sendToResume() {
    const notes = chat
      .filter((m) => m.role === 'user')
      .map((m) => `- ${m.text}`)
      .join('\n')
    window.guru.sendToResume(allFramesRef.current, notes)
  }

  function sendChat() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setChat((previous) => [...previous, { role: 'user', text }])
    const images = pendingRef.current
    pendingRef.current = []
    runTurn({ role: 'user', text, images }, true)
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  async function copy(topic: Topic) {
    try {
      await navigator.clipboard.writeText(toPlainText(topic.body))
      setCopied(topicKey(topic.title))
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      setRunError('Não foi possível copiar para a área de transferência.')
    }
  }

  function toggleCollapsed(key: string) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ---------- Tela ----------

  const live = streaming ? parseResponse(streaming.text) : null
  const shownTopics = live ? mergeTopics(topics, live.topics) : topics
  const writingKey = live?.topics.length ? topicKey(live.topics[live.topics.length - 1].title) : null
  const updatingKeys = new Set(live?.topics.map((t) => topicKey(t.title)) ?? [])
  const lastThinking = streaming?.thinking.trim().split('\n').filter(Boolean).pop() ?? ''

  const status = {
    idle: 'Parado',
    starting: 'Aguardando você escolher a tela…',
    watching: `Observando · ${frameCount} ${frameCount === 1 ? 'print' : 'prints'}`,
    paused: 'Pausado',
    error: 'Sem acesso à tela'
  }[phase]

  const orbState = busy ? 'thinking' : phase === 'watching' ? 'watching' : 'still'

  return (
    <div className="panel">
      <header className="panel-head">
        <div className={`orb ${orbState}`} aria-hidden="true" />
        <div className="panel-title">
          <strong>Guru</strong>
          <span>{busy ? 'Pensando…' : status}</span>
        </div>
        <div className="panel-actions">
          <button
            className="icon"
            onClick={togglePause}
            title={phase === 'watching' ? 'Pausar observação' : 'Observar a tela'}
            aria-label={phase === 'watching' ? 'Pausar observação' : 'Observar a tela'}
          >
            {phase === 'watching' ? '❚❚' : '▶'}
          </button>
          <button className="icon" onClick={newJob} title="Nova vaga: limpa tudo" aria-label="Nova vaga">
            ↺
          </button>
          <button className="icon" onClick={close} title="Fechar e parar de observar" aria-label="Fechar">
            ✕
          </button>
        </div>
      </header>

      <div className="panel-body">
        {phase === 'idle' && topics.length === 0 && (
          <div className="empty">
            <p>Abra a página da vaga e clique em Observar. Vou acompanhar enquanto você rola e montar as sugestões.</p>
            <button className="primary" onClick={() => void start()}>
              Observar a tela
            </button>
          </div>
        )}
        {phase === 'starting' && <p className="hint">Escolha a tela onde está a vaga na janela do sistema.</p>}
        {startError && (
          <div className="notice error">
            {startError}{' '}
            <button className="link" onClick={() => void start()}>
              Tentar de novo
            </button>
          </div>
        )}
        {phase === 'watching' && topics.length === 0 && !busy && (
          <p className="hint">Role a página da vaga devagar. Quando você parar, eu leio o que apareceu.</p>
        )}
        {notJob && !busy && <p className="hint">A tela atual não parece uma vaga nem um formulário.</p>}

        {shownTopics.map((topic) => {
          const key = topicKey(topic.title)
          const isField = /^campo:/i.test(topic.title)
          const isCollapsed = collapsed.has(key)
          const writing = key === writingKey
          return (
            <section
              key={key}
              className={['topic', isField && 'field', fresh.has(key) && !busy && 'fresh', updatingKeys.has(key) && 'updating']
                .filter(Boolean)
                .join(' ')}
            >
              <div className="topic-head">
                <button className="topic-title" onClick={() => toggleCollapsed(key)} aria-expanded={!isCollapsed}>
                  <span className="chevron">{isCollapsed ? '▸' : '▾'}</span>
                  {isField ? topic.title.replace(/^campo:\s*/i, '') : topic.title}
                </button>
                <button className="copy" onClick={() => void copy(topic)} disabled={!topic.body}>
                  {copied === key ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              {!isCollapsed && (
                <div className="topic-body">
                  <Markdown text={topic.body} />
                  {writing && <span className="caret" aria-hidden="true" />}
                </div>
              )}
            </section>
          )
        })}

        {(chat.length > 0 || (streaming?.fromChat && live?.intro)) && (
          <div className="chat" aria-live="polite">
            {chat.map((message, i) => (
              <div key={i} className={`bubble ${message.role}`}>
                <Markdown text={message.text} />
              </div>
            ))}
            {streaming?.fromChat && live?.intro && (
              <div className="bubble assistant">
                <Markdown text={live.intro} />
                {!live.topics.length && <span className="caret" aria-hidden="true" />}
              </div>
            )}
          </div>
        )}

        {runError && (
          <div className="notice error" role="alert">
            {runError}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="panel-foot">
        {busy && (
          <div className="thinking-line" aria-live="polite">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="thinking-text">{lastThinking || 'Analisando a página…'}</span>
          </div>
        )}
        <div className="composer">
          <textarea
            rows={2}
            value={input}
            placeholder={topics.length ? 'Peça uma alteração ou explicação…' : 'Pergunte algo sobre a vaga…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendChat()
              }
            }}
          />
          {busy ? (
            <button onClick={cancelRun}>Parar</button>
          ) : (
            <button className="primary" onClick={sendChat} disabled={!input.trim()}>
              Enviar
            </button>
          )}
        </div>
        <button className="pdf" onClick={sendToResume} disabled={allFramesRef.current.length === 0}>
          Gerar currículo em PDF com esta vaga
        </button>
      </footer>
    </div>
  )
}
