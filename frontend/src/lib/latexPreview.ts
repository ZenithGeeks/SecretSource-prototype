/**
 * The live preview pipeline: get one .tex file into a shape LaTeX.js can compile, compile
 * it, then put the citations back as `[n]` markers the UI can colour and click.
 *
 * LaTeX.js knows no \cite, \bibliography or \input, and throws on anything it does not
 * know. So before parsing, `prepareSource` strips the preamble lines it cannot take and
 * turns every \cite key into a text marker (⟦c:key⟧) that survives compilation. After
 * rendering, `decorateCitations` swaps the markers for `<a class="ss-cite">[n]</a>` and
 * wraps the sentence each one ends, and `appendReferences` builds the list from the .bib —
 * numbered by author, the way plainnat does.
 */

import type { BibEntry } from './bibtex'
import type { Verdict } from '../types/draftCheck'

export const MARKER_OPEN = '⟦c:'
export const MARKER_CLOSE = '⟧'
const MARKER = /⟦c:([^⟧]*)⟧/g

/** How each \cite occurrence in the file maps back to a citation record. */
export type MarkerInfo = {
  id?: string
  verdict?: Verdict
  /** The reference number, or null when the key is not in the bibliography. */
  n: number | null
}

const CITE = /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}\n]*)\}/g
const UNFINISHED_CITE = /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{[^}\n]*$/gm
const DROP_LINE =
  /^[ \t]*\\(?:usepackage|bibliographystyle|bibliography|input|include|maketitle|hypersetup|graphicspath)\b.*$/gm

/** The LaTeX.js-safe version of a file. `\cite{a, b}` → `⟦c:a⟧⟦c:b⟧`; an unfinished
 * `\cite{san` at the end of a line → `⟦c:?⟧`, which renders as [?]. */
export function prepareSource(content: string): string {
  return content
    .replace(DROP_LINE, '')
    .replace(CITE, (_, keys: string) =>
      keys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => `${MARKER_OPEN}${k}${MARKER_CLOSE}`)
        .join(''),
    )
    .replace(UNFINISHED_CITE, `${MARKER_OPEN}?${MARKER_CLOSE}`)
}

/** Surname of the first author, for sorting: "Khattab, Omar and …" → "khattab". */
function firstSurname(entry: BibEntry): string {
  const first = (entry.fields.author ?? '').split(/\s+and\s+/i)[0]?.trim() ?? ''
  const surname = first.includes(',') ? first.split(',')[0] : (first.split(/\s+/).pop() ?? '')
  return surname.replace(/[{}\\'"`^~]/g, '').toLowerCase()
}

/** Reference numbers for the cited bibliography keys (every key when `cited` is omitted),
 * sorted by first author then year, one number per key even when an entry is defined
 * twice — what plainnat does for a document. */
export function referenceNumbers(entries: BibEntry[], cited?: Set<string>): Map<string, number> {
  const unique = new Map<string, BibEntry>()
  for (const e of entries) if (!unique.has(e.key) && (!cited || cited.has(e.key))) unique.set(e.key, e)
  const sorted = [...unique.values()].sort(
    (a, b) => firstSurname(a).localeCompare(firstSurname(b)) || (a.fields.year ?? '').localeCompare(b.fields.year ?? '') || a.key.localeCompare(b.key),
  )
  return new Map(sorted.map((e, i) => [e.key, i + 1]))
}

/** "O. Khattab and M. Zaharia" from a BibTeX author field; four or more become "et al.". */
export function formatAuthors(author: string): string {
  const names = author
    .split(/\s+and\s+/i)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => {
      const [last, first] = n.includes(',') ? n.split(',').map((s) => s.trim()) : [n.split(/\s+/).pop() ?? n, n.split(/\s+/).slice(0, -1).join(' ')]
      const initials = (first ?? '')
        .split(/[\s.-]+/)
        .filter(Boolean)
        .map((p) => `${p[0].toUpperCase()}.`)
        .join(' ')
      return initials ? `${initials} ${last}` : last
    })
    .map((n) => n.replace(/[{}]/g, ''))
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names[0]} et al.`
}

/** "O. Khattab and M. Zaharia. ColBERT: …. SIGIR, 2020." */
export function formatReference(entry: BibEntry): string {
  const f = entry.fields
  const venue = f.booktitle ?? f.journal ?? f.publisher ?? ''
  const tail = [venue, f.year].filter(Boolean).join(', ')
  return [formatAuthors(f.author ?? ''), (f.title ?? entry.key).replace(/[{}]/g, ''), tail]
    .filter(Boolean)
    .map((part) => part.replace(/\.$/, ''))
    .join('. ')
    .concat('.')
}

export type RenderResult = { root: HTMLElement }
export type RenderFailure = { message: string; line?: number }

/** Compiles LaTeX.js-safe source into a detached element. The library is loaded on first
 * use (it is large) and kept. Throws RenderFailure with the line when the source is bad. */
export async function renderLatex(source: string): Promise<RenderResult> {
  const { parse, HtmlGenerator } = await import('latex.js')
  try {
    const generator = new HtmlGenerator({ hyphenate: false })
    const doc = parse(source, { generator })
    const root = document.createElement('div')
    root.appendChild(doc.domFragment())
    return { root }
  } catch (error) {
    const e = error as { message?: string; location?: { start?: { line?: number } } }
    throw { message: e.message ?? String(error), line: e.location?.start?.line } satisfies RenderFailure
  }
}

const SENTENCE_END = /[.!?]["”’)]?\s+(?=\S)/g

/**
 * Turns every ⟦c:key⟧ marker in `root` into an `<a class="ss-cite">[n]</a>` and wraps the
 * sentence it ends in `<span class="ss-sentence">`. `resolve` gets the key and how many
 * times it has been seen so far in this file, so two \cite of the same key map to their own
 * citation records.
 */
export function decorateCitations(root: HTMLElement, resolve: (key: string, occurrence: number) => MarkerInfo): void {
  const seen = new Map<string, number>()
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (MARKER.test(node.textContent ?? '')) textNodes.push(node as Text)
    MARKER.lastIndex = 0
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ''
    const parts = text.split(MARKER)
    // split with a capturing group alternates: text, key, text, key, …
    const fragment = root.ownerDocument.createDocumentFragment()
    const markers: HTMLElement[] = []
    parts.forEach((part, index) => {
      if (index % 2 === 0) {
        if (part) fragment.appendChild(root.ownerDocument.createTextNode(part))
        return
      }
      const key = part
      const occurrence = seen.get(key) ?? 0
      seen.set(key, occurrence + 1)
      const info = key === '?' ? { n: null } : resolve(key, occurrence)
      const a = root.ownerDocument.createElement('a')
      a.className = 'ss-cite'
      a.textContent = `[${info.n ?? '?'}]`
      a.dataset.key = key
      if (info.id) {
        a.dataset.id = info.id
        a.setAttribute('role', 'button')
        a.tabIndex = 0
        a.setAttribute('aria-label', `Citation ${key}: ${info.verdict ?? 'unchecked'}. Open the issue`)
      } else {
        a.title = key === '?' ? 'Unfinished \\cite' : `${key} is not in the bibliography`
      }
      if (info.verdict) a.dataset.verdict = info.verdict
      fragment.appendChild(a)
      markers.push(a)
    })
    textNode.replaceWith(fragment)
    for (const marker of markers) wrapSentence(marker)
  }
}

/** Wraps the text from the previous sentence end up to (and including) `marker`. */
function wrapSentence(marker: HTMLElement): void {
  const doc = marker.ownerDocument
  const paragraph = marker.closest('p, li, div') ?? marker.parentElement
  if (!paragraph) return
  const range = doc.createRange()
  range.setStartBefore(paragraph.firstChild ?? marker)
  range.setEndAfter(marker)

  // Find the last sentence boundary before the marker, walking back through text nodes.
  const walker = doc.createTreeWalker(paragraph, 4 /* SHOW_TEXT */)
  const before: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === marker || marker.contains(node)) break
    if (node.compareDocumentPosition(marker) & 4 /* FOLLOWING */) before.push(node as Text)
  }
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const node = before[i]
    const content = node.textContent ?? ''
    let last = -1
    for (const match of content.matchAll(SENTENCE_END)) last = (match.index ?? 0) + match[0].length
    if (last >= 0) {
      range.setStart(node, last)
      break
    }
    if (node.parentElement?.classList.contains('ss-cite')) {
      range.setStartAfter(node.parentElement)
      break
    }
  }

  const span = doc.createElement('span')
  span.className = 'ss-sentence'
  if (marker.dataset.verdict) span.dataset.verdict = marker.dataset.verdict
  if (marker.dataset.id) span.dataset.id = marker.dataset.id
  const contents = range.extractContents()
  span.appendChild(contents)
  range.insertNode(span)
}

/** The References section for the keys that were cited, in reference-number order. */
export function appendReferences(root: HTMLElement, entries: BibEntry[], numbers: Map<string, number>, citedKeys: Set<string>): void {
  const cited = [...numbers.entries()].filter(([key]) => citedKeys.has(key)).sort((a, b) => a[1] - b[1])
  if (cited.length === 0) return
  const doc = root.ownerDocument
  const heading = doc.createElement('h2')
  heading.className = 'ss-refs-title'
  heading.textContent = 'References'
  const list = doc.createElement('ol')
  list.className = 'ss-refs'
  for (const [key, n] of cited) {
    const entry = entries.find((e) => e.key === key)
    if (!entry) continue
    const item = doc.createElement('li')
    item.dataset.key = key
    item.id = `ref-${key}`
    const label = doc.createElement('span')
    label.className = 'ss-ref-n'
    label.textContent = `[${n}]`
    item.append(label, ` ${formatReference(entry)}`)
    list.appendChild(item)
  }
  root.append(heading, list)
}
