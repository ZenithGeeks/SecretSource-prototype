import type { Source } from './api'
import { csvText } from './csv'

export type FeedbackSharingOptions = {
  automated: boolean
  evidence: boolean
  teacherDecision: boolean
  teacherNote: boolean
}

export const defaultFeedbackSharing: FeedbackSharingOptions = {
  automated: true,
  evidence: true,
  teacherDecision: false,
  teacherNote: false,
}

export type FeedbackSharingByCitation = Record<string, Partial<FeedbackSharingOptions>>

export type TeacherFeedbackExportClaim = {
  claim: string
  sentence?: string
  sourcePage?: number
  standing: string
  judgment: string
  teacherDecision?: string
  teacherNote?: string
  reasoning?: string
  evidence?: string
  sourceName?: string
  cropDataUrl?: string
}

export type TeacherFeedbackReport = {
  course: string
  assignment: string
  fileName?: string
  student: string
  feedback: string
  claims: TeacherFeedbackExportClaim[]
}

export function teacherFeedbackCsv(report: TeacherFeedbackReport): string {
  const headers = ['Student', 'Course', 'Assignment', 'Submission', 'Teacher feedback', 'Claim', 'Essay passage', 'Page', 'Automated result', 'Reasoning', 'Source', 'Source evidence', 'Teacher decision', 'Teacher note']
  const context = [report.student, report.course, report.assignment, report.fileName ?? '', report.feedback]
  const rows = report.claims.length
    ? report.claims.map((claim) => [
      ...context, claim.claim, claim.sentence ?? '', claim.sourcePage?.toString() ?? '',
      claim.judgment ?? '', claim.reasoning ?? '', claim.sourceName ?? '', claim.evidence ?? '',
      claim.teacherDecision ?? '', claim.teacherNote ?? '',
    ])
    : [[...context, '', '', '', '', '', '', '', '', '']]
  return csvText([headers, ...rows])
}

function markdownQuote(value: string): string {
  return value.split(/\r?\n/).map((line) => line ? `> ${line}` : '>').join('\n')
}

function markdownInline(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&')
}

/** Format the student report as portable Markdown for pasting into a document or LMS. */
export function teacherFeedbackMarkdown(report: TeacherFeedbackReport): string {
  const sections = [
    '# Essay feedback',
    [
      `- **Student:** ${markdownInline(report.student)}`,
      `- **Course:** ${markdownInline(report.course)}`,
      `- **Assignment:** ${markdownInline(report.assignment)}`,
      ...(report.fileName ? [`- **Submission:** ${markdownInline(report.fileName)}`] : []),
    ].join('\n'),
    '## Feedback from your teacher\n\n' + (report.feedback.trim() || '_No written feedback was added._'),
    '## Selected citation feedback\n\n' + (report.claims.length
      ? report.claims.map((claim, index) => [
        `### ${index + 1}${claim.judgment || claim.standing ? `. ${markdownInline(claim.judgment || claim.standing)}` : ''}`,
        `**Claim**\n${markdownQuote(claim.claim)}`,
        claim.sentence ? `**In your essay${claim.sourcePage ? ` · page ${claim.sourcePage}` : ''}**\n${markdownQuote(claim.sentence)}` : '',
        claim.sourceName ? `**Cited source:** ${markdownInline(claim.sourceName)}` : '',
        claim.judgment || claim.standing ? `**Automated result:** ${markdownInline(claim.judgment || claim.standing)}` : '',
        claim.reasoning ? `**Why this claim received this result**\n\n${claim.reasoning}` : '',
        claim.evidence ? `**What the source says**\n${markdownQuote(claim.evidence)}` : '',
        claim.teacherDecision ? `**Teacher’s final decision**\n\n${claim.teacherDecision}` : '',
        claim.teacherNote ? `**Teacher note**\n\n${claim.teacherNote}` : '',
      ].filter(Boolean).join('\n\n')).join('\n\n---\n\n')
      : '_No citations were selected for this feedback._'),
  ]
  return sections.join('\n\n')
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!))

/** A self-contained report that can be emailed or printed to PDF without including the essay. */
export function teacherFeedbackReport(report: TeacherFeedbackReport): string {
  const cards = report.claims.map((claim, index) => {
    return `
    <article class="claim">
      <h2>Claim ${index + 1} · ${escapeHtml(claim.judgment || claim.standing)}</h2>
      <p class="claim-text">${escapeHtml(claim.claim)}</p>
      ${claim.sentence ? `<blockquote>In your paper: “${escapeHtml(claim.sentence)}”${claim.sourcePage ? ` <span>(page ${claim.sourcePage})</span>` : ''}</blockquote>` : ''}
      ${claim.cropDataUrl ? `<figure><img alt="Cropped passage from the submitted paper${claim.sourcePage ? `, page ${claim.sourcePage}` : ''}" src="${claim.cropDataUrl}"><figcaption>Passage from your paper${claim.sourcePage ? ` · page ${claim.sourcePage}` : ''}</figcaption></figure>` : ''}
      ${claim.sourceName ? `<h3>Compared source</h3><p>${escapeHtml(claim.sourceName)}</p>` : ''}
      ${claim.evidence ? `<h3>What the source says</h3><blockquote>${escapeHtml(claim.evidence)}</blockquote>` : ''}
      ${claim.reasoning ? `<h3>Automated reasoning</h3><p>${escapeHtml(claim.reasoning)}</p>` : ''}
      ${claim.teacherDecision ? `<h3>Teacher’s final decision</h3><p>${escapeHtml(claim.teacherDecision)}</p>` : ''}
      ${claim.teacherNote ? `<h3>Teacher note</h3><p>${escapeHtml(claim.teacherNote)}</p>` : ''}
    </article>`
  }).join('\n')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Essay feedback · ${escapeHtml(report.student)}</title>
  <style>@page{size:A4;margin:18mm 17mm 20mm}*{box-sizing:border-box}body{font:10.5pt/1.55 system-ui,-apple-system,sans-serif;color:#20232a;max-width:190mm;margin:24px auto;padding:0 18px}h1{font-size:25pt;line-height:1.15;margin:0 0 8px;color:#20232a}.meta{font-size:9pt;color:#596273;margin:0 0 22px}.feedback,.claim{border:1px solid #d9dee8;border-radius:12px;padding:18px 20px;margin:14px 0;break-inside:avoid}.feedback{background:#f3f5fb;white-space:pre-wrap}.feedback h2{font-size:13pt;margin:0 0 8px}.feedback p{margin:0}.claim h2{margin:0 0 12px;font-size:12pt;color:#384b9a}.claim-text{font-weight:600}blockquote{border-left:3px solid #7387dc;padding-left:12px;margin:12px 0;color:#41495a}figure{margin:14px 0}img{max-width:100%;height:auto;border:1px solid #d9dee8;border-radius:8px}figcaption,.muted{font-size:8.5pt;color:#596273}h3{font-size:9pt;margin:14px 0 3px;color:#596273}.claim>p{margin:3px 0}@media print{body{max-width:none;margin:0;padding:0}.feedback,.claim{break-inside:avoid}a{color:inherit}}</style>
  <body><h1>Essay feedback</h1><p class="meta">${escapeHtml(report.student)} · ${escapeHtml(report.assignment)} · ${escapeHtml(report.course)}</p><section class="feedback"><h2>Teacher feedback</h2><p>${escapeHtml(report.feedback || 'No written feedback was added.')}</p></section><h2>Claim review</h2>${cards || '<p>No claims were found in this submission.</p>'}</body></html>`
}

/** Render just the claim's bounding boxes from the student's PDF, never the whole essay. */
export async function cropSubmissionPassage(pdf: ArrayBuffer, source?: Source | null): Promise<string | undefined> {
  return (await cropSubmissionPassages(pdf, [source]))[0]
}

/** Crop many claim boxes while loading the PDF once and rendering each referenced page once. */
export async function cropSubmissionPassages(pdf: ArrayBuffer, sources: (Source | null | undefined)[]): Promise<(string | undefined)[]> {
  if (!sources.some((source) => source?.boxes.length)) return sources.map(() => undefined)
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  if (!GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    GlobalWorkerOptions.workerSrc = worker.default
  }
  const pdfDocument = await getDocument({ data: pdf }).promise
  const scale = 1.5
  const pages = new Map<number, { canvas: HTMLCanvasElement; width: number; height: number }>()
  try {
    const crops: (string | undefined)[] = []
    for (const source of sources) {
      if (!source?.boxes.length) {
        crops.push(undefined)
        continue
      }
      let rendered = pages.get(source.page)
      if (!rendered) {
        const page = await pdfDocument.getPage(source.page)
        const viewport = page.getViewport({ scale })
        const canvas = globalThis.document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext('2d')
        if (!context) {
          crops.push(undefined)
          continue
        }
        await page.render({ canvas, canvasContext: context, viewport }).promise
        rendered = { canvas, width: viewport.width, height: viewport.height }
        pages.set(source.page, rendered)
      }
      const minX = Math.max(0, Math.min(...source.boxes.map((box) => box.x0)) * scale - 24)
      const minY = Math.max(0, Math.min(...source.boxes.map((box) => box.y0)) * scale - 16)
      const maxX = Math.min(rendered.width, Math.max(...source.boxes.map((box) => box.x1)) * scale + 24)
      const maxY = Math.min(rendered.height, Math.max(...source.boxes.map((box) => box.y1)) * scale + 16)
      const crop = globalThis.document.createElement('canvas')
      crop.width = Math.max(1, Math.ceil(maxX - minX))
      crop.height = Math.max(1, Math.ceil(maxY - minY))
      const context = crop.getContext('2d')
      if (!context) {
        crops.push(undefined)
        continue
      }
      context.drawImage(rendered.canvas, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height)
      crops.push(crop.toDataURL('image/png'))
      crop.width = crop.height = 0
    }
    return crops
  } finally {
    for (const page of pages.values()) page.canvas.width = page.canvas.height = 0
    await pdfDocument.destroy()
  }
}

export function downloadTeacherFeedbackReport(html: string, student: string) {
  const safeName = student.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'student'
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `essay-feedback-${safeName}.html`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Open a print-ready feedback report; the browser's print dialog can save it as a PDF. */
export async function printTeacherFeedbackReport(printWindow: Window, html: string) {
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()

  await Promise.all(Array.from(printWindow.document.images).map((image) => {
    if (image.complete) return Promise.resolve()
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })
  }))

  await printWindow.document.fonts?.ready
  if (printWindow.requestAnimationFrame) {
    await new Promise<void>((resolve) => {
      printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(() => resolve()))
    })
  } else {
    await new Promise<void>((resolve) => printWindow.setTimeout(resolve, 250))
  }
  void printWindow.document.body?.offsetHeight
  printWindow.focus()
  printWindow.print()
}
