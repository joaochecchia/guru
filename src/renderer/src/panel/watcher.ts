import type { PanelGeometry } from '../../../shared/types'

/**
 * Observa a tela por uma transmissão contínua (getDisplayMedia) e entrega um print só quando a tela
 * muda e depois para: a pessoa rolou a página e parou para ler. A comparação é local, numa versão
 * reduzida em tons de cinza, então ficar observando não custa nada; só os prints guardados vão ao Claude.
 *
 * O próprio painel é coberto nos prints. Sem isso, o texto sendo escrito nele contaria como mudança
 * na tela e geraria novos prints sem parar.
 */

const TICK_MS = 1000
const SMALL_W = 96
const SMALL_H = 60
/**
 * Limiares medidos (diferença média de 0 a 255 na versão reduzida): tela parada com cursor piscando e
 * relógio mudando dá ~0,03; rolar uma vaga esparsa de fundo branco dá ~4,3; uma página cheia passa de 25.
 */
/** Acima disso, a tela está "em movimento" entre um tick e o seguinte. */
const MOVING = 1.0
/** Diferença mínima em relação ao último print guardado para guardar um novo. */
const NEW_CONTENT = 1.5
/** Ticks parados depois de um print novo para avisar que a leitura assentou. */
const SETTLE_TICKS = 2
const MAX_EDGE = 1600
const PANEL_PADDING = 8

export interface WatcherCallbacks {
  /** Novo trecho da página, como data URL JPEG, com o painel coberto. */
  onFrame(dataUrl: string): void
  /** A tela ficou parada depois de prints novos: bom momento para analisar. */
  onSettled(): void
  /** A transmissão terminou por fora (a pessoa parou o compartilhamento pelo sistema). */
  onEnded(): void
}

export class ScreenWatcher {
  private stream: MediaStream | null = null
  private video = document.createElement('video')
  private small = document.createElement('canvas')
  private full = document.createElement('canvas')
  private timer: number | null = null
  private previous: Uint8ClampedArray | null = null
  private lastKept: Uint8ClampedArray | null = null
  private stillTicks = 0
  private pendingSettle = false
  private geometry: PanelGeometry | null = null
  private geometryAt = 0
  paused = false

  constructor(private callbacks: WatcherCallbacks) {
    this.small.width = SMALL_W
    this.small.height = SMALL_H
    this.video.muted = true
  }

  get running(): boolean {
    return this.stream !== null
  }

  async start(): Promise<void> {
    if (this.stream) return
    // No Linux o sistema pergunta qual tela compartilhar; a transmissão segue até stop().
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false })
    this.stream = stream
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stop()
      this.callbacks.onEnded()
    })
    this.video.srcObject = stream
    await this.video.play()
    this.previous = null
    this.lastKept = null
    this.timer = window.setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
  }

  /** Esquece o último print: a próxima tela parada vira um print novo (usado em "Nova vaga"). */
  reset(): void {
    this.lastKept = null
    this.previous = null
  }

  private async panelMask(width: number, height: number): Promise<{ x: number; y: number; w: number; h: number } | null> {
    // A posição do painel muda pouco; atualiza a cada 3 s.
    if (!this.geometry || Date.now() - this.geometryAt > 3000) {
      try {
        this.geometry = await window.guru.panelGeometry()
        this.geometryAt = Date.now()
      } catch {
        return null
      }
    }
    const { panel, display } = this.geometry
    const sx = width / display.width
    const sy = height / display.height
    return {
      x: (panel.x - display.x - PANEL_PADDING) * sx,
      y: (panel.y - display.y - PANEL_PADDING) * sy,
      w: (panel.width + PANEL_PADDING * 2) * sx,
      h: (panel.height + PANEL_PADDING * 2) * sy
    }
  }

  private async tick(): Promise<void> {
    if (this.paused || !this.stream) return
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (!vw || !vh) return
    const mask = await this.panelMask(vw, vh)

    const ctx = this.small.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(this.video, 0, 0, SMALL_W, SMALL_H)
    if (mask) {
      ctx.fillStyle = '#000'
      ctx.fillRect((mask.x / vw) * SMALL_W, (mask.y / vh) * SMALL_H, (mask.w / vw) * SMALL_W, (mask.h / vh) * SMALL_H)
    }
    const rgba = ctx.getImageData(0, 0, SMALL_W, SMALL_H).data
    const gray = new Uint8ClampedArray(SMALL_W * SMALL_H)
    for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10

    const moving = this.previous !== null && difference(gray, this.previous) > MOVING
    this.previous = gray
    if (moving) {
      this.stillTicks = 0
      return
    }
    this.stillTicks++

    // Tela parada: se o conteúdo é novo em relação ao último print, guarda um print em resolução boa.
    if (this.stillTicks === 1 && (this.lastKept === null || difference(gray, this.lastKept) > NEW_CONTENT)) {
      this.lastKept = gray
      this.callbacks.onFrame(this.capture(vw, vh, mask))
      this.pendingSettle = true
    }
    if (this.pendingSettle && this.stillTicks >= SETTLE_TICKS) {
      this.pendingSettle = false
      this.callbacks.onSettled()
    }
  }

  private capture(vw: number, vh: number, mask: { x: number; y: number; w: number; h: number } | null): string {
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh))
    this.full.width = Math.round(vw * scale)
    this.full.height = Math.round(vh * scale)
    const ctx = this.full.getContext('2d')!
    ctx.drawImage(this.video, 0, 0, this.full.width, this.full.height)
    if (mask) {
      ctx.fillStyle = '#000'
      ctx.fillRect(mask.x * scale, mask.y * scale, mask.w * scale, mask.h * scale)
    }
    return this.full.toDataURL('image/jpeg', 0.82)
  }
}

function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}
