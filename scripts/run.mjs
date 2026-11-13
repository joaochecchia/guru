#!/usr/bin/env node
/**
 * Abre o electron-vite (dev ou preview) com as opções de Electron certas para o desktop.
 *
 * No GNOME com Wayland o Guru roda via XWayland, para o painel ao vivo abrir no canto superior direito
 * (no Wayland nativo o GNOME ignora a posição pedida). Isso precisa vir na linha de comando: ativado
 * pelo código, o processo principal já iniciou no Wayland e só os processos filhos mudam para X11, o que
 * deixa as janelas invisíveis. A captura de tela segue pelo portal do sistema (PipeWire).
 * GURU_NATIVE_WAYLAND=1 desliga esse comportamento. As mesmas opções estão em src/main/gnome-shortcut.ts.
 */
import { spawn } from 'node:child_process'

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev'
const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase().split(':')
const gnomeWayland =
  process.platform === 'linux' &&
  process.env.XDG_SESSION_TYPE === 'wayland' &&
  desktop.includes('GNOME') &&
  process.env.GURU_NATIVE_WAYLAND !== '1'

// O Electron instalado pelo npm não configura chrome-sandbox com SUID. Em algumas
// distribuições Linux (como Ubuntu com AppArmor), isso impede o app de iniciar fora
// de um processo pai confiável. Esse script é usado só em dev/preview, não no pacote.
const electronArgs = [
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ...(gnomeWayland ? ['--ozone-platform=x11', '--enable-features=WebRTCPipeWireCapturer'] : [])
]
const args = [mode, ...(electronArgs.length ? ['--', ...electronArgs] : [])]

const child = spawn('electron-vite', args, { stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
