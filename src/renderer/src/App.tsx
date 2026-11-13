import { useEffect, useState } from 'react'
import { GeneratePage } from './GeneratePage'
import { ProfilePage } from './ProfilePage'
import { SettingsPage } from './SettingsPage'

type Page = 'generate' | 'profile' | 'settings'

const PAGES: { id: Page; label: string }[] = [
  { id: 'generate', label: 'Gerar currículo' },
  { id: 'profile', label: 'Meu perfil' },
  { id: 'settings', label: 'Configurações' }
]

export function App() {
  const [page, setPage] = useState<Page>('generate')
  const [captures, setCaptures] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  // Incrementa a cada captura feita pelo atalho; a tela de geração reage começando a gerar.
  const [autoGenerateSignal, setAutoGenerateSignal] = useState(0)

  useEffect(
    () =>
      window.guru.onCapture(({ images, autoGenerate, notes: captureNotes }) => {
        setCaptures(images)
        setNotes(captureNotes ?? '')
        setPage('generate')
        if (autoGenerate) setAutoGenerateSignal((n) => n + 1)
      }),
    []
  )

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Guru</div>
        {PAGES.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {/* As páginas ficam montadas para não perder o que está em edição ao trocar de aba. */}
        <div hidden={page !== 'generate'}>
          <GeneratePage
            captures={captures}
            notes={notes}
            autoGenerateSignal={autoGenerateSignal}
            onCapturesChange={(images) => {
              setCaptures(images)
              if (images.length === 0) setNotes('')
            }}
            onOpenSettings={() => setPage('settings')}
          />
        </div>
        <div hidden={page !== 'profile'}>
          <ProfilePage />
        </div>
        <div hidden={page !== 'settings'}>{page === 'settings' && <SettingsPage />}</div>
      </main>
    </div>
  )
}
