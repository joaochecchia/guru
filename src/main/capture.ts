import { desktopCapturer, screen } from 'electron'

const MAX_EDGE = 2400

/** Captura o monitor onde o cursor está e devolve um data URL JPEG. */
export async function captureScreen(): Promise<string> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = display.size.width * display.scaleFactor
  const height = display.size.height * display.scaleFactor
  const ratio = Math.min(1, MAX_EDGE / Math.max(width, height))

  // No Wayland esta chamada abre o seletor de tela do sistema (xdg-desktop-portal).
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * ratio), height: Math.round(height * ratio) }
  })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(
      'Não foi possível capturar a tela. Se o sistema pediu permissão, autorize o compartilhamento e tente de novo; ' +
        'como alternativa, cole o texto da vaga manualmente.'
    )
  }
  return `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`
}
