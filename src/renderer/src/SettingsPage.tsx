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
        <h2>Motor de IA</h2>
        <div className="options" role="radiogroup" aria-label="Motor de IA">
          <label className="option">
            <input
              type="radio"
              name="engine"
              checked={info.engine === 'api'}
              onChange={() => apply(() => window.guru.setAi({ engine: 'api' }), 'Usando a API da Anthropic.')}
            />
            <span>
              <strong>API da Anthropic</strong> <span className="badge">Recomendado</span>
              <br />
              <span className="hint">Cobrado por uso na sua conta da API. Mais rápido e com formato garantido.</span>
            </span>
          </label>
          <label className="option">
            <input
              type="radio"
              name="engine"
              checked={info.engine === 'claude-code'}
              onChange={() =>
                apply(() => window.guru.setAi({ engine: 'claude-code' }), 'Usando o Claude Code com sua assinatura.')
              }
            />
            <span>
              <strong>Claude Code com sua assinatura</strong> <span className="badge warn">Experimental</span>
              <br />
              <span className="hint">
                Usa o Claude Code instalado neste computador e conta no limite de uso da sua assinatura Pro ou Max.
              </span>
            </span>
          </label>
        </div>

        {info.engine === 'claude-code' && (
          <>
            <div className={info.claudeCode.found ? 'notice ok' : 'notice error'}>
              {info.claudeCode.found ? (
                <>
                  Claude Code {info.claudeCode.version} encontrado em <code>{info.claudeCode.path}</code>. Ele precisa
                  estar logado: se a geração falhar por login, rode <code>claude</code> num terminal e use{' '}
                  <code>/login</code>.
                </>
              ) : (
                <>
                  Claude Code não encontrado. Instale seguindo{' '}
                  <a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">
                    o guia oficial
                  </a>
                  , faça login e clique em Procurar de novo.
                </>
              )}{' '}
              <button
                className="link"
                onClick={() => apply(() => window.guru.detectClaudeCode(), 'Busca pelo Claude Code concluída.')}
              >
                Procurar de novo
              </button>
            </div>
            <div className="notice warn">
              <strong>Antes de usar, leia sobre os termos.</strong> A Anthropic restringe o uso de assinaturas do
              claude.ai por produtos de terceiros. Este modo existe para uso pessoal, com o Claude Code e a conta da
              própria pessoa. Na dúvida, use a API.
            </div>
          </>
        )}

        <h3 className="subhead">Modelo</h3>
        <div className="options" role="radiogroup" aria-label="Modelo">
          <label className="option">
            <input
              type="radio"
              name="model"
              checked={info.model === 'opus'}
              onChange={() => apply(() => window.guru.setAi({ model: 'opus' }), 'Modelo: Claude Opus.')}
            />
            <span>
              <strong>Opus</strong>
              <br />
              <span className="hint">Melhor qualidade de escrita e seleção do que importa para cada vaga.</span>
            </span>
          </label>
          <label className="option">
            <input
              type="radio"
              name="model"
              checked={info.model === 'sonnet'}
              onChange={() => apply(() => window.guru.setAi({ model: 'sonnet' }), 'Modelo: Claude Sonnet.')}
            />
            <span>
              <strong>Sonnet</strong>
              <br />
              <span className="hint">
                {info.engine === 'api'
                  ? 'Metade do custo do Opus na API e mais rápido. Bom para a maioria das vagas.'
                  : 'Mais rápido e gasta menos do limite da assinatura.'}
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Chave de API da Anthropic</h2>
        {info.engine === 'claude-code' && (
          <p className="hint">Não é usada enquanto o motor for o Claude Code.</p>
        )}
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
