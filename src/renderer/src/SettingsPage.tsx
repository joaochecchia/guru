import { useEffect, useState } from 'react'
import type { AiModel, SettingsInfo } from '../../shared/types'
import { errorMessage } from './util'

export function SettingsPage() {
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [apiKeys, setApiKeys] = useState({ anthropic: '', openai: '' })
  const [shortcut, setShortcut] = useState('')
  const [liveShortcut, setLiveShortcut] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.guru.getSettings().then((settings) => {
      setInfo(settings)
      setShortcut(settings.shortcut)
      setLiveShortcut(settings.liveShortcut)
    })
  }, [])

  if (!info) return <div className="page">Carregando…</div>

  async function apply(task: () => Promise<SettingsInfo>, done: string) {
    try {
      const next = await task()
      setInfo(next)
      setShortcut(next.shortcut)
      setLiveShortcut(next.liveShortcut)
      setMessage(done)
    } catch (e) {
      setMessage(errorMessage(e))
    }
  }

  const openai = info.engine === 'openai-api' || info.engine === 'codex'
  const models = openai
    ? ([['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-6.1-terra', 'GPT-6.1 Terra'], ['gpt-6-luna', 'GPT-6 Luna'], ['gpt-6-astra', 'GPT-6 Astra'], ...(info.engine === 'codex' ? [['codex-default', 'Padrão do Codex']] : [])] as const)
    : ([['opus', 'Claude Opus'], ['sonnet', 'Claude Sonnet']] as const)

  return (
    <div className="page">
      <header className="page-header"><h1>Configurações</h1></header>
      {message && <div className="notice">{message}</div>}
      <section className="card">
        <h2>Motor de IA</h2>
        <div className="options" role="radiogroup" aria-label="Motor de IA">
          {([
            ['anthropic-api', 'API da Anthropic', 'opus'],
            ['claude-code', 'Claude Code', 'opus'],
            ['openai-api', 'API da OpenAI', 'gpt-6.1-sol'],
            ['codex', 'Codex CLI', 'codex-default']
          ] as const).map(([engine, label, model]) => (
            <label className="option" key={engine}>
              <input type="radio" name="engine" checked={info.engine === engine}
                onChange={() => apply(() => window.guru.setAi({ engine, model }), `Usando ${label}.`)} />
              <span><strong>{label}</strong></span>
            </label>
          ))}
        </div>
        {info.engine === 'claude-code' && <div className={info.claudeCode.found ? 'notice ok' : 'notice error'}>
          {info.claudeCode.found ? `Claude Code ${info.claudeCode.version} encontrado.` : 'Claude Code não encontrado.'}{' '}
          <button className="link" onClick={() => apply(() => window.guru.detectClaudeCode(), 'Busca concluída.')}>Procurar de novo</button>
        </div>}
        {info.engine === 'codex' && <div className={info.codex.found ? 'notice ok' : 'notice error'}>
          {info.codex.found ? `Codex CLI ${info.codex.version} encontrado. Faça login com codex login se necessário.` : 'Codex CLI não encontrado. Instale e entre com codex login.'}{' '}
          <button className="link" onClick={() => apply(() => window.guru.detectCodex(), 'Busca concluída.')}>Procurar de novo</button>
        </div>}
        <h3 className="subhead">Modelo</h3>
        <div className="options" role="radiogroup" aria-label="Modelo">
          {models.map(([model, label]) => <label className="option" key={model}>
            <input type="radio" name="model" checked={info.model === model}
              onChange={() => apply(() => window.guru.setAi({ model: model as AiModel }), `Modelo: ${label}.`)} />
            <span><strong>{label}</strong></span>
          </label>)}
        </div>
      </section>
      {([
        ['anthropic', 'Anthropic', info.anthropicApiKeySource, 'ANTHROPIC_API_KEY', 'https://console.anthropic.com/settings/keys'],
        ['openai', 'OpenAI', info.openAiApiKeySource, 'OPENAI_API_KEY', 'https://platform.openai.com/api-keys']
      ] as const).map(([provider, name, source, envName, url]) => <section className="card" key={provider}>
        <h2>Chave de API da {name}</h2>
        <p className="hint">{source === 'stored' ? 'Chave guardada no cofre de senhas do sistema.' : source === 'env' ? `Usando ${envName}.` : 'Nenhuma chave cadastrada.'} <a href={url} target="_blank" rel="noreferrer">Criar chave</a></p>
        <div className="inline">
          <input type="password" value={apiKeys[provider]} onChange={(e) => setApiKeys({ ...apiKeys, [provider]: e.target.value })} autoComplete="off" aria-label={`Chave da ${name}`} />
          <button className="primary" disabled={!apiKeys[provider].trim()} onClick={() => apply(async () => {
            const next = await window.guru.setApiKey(provider, apiKeys[provider]); setApiKeys({ ...apiKeys, [provider]: '' }); return next
          }, 'Chave salva.')}>Salvar chave</button>
          {source === 'stored' && <button className="ghost danger" onClick={() => apply(() => window.guru.setApiKey(provider, ''), 'Chave removida.')}>Remover</button>}
        </div>
      </section>)}

      <section className="card">
        <h2>Atalhos</h2>
        <p className="hint">
          Formato do Electron, por exemplo <code>CommandOrControl+Y</code> ou <code>Alt+Shift+C</code>.
        </p>
        <label className="field">
          <span>Um print: captura a tela e gera o currículo</span>
          <div className="inline">
            <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} aria-label="Atalho de um print" />
            <button onClick={() => apply(() => window.guru.setShortcut(shortcut), 'Atalho atualizado.')}>
              Aplicar
            </button>
          </div>
        </label>
        <label className="field">
          <span>Modo ao vivo: abre o painel que acompanha a tela com sugestões em tempo real</span>
          <div className="inline">
            <input
              value={liveShortcut}
              onChange={(e) => setLiveShortcut(e.target.value)}
              aria-label="Atalho do modo ao vivo"
            />
            <button onClick={() => apply(() => window.guru.setLiveShortcut(liveShortcut), 'Atalho atualizado.')}>
              Aplicar
            </button>
          </div>
        </label>
        <p className={info.shortcutRegistered ? 'hint' : 'notice warn'}>
          {info.shortcutRegistered
            ? info.shortcutViaSystem
              ? 'Atalhos criados nas configurações de teclado do GNOME ("Guru: capturar vaga" e "Guru: modo ao vivo"). Funcionam mesmo com a janela fechada.'
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
