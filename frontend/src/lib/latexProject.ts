/**
 * Reads a draft's project the way "Parsed draft" describes it: which \cite commands are
 * where, and what the bibliography is missing. This is a text scan, not a LaTeX parser —
 * good enough for warnings, gutter markers and autocomplete on the client. The gateway will
 * own the real parse; the shapes here (ParseResult, ParseWarning) are what it will return.
 */

import type { ParseResult, ParseWarning, ParseWarningType, ProjectFile } from '../types/draftCheck'
import { duplicateKeys, lacksLocator, parseBib, type BibEntry } from './bibtex'

/** One key inside one \cite{...}, with where it sits. Incomplete commands (no closing
 * brace yet, e.g. while typing) are not counted. */
export type CiteRef = { key: string; file: string; line: number; column: number }

const CITE = /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g

export function findCites(file: Pick<ProjectFile, 'name' | 'content'>): CiteRef[] {
  const refs: CiteRef[] = []
  const lines = file.content.split('\n')
  lines.forEach((text, index) => {
    for (const match of text.matchAll(CITE)) {
      const keys = match[1]
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
      const inner = match[0].lastIndexOf('{') + 1
      for (const key of keys) {
        refs.push({ key, file: file.name, line: index + 1, column: (match.index ?? 0) + inner + 1 })
      }
    }
  })
  return refs
}

/** Every entry of every .bib in the project, in file order. */
export function bibEntries(files: ProjectFile[]): (BibEntry & { file: string })[] {
  const bibs = files.filter((f) => f.kind === 'bib')
  // The same .bib files as last time give the same list back, so what is derived from it (the
  // preview's reference numbers, the editor's completions) is not redone while a .tex is typed.
  if (lastBibs && lastBibs.files.length === bibs.length && bibs.every((f, i) => f === lastBibs!.files[i])) return lastBibs.entries
  lastBibs = { files: bibs, entries: bibs.flatMap(entriesIn) }
  return lastBibs.entries
}

let lastBibs: { files: ProjectFile[]; entries: (BibEntry & { file: string })[] } | null = null

// One file's scan, remembered by the file object (files are never changed in place: an edit
// makes a new object, see withContent). The editor reads the whole project on every keystroke
// for its warnings and completions; with these only the file being typed in is scanned again.
// Weak, so a file nobody holds any more takes its scan with it.
const citesOf = new WeakMap<ProjectFile, CiteRef[]>()
const entriesOf = new WeakMap<ProjectFile, (BibEntry & { file: string })[]>()
const edited = new WeakMap<ProjectFile, ProjectFile>()

function citesIn(file: ProjectFile): CiteRef[] {
  let cites = citesOf.get(file)
  if (!cites) citesOf.set(file, (cites = findCites(file)))
  return cites
}

function entriesIn(file: ProjectFile): (BibEntry & { file: string })[] {
  let entries = entriesOf.get(file)
  if (!entries) entriesOf.set(file, (entries = parseBib(file.content).map((e) => ({ ...e, file: file.name }))))
  return entries
}

/** `file` with `content`: the file itself when that is already its text, and otherwise the
 * same object for as long as the text stays the same, so a file that was not typed in keeps
 * its scan from one keystroke to the next. */
export function withContent(file: ProjectFile, content: string): ProjectFile {
  if (file.content === content) return file
  const known = edited.get(file)
  if (known?.content === content) return known
  const next = { ...file, content }
  edited.set(file, next)
  return next
}

/** The bib keys a \cite can complete to. */
export function bibKeys(files: ProjectFile[]): string[] {
  return [...new Set(bibEntries(files).map((e) => e.key))]
}

export function parseProject(files: ProjectFile[]): ParseResult {
  const tex = files.filter((f) => f.kind === 'tex')
  const cites = tex.flatMap(citesIn)
  const entries = bibEntries(files)
  const known = new Set(entries.map((e) => e.key))
  const cited = new Set(cites.map((c) => c.key))
  const warnings: ParseWarning[] = []

  const missing = new Set<string>()
  for (const c of cites) {
    if (known.has(c.key) || missing.has(c.key)) continue
    missing.add(c.key)
    warnings.push({
      type: 'missing-key',
      detail: `\\cite{${c.key}} in ${c.file} L${c.line}`,
      file: c.file,
      line: c.line,
    })
  }

  for (const key of duplicateKeys(entries)) {
    const second = entries.filter((e) => e.key === key)[1]
    warnings.push({ type: 'duplicate-key', detail: `${key} defined twice`, file: second.file, line: second.line })
  }

  const unused = entries.filter((e) => !cited.has(e.key))
  const unusedKeys = [...new Set(unused.map((e) => e.key))]
  if (unusedKeys.length > 0) {
    const [first, ...rest] = unusedKeys
    const detail =
      rest.length === 0
        ? `${first} is never cited`
        : `${first} and ${rest.length} other${rest.length === 1 ? '' : 's'} are never cited`
    warnings.push({ type: 'unused-entry', detail, file: unused[0].file, line: unused[0].line })
  }

  // A key only lacks a locator when none of its entries has one (a duplicate may carry it).
  const locatable = new Set(entries.filter((e) => !lacksLocator(e)).map((e) => e.key))
  const noLocator = entries.filter((e) => cited.has(e.key) && !locatable.has(e.key))
  if (noLocator.length > 0) {
    const keys = [...new Set(noLocator.map((e) => e.key))].sort()
    warnings.push({ type: 'no-doi-url', detail: keys.join(', '), file: noLocator[0].file, line: noLocator[0].line })
  }

  return { texFiles: tex.length, citeCommands: cites.length, bibEntries: entries.length, warnings }
}

type Bib = { name: string; content: string } | null | undefined

/**
 * The keys a draft cites that only its project's .bib defines, and the project it moves to does
 * not: after the move they are missing (a missing-key warning, and "not in the bibliography" at
 * the next check). A draft reads its project's .bib unless it holds a file of that name itself
 * (the gateway's _draft_files), so the same holds here. `files` are the draft's own; a shared
 * copy of the project's .bib among them is left out.
 */
export function keysLostByMove(files: ProjectFile[], from: Bib, to: Bib): string[] {
  const own = files.filter((f) => !f.shared)
  const reads = (bib: Bib) => Boolean(bib && !own.some((f) => f.name === bib.name))
  if (!from || !reads(from)) return []
  const keysOf = (content: string) => new Set(parseBib(content).map((e) => e.key))
  const kept = keysOf(own.filter((f) => f.kind === 'bib').map((f) => f.content).join('\n'))
  if (to && reads(to)) for (const key of keysOf(to.content)) kept.add(key)
  const onlyThere = keysOf(from.content)
  const cited = new Set(own.filter((f) => f.kind === 'tex').flatMap(citesIn).map((c) => c.key))
  return [...cited].filter((key) => onlyThere.has(key) && !kept.has(key)).sort()
}

/** What each parse warning is called, on the Bibliography card and in the .bib editor. */
export const WARNING_TITLE: Record<ParseWarningType, string> = {
  'missing-key': 'Missing bib key',
  'duplicate-key': 'Duplicate key',
  'unused-entry': 'Unused entry',
  'no-doi-url': 'No DOI or URL',
}

/** A .bib warning of parseProject, placed on the entry it is about (the "@type{key," line). */
export type BibProblem = {
  type: Exclude<ParseWarningType, 'missing-key'>
  key: string
  file: string
  line: number
  message: string
}

/**
 * parseProject's .bib warnings entry by entry, for the marks in the .bib editor. The rules are
 * parseProject's own (no new ones): a key defined again, an entry no \cite names, a cited key
 * none of whose entries has a DOI or URL. parseProject folds the last two into one warning on
 * the first entry; here every entry concerned gets its own.
 */
export function bibProblems(files: ProjectFile[]): BibProblem[] {
  const cited = new Set(files.filter((f) => f.kind === 'tex').flatMap(citesIn).map((c) => c.key))
  const entries = bibEntries(files)
  const locatable = new Set(entries.filter((e) => !lacksLocator(e)).map((e) => e.key))
  const first = new Map<string, BibEntry & { file: string }>()
  const problems: BibProblem[] = []
  for (const e of entries) {
    const at = { key: e.key, file: e.file, line: e.line }
    const earlier = first.get(e.key)
    if (earlier) {
      const where = earlier.file === e.file ? `line ${earlier.line}` : `${earlier.file} line ${earlier.line}`
      problems.push({ ...at, type: 'duplicate-key', message: `${e.key} is defined twice (first on ${where})` })
    } else first.set(e.key, e)
    if (!cited.has(e.key)) problems.push({ ...at, type: 'unused-entry', message: `${e.key} is never cited` })
    else if (!locatable.has(e.key)) problems.push({ ...at, type: 'no-doi-url', message: `${e.key} has no DOI or URL to look it up by` })
  }
  return problems
}

/** The first line of the sentence that ends on `line`: walks up while the line above runs
 * on (no sentence-ending punctuation, not blank, not a command or comment line). The editor
 * shades these lines for a refuted citation and the preview underlines the same sentence. */
export function sentenceStart(content: string, line: number): number {
  const lines = content.split('\n')
  let i = Math.min(line, lines.length) - 1
  while (i > 0) {
    const above = lines[i - 1].trim()
    if (above === '' || /[.!?]$/.test(above) || above.startsWith('\\') || above.startsWith('%')) break
    i -= 1
  }
  return i + 1
}

/** Swaps one key for another inside the \cite on the given line. Other keys in the same
 * command are kept. Returns the content unchanged when the key is not on that line. */
export function replaceCiteKey(content: string, line: number, from: string, to: string): string {
  const lines = content.split('\n')
  const text = lines[line - 1]
  if (text === undefined) return content
  lines[line - 1] = text.replace(CITE, (whole, keys: string) => {
    const list = keys.split(',').map((k) => k.trim())
    if (!list.includes(from)) return whole
    const swapped = list.map((k) => (k === from ? to : k)).join(', ')
    return whole.slice(0, whole.lastIndexOf('{') + 1) + swapped + '}'
  })
  return lines.join('\n')
}
