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

/** Every file of the project as a .zip, with the current file contents. Figures would go
 * in here too once uploads carry them; the prototype has none. */
export function buildProjectZip(draft: Draft): Blob {
  return new Blob([zipStored(draft.files)], { type: 'application/zip' })
}

/** "related-work-thesis-ch-2" from a draft title, for file names. */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'draft'
  )
}
