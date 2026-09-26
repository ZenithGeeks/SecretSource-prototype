/**
 * The live preview pipeline: get one .tex file into a shape LaTeX.js can compile, compile
 * it, then put the citations back as `[n]` markers the UI can colour and click.
 *
 * LaTeX.js (0.12) renders sections, lists, inline and display math (KaTeX), \label/\ref,
 * \maketitle and the font commands, and nothing else: no \cite, \footnote, \url, \eqref,
 * \newcommand, and no figure / table / tabular / equation / align / verbatim environments.
 * Anything it does not know throws with the line it stopped at. So this module does two
 * things before parsing:
 *
 * 1. `prepareSource` rewrites what has an equivalent LaTeX.js can take (documented in
 *    REWRITES below): equation → \[ \], align → \[\begin{aligned}\], figure/table → center,
 *    tabular → rows of text, verbatim → typewriter lines, simple \newcommand expanded, the
 *    preamble lines it cannot load dropped, and every \cite turned into a text marker
 *    (⟦c:key⟧) that survives compilation.
 * 2. `SECRETSOURCE_MACROS` adds the commands the chapter still needs as LaTeX.js custom
 *    macros (\footnote, \url, \eqref, \pageref, \caption, \includegraphics as a labelled
 *    box). LaTeX.js copies the *enumerable* members of the macro object, so they are
 *    assigned on the prototype, never written as class methods.
 *
 * After rendering, `decorateCitations` swaps the markers for `<a class="ss-cite">[n]</a>`
 * and wraps the sentence each one ends, and `appendReferences` builds the list from the
 * .bib — numbered by author, the way plainnat does.
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

/** The packages LaTeX.js has built in (its npm build ships no loadable packages, so every
 * other \usepackage — amsmath included; KaTeX covers the math anyway — logs an error and
 * does nothing). */
const BUILT_IN_PACKAGES = new Set(['hyperref', 'graphicx', 'xcolor', 'color'])

/**
 * What `prepareSource` rewrites, and why. Each entry names a LaTeX construct LaTeX.js
 * rejects and the equivalent the preview shows instead.
 */
export const REWRITES: readonly { construct: string; shownAs: string }[] = [
  { construct: '\\cite, \\citep, \\citet, \\parencite, \\textcite, \\autocite', shownAs: 'a [n] marker linked to the .bib entry; an unfinished \\cite{… becomes [?]' },
  { construct: '\\usepackage (other than hyperref, graphicx, xcolor)', shownAs: 'dropped — LaTeX.js ships no loadable packages; KaTeX covers amsmath' },
  { construct: '\\bibliography, \\bibliographystyle, \\input, \\include, \\graphicspath, \\hypersetup', shownAs: 'dropped; the References list is built from the .bib instead' },
  { construct: '\\newcommand / \\renewcommand with plain or #1…#3 bodies', shownAs: 'expanded in the source before parsing' },
  { construct: 'equation, equation*, displaymath', shownAs: 'display math \\[ … \\], \\label and \\nonumber removed' },
  { construct: 'align, align*, gather, gather*, multline, multline*, eqnarray', shownAs: 'display math with an aligned block' },
  { construct: 'figure, figure*, table, table*, subfigure, minipage', shownAs: 'a centered block; \\includegraphics becomes a labelled box' },
  { construct: 'tabular, tabularx, array', shownAs: 'one line per row, cells separated by │; rules dropped' },
  { construct: 'verbatim, lstlisting, minted', shownAs: 'typewriter lines' },
  { construct: 'theorem-like environments (theorem, lemma, proof, definition, remark, corollary)', shownAs: 'a bold heading and the text' },
  { construct: '\\footnote', shownAs: 'the note in superscript brackets' },
  { construct: '\\eqref, \\pageref', shownAs: '(label) / ?' },
  { construct: '\\url, \\href', shownAs: 'a link' },
  { construct: '\\includegraphics[width=…\\linewidth]{file}', shownAs: 'a box naming the file (images are not uploaded with a draft)' },
]

/** The LaTeX.js-safe version of a file. */
export function prepareSource(content: string): string {
  let s = content.replace(/\r\n?/g, '\n')
  s = expandNewcommands(s)
  s = s.replace(/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}.*$/gm, (line, names: string) =>
    names.split(',').some((n) => BUILT_IN_PACKAGES.has(n.trim())) ? line.replace(/\[[^\]]*\]/, '') : '',
  )
  s = s.replace(/^[ \t]*\\(?:bibliographystyle|bibliography|input|include|graphicspath|hypersetup|nocite|addbibresource|printbibliography|tableofcontents|listoffigures|listoftables|newpage|clearpage|pagestyle|thispagestyle|setlength|setcounter|linespread|onehalfspacing|doublespacing)\b.*$/gm, '')
  s = s.replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, '')
  s = s.replace(/\\(?:centering|raggedright|raggedleft|noindent|par|small|footnotesize|scriptsize|normalsize|large|Large|LARGE|huge|Huge)\b(?![A-Za-z])/g, '')
  s = rewriteMath(s)
  s = rewriteEnvironments(s)
  s = s
    .replace(CITE, (_, keys: string) =>
      keys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => `${MARKER_OPEN}${k}${MARKER_CLOSE}`)
        .join(''),
    )
    .replace(UNFINISHED_CITE, `${MARKER_OPEN}?${MARKER_CLOSE}`)
  return s
}

/** Expands `\newcommand{\name}[n]{body}` (no defaults, up to three arguments) into the
 * text, then drops the definition. What it cannot expand is left for LaTeX.js to report. */
export function expandNewcommands(source: string): string {
  const definitions: { name: string; args: number; body: string }[] = []
  const rest = source.replace(
    /^[ \t]*\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[(\d)\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}[ \t]*$/gm,
    (_, name: string, args: string | undefined, body: string) => {
      definitions.push({ name, args: Number(args ?? 0), body })
      return ''
    },
  )
  let out = rest
  for (const { name, args, body } of definitions) {
    const pattern = new RegExp(`\\\\${name}(?![A-Za-z])` + '\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}'.repeat(args), 'g')
    out = out.replace(pattern, (...m: string[]) => body.replace(/#(\d)/g, (_, i: string) => m[Number(i)] ?? ''))
  }
  return out
}

const MATH_ENVS = ['equation', 'equation*', 'displaymath', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'flalign', 'flalign*']

function rewriteMath(source: string): string {
  let s = source
  for (const env of MATH_ENVS) {
    const name = env.replace('*', '\\*')
    const aligned = !/^(equation|displaymath)/.test(env)
    s = s.replace(new RegExp(`\\\\begin\\{${name}\\}([\\s\\S]*?)\\\\end\\{${name}\\}`, 'g'), (_, body: string) => {
      const inner = body.replace(/\\label\{[^}]*\}/g, '').replace(/\\nonumber|\\notag/g, '').trim()
      return aligned ? `\\[\\begin{aligned}${inner}\\end{aligned}\\]` : `\\[${inner}\\]`
    })
  }
  return s
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\textbackslash ').replace(/([#$%&_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde ')
}

const THEOREM_ENVS = ['theorem', 'lemma', 'proof', 'definition', 'remark', 'corollary', 'proposition', 'example']

function rewriteEnvironments(source: string): string {
  let s = source
  // verbatim-like: typewriter lines, specials escaped
  s = s.replace(/\\begin\{(verbatim|lstlisting|minted)\}(?:\{[^}]*\})?(?:\[[^\]]*\])?\n?([\s\S]*?)\\end\{\1\}/g, (_, __, body: string) =>
    `\\begin{flushleft}${body
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => `\\texttt{${escapeText(line) || '~'}}`)
      .join('\\\\\n')}\\end{flushleft}`,
  )
  // tabular: one row per line, cells separated by a bar
  s = s.replace(/\\begin\{(tabular\*?|tabularx|array|longtable)\}(?:\{[^}]*\})+([\s\S]*?)\\end\{\1\}/g, (_, __, body: string) => {
    const rows = body
      .replace(/\\(?:hline|toprule|midrule|bottomrule|cmidrule(?:\([^)]*\))?\{[^}]*\}|cline\{[^}]*\})/g, '')
      .split(/\\\\/)
      .map((row) => row.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((row) => row.split(/(?<!\\)&/).map((cell) => cell.trim()).join(' │ '))
    return `\\begin{flushleft}${rows.map((r) => `\\texttt{${r}}`).join('\\\\\n')}\\end{flushleft}`
  })
  // floats: a centered block, \includegraphics inside becomes the custom box
  s = s.replace(/\\begin\{(figure\*?|table\*?|subfigure|wrapfigure|minipage|center)\}(?:\[[^\]]*\])?(?:\{[^}]*\})*/g, '\\begin{center}')
  s = s.replace(/\\end\{(figure\*?|table\*?|subfigure|wrapfigure|minipage)\}/g, '\\end{center}')
  s = s.replace(/\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)\}/g, '\\ssgraphic{$1}')
  s = s.replace(/\\captionof\{[^}]*\}/g, '\\caption')
  // theorem-like: a bold heading, then the text
  for (const env of THEOREM_ENVS) {
    s = s.replace(new RegExp(`\\\\begin\\{${env}\\}(?:\\[([^\\]]*)\\])?`, 'g'), (_, title?: string) => `\\par\\textbf{${env[0].toUpperCase()}${env.slice(1)}${title ? ` (${title})` : ''}.} `)
    s = s.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), '\\par')
  }
  s = s.replace(/\\(?:qed|qedhere)\b/g, '')
  s = s.replace(/\\begin\{abstract\}\s*\\end\{abstract\}/g, '')
  return s
}

// --- custom macros ------------------------------------------------------------------------

type Generator = {
  create(tag: string): HTMLElement
  createText(text: string): Text
}

/** LaTeX.js custom macros: `args` says how each is parsed (`H` = horizontal mode, `g` = a
 * group argument, `o?` = an optional one), and each method returns the nodes to insert.
 * Assigned on the prototype: LaTeX.js copies the enumerable members of `new Macros(g)`. */
function Macros(this: { g: Generator }, generator: Generator) {
  this.g = generator
}
Macros.args = {
  footnote: ['H', 'g'],
  url: ['H', 'g'],
  eqref: ['H', 'g'],
  pageref: ['H', 'g'],
  caption: ['H', 'o?', 'g'],
  ssgraphic: ['H', 'g'],
  textsubscript: ['H', 'g'],
  textsuperscript: ['H', 'g'],
  hfill: ['H'],
  and: ['H'],
} as Record<string, string[]>
Macros.prototype.footnote = function (this: { g: Generator }, text: Node) {
  const sup = this.g.create('sup')
  sup.className = 'ss-footnote'
  sup.append('[', text, ']')
  return [sup]
}
Macros.prototype.url = function (this: { g: Generator }, text: Node) {
  const a = this.g.create('a') as HTMLAnchorElement
  const href = text.textContent ?? ''
  a.href = href
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.textContent = href
  return [a]
}
Macros.prototype.eqref = function (this: { g: Generator }, text: Node) {
  return [this.g.createText(`(${text.textContent ?? ''})`)]
}
Macros.prototype.pageref = function (this: { g: Generator }) {
  return [this.g.createText('?')]
}
Macros.prototype.caption = function (this: { g: Generator }, _short: Node | undefined, text: Node) {
  const p = this.g.create('div')
  p.className = 'ss-caption'
  p.append(text)
  return [p]
}
Macros.prototype.ssgraphic = function (this: { g: Generator }, file: Node) {
  const box = this.g.create('div')
  box.className = 'ss-graphic'
  // LaTeX.js has already typeset the argument (fi → ﬁ, - → ‐); a file name wants the plain characters back.
  const name = (file.textContent ?? '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/‐/g, '-')
  box.textContent = `figure · ${name}`
  return [box]
}
Macros.prototype.textsubscript = function (this: { g: Generator }, text: Node) {
  const sub = this.g.create('sub')
  sub.append(text)
  return [sub]
}
Macros.prototype.textsuperscript = function (this: { g: Generator }, text: Node) {
  const sup = this.g.create('sup')
  sup.append(text)
  return [sup]
}
Macros.prototype.hfill = function (this: { g: Generator }) {
  return [this.g.createText(' ')]
}
Macros.prototype.and = function (this: { g: Generator }) {
  return [this.g.createText(' and ')]
}

export const SECRETSOURCE_MACROS = Macros

// --- references ---------------------------------------------------------------------------

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

// --- rendering ----------------------------------------------------------------------------

export type RenderResult = { root: HTMLElement }
export type RenderFailure = { message: string; line?: number }

type LatexModule = typeof import('latex.js')
let latexModule: Promise<LatexModule> | null = null

/** The library, loaded on first use (it is ~600 kB) and kept. */
function loadLatex(): Promise<LatexModule> {
  latexModule ??= import('latex.js')
  return latexModule
}

/** Compiles LaTeX.js-safe source into a detached element. Throws RenderFailure with the
 * line when the source is bad; never anything else, so the editor cannot crash on it. */
export async function renderLatex(source: string): Promise<RenderResult> {
  const { parse, HtmlGenerator } = await loadLatex()
  try {
    const generator = new HtmlGenerator({ hyphenate: false, CustomMacros: SECRETSOURCE_MACROS })
    // LaTeX.js logs every error to the console before raising it; the pane shows it instead.
    generator.setErrorFn?.((message: string) => {
      throw new Error(message)
    })
    const doc = parse(source, { generator })
    const root = document.createElement('div')
    root.appendChild(doc.domFragment())
    return { root }
  } catch (error) {
    const e = error as { message?: string; location?: { start?: { line?: number } } }
    throw { message: readableMessage(e.message ?? String(error)), line: e.location?.start?.line } satisfies RenderFailure
  }
}

/** LaTeX.js's messages in the author's words. */
function readableMessage(message: string): string {
  const first = message.split('\n')[0]
  const macro = first.match(/^unknown macro: \\?(\S+)/)
  if (macro) return `\\${macro[1]} is not supported by the preview (LaTeX.js). It still compiles with LaTeX.`
  const env = first.match(/^unknown environment: (\S+)/)
  if (env) return `The ${env[1]} environment is not supported by the preview (LaTeX.js). It still compiles with LaTeX.`
  const pkg = first.match(/^error loading package "([^"]+)"/)
  if (pkg) return `The ${pkg[1]} package is not available in the preview (LaTeX.js).`
  if (/^\\end\{document\} missing/.test(first)) return 'Missing \\end{document}.'
  if (/expected \\begin\{document\}/.test(first)) return 'Something in the preamble is not supported by the preview (LaTeX.js): only \\documentclass, \\title, \\author, \\date and the built-in packages can precede \\begin{document}.'
  return first
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
      if (info.n !== null) a.setAttribute('href', `#ref-${key}`)
      if (info.id) {
        a.dataset.id = info.id
        a.setAttribute('role', 'button')
        a.tabIndex = 0
        a.setAttribute('aria-label', `Citation ${key}: ${info.verdict ?? 'unchecked'}. Open the issue`)
      } else {
        a.title = key === '?' ? 'Unfinished \\cite' : info.n === null ? `${key} is not in the bibliography` : key
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
