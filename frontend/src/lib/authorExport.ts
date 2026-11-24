/**
 * What the editor's Export menu hands out, built on the client from the author store:
 * the updated .bib (duplicates merged, entries added by "Replace with …" included), the
 * annotated .tex (a `% SecretSource:` line above every flagged \cite) and the project .zip.
 * The verification report (PDF) is not here: it needs the gateway and stays behind
 * authorApi.exportReport until that endpoint exists.
 */

import { parseBib, serializeBib, type BibEntry } from './bibtex'
import { shortMessage } from './citations'
import { findCites } from './latexProject'
import { findImage } from './latexPreview'
import { referenceNote } from './referenceCheck'
import { VERDICTS, isOpenIssue } from './verdict'
import { zipStored } from './zip'
import type { Citation, Draft, ProjectFile } from '../types/draftCheck'

/** Two entries with the same key become one that has every field of both; the first
 * definition wins where they disagree, except that a missing DOI/URL is filled in. */
export function mergeEntries(entries: BibEntry[]): BibEntry[] {
  const byKey = new Map<string, BibEntry>()
  for (const entry of entries) {
    const existing = byKey.get(entry.key)
    if (!existing) {
      byKey.set(entry.key, { ...entry, fields: { ...entry.fields } })
      continue
    }
    for (const [name, value] of Object.entries(entry.fields)) {
      if (!existing.fields[name]) existing.fields[name] = value
    }
  }
  return [...byKey.values()]
}

/** The merged bibliography of every .bib in the draft, as text. */
export function buildUpdatedBib(draft: Draft, now = new Date()): string {
  const entries = mergeEntries(draft.files.filter((f) => f.kind === 'bib').flatMap((f) => parseBib(f.content)))
  const header = `% ${draft.title} — bibliography updated by SecretSource on ${now.toISOString().slice(0, 10)}\n% ${entries.length} entries, duplicate keys merged\n`
  return `${header}\n${entries.map(serializeBib).join('\n\n')}\n`
}

/** The comment written above a flagged \cite. */
export function annotationFor(citation: Citation): string {
  const verdict = VERDICTS[citation.verdict].badge
  const detail =
    citation.explanation ??
    (citation.verdict === 'unavailable'
      ? `The source could not be read: ${shortMessage(citation.message) || 'no PDF'}.`
      : citation.reason === 'missing-key'
        ? 'No entry in the bibliography.'
        : citation.message
          ? `${citation.message}.`
          : 'Not checked yet.')
  const where = citation.evidence?.page ? ` (${citation.evidence.pdf} p.${citation.evidence.page})` : ''
  const note = referenceNote(citation)
  const text = note ? `${detail} ${note}` : detail
  return `% SecretSource: ${verdict}${where} — \\cite{${citation.key}}: ${text.replace(/\s+/g, ' ')}`
}

/** `file` with a `% SecretSource:` line above every line that holds an open issue. Lines
 * without one are untouched, so the file still compiles exactly as before. */
export function buildAnnotatedTex(file: ProjectFile, citations: Citation[]): string {
  const lines = file.content.split('\n')
  const byLine = new Map<number, Citation[]>()
  for (const c of citations) {
    if (c.file !== file.name || !isOpenIssue(c)) continue
    byLine.set(c.line, [...(byLine.get(c.line) ?? []), c])
  }
  const flagged = [...byLine.keys()].sort((a, b) => b - a)
  for (const line of flagged) {
    if (line < 1 || line > lines.length) continue
    const indent = lines[line - 1].match(/^\s*/)?.[0] ?? ''
    lines.splice(line - 1, 0, ...byLine.get(line)!.map((c) => `${indent}${annotationFor(c)}`))
  }
  const open = [...byLine.values()].flat().length
  if (open > 0) {
    const cites = findCites(file).length
    lines.unshift(`% SecretSource: ${open} open issue${open === 1 ? '' : 's'} in ${cites} \\cite of this file`)
  }
  return lines.join('\n')
}

/** The paths a .tex file's \includegraphics (and the other image commands) name, comments
 * left out. */
function imagePaths(tex: string): string[] {
  const source = tex.replace(/(^|[^\\])%.*$/gm, '$1')
  const command = /\\(?:includegraphics|includesvg|includepdf|adjincludegraphics)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g
  return [...source.matchAll(command)].map((m) => m[1].trim()).filter(Boolean)
}

/** Every file of the project as a .zip, with the current file contents, and the draft's
 * figures. Each figure is at its own path, and also at every path an \includegraphics names
 * it by when that differs: the preview finds figures/posv as posv.png by its file name, but
 * pdflatex looks only at figures/posv.png, so an export that kept only posv.png would not
 * compile. A path without an extension gets the figure's. */
export function buildProjectZip(draft: Draft, figures: { name: string; content: Uint8Array }[] = []): Blob {
  const byName = new Map(figures.map((f) => [f.name, f.name]))
  const extra = new Map<string, Uint8Array>()
  for (const file of draft.files) {
    if (file.kind !== 'tex') continue
    for (const path of imagePaths(file.content)) {
      const stored = findImage(byName, path)
      const figure = stored && figures.find((f) => f.name === stored)
      if (!figure) continue
      const wanted = path.replace(/^\.\//, '')
      // Outside the project ("../x", "/abs", "C:"): not an entry an unzip should write.
      if (wanted.startsWith('/') || wanted.includes(':') || wanted.includes('\\') || wanted.split('/').includes('..')) continue
      const name = /\.[A-Za-z0-9]+$/.test(wanted.split('/').pop() ?? '') ? wanted : `${wanted}${stored.slice(stored.lastIndexOf('.'))}`
      if (name !== figure.name) extra.set(name, figure.content)
    }
  }
  // Each extra path is another whole copy of its figure, so a source naming one figure many
  // ways could build an archive too large for the browser to hold.
  let copied = 0
  for (const content of extra.values()) copied += content.length
  if (copied > MAX_FIGURE_COPY_BYTES) {
    throw new Error(`The figures' extra copies at their \\includegraphics paths come to more than ${MAX_FIGURE_COPY_BYTES / (1024 * 1024)} MB; name each figure by one path.`)
  }
  return new Blob([zipStored([...draft.files, ...figures, ...[...extra].map(([name, content]) => ({ name, content }))])], { type: 'application/zip' })
}

/** The most bytes the copies of figures at their \includegraphics paths may add to a project
 * .zip: the gateway's cap on one draft's figures (backend/app/author/images.py). */
export const MAX_FIGURE_COPY_BYTES = 25 * 1024 * 1024

/** "related-work-thesis-ch-2" from a draft title, for file names. */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'draft'
  )
}
