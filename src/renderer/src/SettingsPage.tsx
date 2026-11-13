import { useEffect, useState } from 'react'
import type { SettingsInfo } from '../../shared/types'
import { errorMessage } from './util'

export function SettingsPage() {
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.guru.getSettings().then((settings) => {
      setInfo(settings)
      setShortcut(settings.shortcut)
    })
  }, [])

  if (!info) return <div className="page">Carregando…</div>

  async function apply(task: () => Promise<SettingsInfo>, done: string) {
    try {
      const next = await task()
      setInfo(next)
      setShortcut(next.shortcut)
      setMessage(done)
    } catch (e) {
      setMessage(errorMessage(e))
    }
  }

  const keyStatus = {
    stored: 'Chave cadastrada e guardada no cofre de senhas do sistema.',
    env: 'Usando a chave da variável de ambiente ANTHROPIC_API_KEY.',
    none: 'Nenhuma chave cadastrada.'
  }[info.apiKeySource]

  return (
    <div className="page">
      <header className="page-header">
        <h1>Configurações</h1>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="card">
        <h2>Chave de API da Anthropic</h2>
        <p className="hint">
          {keyStatus} Crie a sua em{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          . Cada currículo gerado é cobrado na sua conta da Anthropic.
        </p>
        <div className="inline">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            aria-label="Chave de API"
          />
          <button
            className="primary"
            disabled={!apiKey.trim()}
            onClick={() =>
              apply(async () => {
                const next = await window.guru.setApiKey(apiKey)
                setApiKey('')
                return next
              }, 'Chave salva.')
            }
          >
            Salvar chave
          </button>
          {info.apiKeySource === 'stored' && (
            <button className="ghost danger" onClick={() => apply(() => window.guru.setApiKey(''), 'Chave removida.')}>
              Remover
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Atalho de captura</h2>
        <p className="hint">
          Formato do Electron, por exemplo <code>CommandOrControl+Y</code> ou <code>Alt+Shift+C</code>.
        </p>
        <div className="inline">
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} aria-label="Atalho de captura" />
          <button onClick={() => apply(() => window.guru.setShortcut(shortcut), 'Atalho atualizado.')}>
            Aplicar
          </button>
        </div>
        <p className={info.shortcutRegistered ? 'hint' : 'notice warn'}>
          {info.shortcutRegistered
            ? info.shortcutViaSystem
              ? 'Atalho criado nas configurações de teclado do GNOME, com o nome "Guru: capturar vaga". Funciona mesmo com a janela fechada.'
              : 'Atalho registrado.'
            : info.shortcutError
              ? `Não foi possível criar o atalho: ${info.shortcutError}`
              : 'O sistema não aceitou o registro deste atalho. Tente outra combinação.'}
        </p>
        {info.wayland && !info.shortcutViaSystem && (
          <p className="hint">
            Você está no Wayland, onde o sistema controla os atalhos globais e pode pedir confirmação. Se o atalho não
            responder, crie um atalho personalizado nas configurações de teclado do sistema que execute o Guru com o
            argumento <code>--capture</code>.
          </p>
        )}
      </section>
    </div>
  )
}
