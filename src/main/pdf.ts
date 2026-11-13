import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Personal, TailoredResume } from '../shared/types'

const LABELS = {
  pt: {
    summary: 'Resumo',
    experience: 'Experiência',
    projects: 'Projetos',
    education: 'Formação',
    courses: 'Cursos e certificações',
    skills: 'Habilidades',
    languages: 'Idiomas'
  },
  en: {
    summary: 'Summary',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    courses: 'Courses and certifications',
    skills: 'Skills',
    languages: 'Languages'
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function link(value: string): string {
  const label = value.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const href = /^https?:\/\//.test(value) ? value : `https://${value}`
  return `<a href="${esc(href)}">${esc(label)}</a>`
}

function section(title: string, body: string): string {
  return body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : ''
}

const CSS = `
  @page { size: A4; margin: 16mm 17mm; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body { margin: 0; font: 10.5pt/1.42 "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; color: #1c1c1c; }
  @media screen { body { padding: 16mm 17mm; } }
  h1 { font-size: 21pt; line-height: 1.15; margin: 0; letter-spacing: -0.01em; }
  .headline { font-size: 11.5pt; color: #444; margin: 2pt 0 5pt; }
  .contact { font-size: 9.5pt; color: #444; }
  .contact span + span::before { content: "  |  "; color: #aaa; }
  a { color: inherit; text-decoration: none; }
  section { margin-top: 12pt; }
  h2 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.09em; margin: 0 0 5pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #1c1c1c; }
  .item { margin-bottom: 7pt; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12pt; align-items: baseline; }
  .row strong { font-size: 10.5pt; }
  .period { color: #555; font-size: 9.5pt; white-space: nowrap; }
  .sub { color: #444; }
  ul { margin: 3pt 0 0; padding-left: 13pt; }
  li { margin-bottom: 1.5pt; }
  p { margin: 0; }
`

/** Monta o HTML do currículo. Os dados de contato entram aqui, localmente: não passam pelo modelo. */
export function renderResumeHtml(resume: TailoredResume, personal: Personal): string {
  const t = LABELS[resume.job.language] ?? LABELS.pt

  const contact = [
    personal.email && `<a href="mailto:${esc(personal.email)}">${esc(personal.email)}</a>`,
    personal.phone && esc(personal.phone),
    personal.location && esc(personal.location),
    personal.linkedin && link(personal.linkedin),
    personal.github && link(/[./]/.test(personal.github) ? personal.github : `github.com/${personal.github}`),
    personal.portfolio && link(personal.portfolio)
  ]
    .filter(Boolean)
    .map((part) => `<span>${part}</span>`)
    .join('')

  const experiences = resume.experiences
    .map(
      (e) => `<div class="item">
        <div class="row"><strong>${esc(e.role)}</strong><span class="period">${esc(e.period)}</span></div>
        <div class="sub">${esc(e.company)}</div>
        ${e.bullets.length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`
    )
    .join('')

  const projects = resume.projects
    .map(
      (p) => `<div class="item">
        <div class="row"><strong>${esc(p.name)}</strong>${p.url ? `<span class="period">${link(p.url)}</span>` : ''}</div>
        <p>${esc(p.description)}</p>
        ${p.technologies ? `<div class="sub">${esc(p.technologies)}</div>` : ''}
      </div>`
    )
    .join('')

  const education = resume.education
    .map(
      (e) => `<div class="item">
        <div class="row"><strong>${esc(e.degree)}</strong><span class="period">${esc(e.period)}</span></div>
        <div class="sub">${esc(e.institution)}</div>
      </div>`
    )
    .join('')

  const courses = resume.courses.length
    ? `<ul>${resume.courses
        .map((c) => `<li>${esc([c.name, c.provider, c.year].filter(Boolean).join(', '))}</li>`)
        .join('')}</ul>`
    : ''

  const languages = resume.languages.length
    ? `<p>${resume.languages.map((l) => esc(l.level ? `${l.language} (${l.level})` : l.language)).join(', ')}</p>`
    : ''

  return `<!doctype html>
<html lang="${resume.job.language}">
<head><meta charset="utf-8"><title>${esc(personal.name)}</title><style>${CSS}</style></head>
<body>
  <header>
    <h1>${esc(personal.name || 'Seu nome')}</h1>
    <div class="headline">${esc(resume.headline)}</div>
    <div class="contact">${contact}</div>
  </header>
  ${section(t.summary, resume.summary ? `<p>${esc(resume.summary)}</p>` : '')}
  ${section(t.experience, experiences)}
  ${section(t.projects, projects)}
  ${section(t.education, education)}
  ${section(t.courses, courses)}
  ${section(t.skills, resume.skills.length ? `<p>${resume.skills.map(esc).join(', ')}</p>` : '')}
  ${section(t.languages, languages)}
</body>
</html>`
}

/** Renderiza o HTML em uma janela oculta, com JavaScript desligado, e devolve o PDF. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const tempFile = path.join(app.getPath('temp'), `guru-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tempFile, html, { mode: 0o600 })
  const window = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
  })
  try {
    await window.loadFile(tempFile)
    return await window.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true, printBackground: true })
  } finally {
    window.destroy()
    fs.rmSync(tempFile, { force: true })
  }
}
