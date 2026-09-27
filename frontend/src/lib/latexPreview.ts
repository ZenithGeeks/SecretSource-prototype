/**
 * The live preview pipeline: get one .tex file into a shape LaTeX.js can compile, compile
 * it, then put the citations back as `[n]` markers the UI can colour and click.
 *
 * LaTeX.js (0.12.6) renders sections, lists, inline and display math (KaTeX), \label/\ref,
 * \maketitle, the font commands, and the packages bundled with it (BUILT_IN_PACKAGES:
 * multicol, textgreek, gensymb, textcomp, stix, hyperref, graphicx, xcolor, …); nothing
 * else: no \cite, \footnote, \eqref, \newcommand, and no figure / table / tabular / equation
 * / align / verbatim environments. Anything it does not know throws with the line it stopped
 * at, and its parser installs its own error function, so a lenient one cannot be set. So
 * this module does three things:
 *
 * 1. `preparePreview` rewrites what has an equivalent LaTeX.js can take (documented in
 *    REWRITES below): equation → \[ \], align → \[\begin{aligned}\], figure/table → center,
 *    tabular → rows of text, verbatim → typewriter lines, simple \newcommand expanded, and
 *    every \cite turned into a text marker (⟦c:key⟧) that survives compilation. The preamble
 *    is filtered by an allowlist: \documentclass, \title, \author, \date, the counters and
 *    lengths LaTeX.js has, and the bundled packages reach it; everything else there is
 *    dropped and named in `ignored`, so the pane can say what the preview left out. Every
 *    rewrite keeps the line count (dropped text becomes `%` comment lines), so the line
 *    LaTeX.js reports is the line in the author's file.
 * 2. `renderLatex` parses, and when LaTeX.js stops at a macro, environment, counter or
 *    length it does not know, replaces every use of it with a grey placeholder (or nothing,
 *    for a counter) and parses again, collecting what it replaced with the lines. What it
 *    learnt is kept between renders and applied before parsing, so an edit to a file with
 *    known unknowns costs one parse; an entry that no longer matches anything is dropped.
 *    Only a real syntax error — an unclosed group, a missing \end{document} — is reported.
 * 3. `SECRETSOURCE_MACROS` adds the commands the chapter still needs as LaTeX.js custom
 *    macros (\footnote, \url, \eqref, \pageref, \caption, \includegraphics as a labelled
 *    box, the placeholder). LaTeX.js copies the *enumerable* members of the macro object,
 *    so they are assigned on the prototype, never written as class methods.
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

/** The packages bundled in LaTeX.js 0.12.6 (the keys of its package registry in
 * dist/latex.js; its build has no loadable package files, so any other \usepackage fails
 * with a console error and does nothing). Not among them: amsmath, geometry, booktabs,
 * calc, pict2e, picture, comment. */
export const BUILT_IN_PACKAGES = new Set(['color', 'xcolor', 'echo', 'gensymb', 'graphics', 'graphicx', 'hyperref', 'latexsym', 'multicol', 'stix', 'textcomp', 'textgreek'])

/** Packages LaTeX.js lacks but whose job KaTeX does in the preview, so dropping them changes
 * nothing worth a notice. */
const KATEX_COVERS = new Set(['amsmath', 'amssymb', 'amsfonts', 'amsthm', 'mathtools'])

/** Packages LaTeX.js lacks that preparePreview stands in for itself (comment: its
 * environments are blanked out, as LaTeX hides them), so they get no notice either. */
const EMULATED = new Set(['comment'])

/** Whether the file loads `name` (in any \usepackage, with or without options). */
function usesPackage(source: string, name: string): boolean {
  return new RegExp(`^[ \\t]*\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm').test(source)
}

/**
 * What `preparePreview` rewrites, and why. Each entry names a LaTeX construct LaTeX.js
 * rejects and the equivalent the preview shows instead.
 */
export const REWRITES: readonly { construct: string; shownAs: string }[] = [
  { construct: '\\cite, \\citep, \\citet, \\parencite, \\textcite, \\autocite', shownAs: 'a [n] marker linked to the .bib entry; an unfinished \\cite{… becomes [?]' },
  { construct: '\\usepackage of a package LaTeX.js does not bundle (geometry, booktabs, tikz, …)', shownAs: 'dropped and named in the "ignored" notice; the bundled ones (multicol, textgreek, gensymb, textcomp, stix, hyperref, graphicx, xcolor, …) load; amsmath is dropped silently, KaTeX covers it' },
  { construct: 'anything else in the preamble (\\newtheorem, \\geometry, \\DeclareMathOperator, \\hypersetup, …)', shownAs: 'dropped and named in the notice; \\documentclass, \\title, \\author, \\date, \\setcounter, \\setlength and \\pagestyle stay' },
  { construct: 'a macro or environment LaTeX.js does not know, in the body', shownAs: 'a grey box with its name where it was; the rest of the page still renders, and the notice lists it with its lines' },
  { construct: '\\setcounter / \\setlength of a counter or length LaTeX.js does not have', shownAs: 'dropped and listed in the notice' },
  { construct: 'comment environments, with \\usepackage{comment}', shownAs: 'nothing, as LaTeX shows nothing (the package is not bundled, so the preview blanks them itself)' },
  { construct: '\\bibliography, \\bibliographystyle, \\input, \\include, \\graphicspath', shownAs: 'dropped; the References list is built from the .bib instead' },
  { construct: '\\newcommand / \\renewcommand with plain or #1…#3 bodies', shownAs: 'expanded in the source before parsing' },
  { construct: 'equation, equation*, displaymath', shownAs: 'display math \\[ … \\], \\label and \\nonumber removed' },
  { construct: 'align, align*, gather, gather*, multline, multline*, eqnarray', shownAs: 'display math with an aligned block' },
  { construct: 'figure, figure*, table, table*, subfigure, minipage', shownAs: 'a centered block; \\includegraphics becomes a labelled box' },
  { construct: 'tabular, tabularx, array', shownAs: 'one line per row, cells separated by │; rules dropped' },
  { construct: 'verbatim, lstlisting, minted', shownAs: 'typewriter lines' },
  { construct: 'theorem-like environments (theorem, lemma, proof, definition, remark, corollary)', shownAs: 'a bold heading and the text' },
  { construct: '\\footnote, \\thanks', shownAs: 'the note in superscript brackets' },
  { construct: '\\eqref, \\pageref', shownAs: '(label) / ?' },
  { construct: '\\url, \\href', shownAs: 'a link' },
  { construct: '\\includegraphics[width=…\\linewidth]{file}', shownAs: 'a box naming the file (images are not uploaded with a draft)' },
]

/** The LaTeX.js-safe version of a file, and what the preview left out of it. `source` has
 * exactly as many lines as `content`, so a line LaTeX.js reports is a line in the file. */
export type PreparedSource = {
  source: string
  /** What was dropped, in the author's words, in source order, each once: "geometry",
   * "\\newtheorem", "multicols (shown as one column)". Empty when nothing was. */
  ignored: string[]
}

function lineCount(text: string): number {
  let n = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n += 1
  return n
}

/** `replacement` for `original`, padded with `%` comment lines so both span the same number
 * of lines. A comment line is nothing to LaTeX.js — no paragraph break — so the padding
 * changes no layout, only keeps the line numbers honest. Callers never add lines. */
function sameLines(original: string, replacement: string): string {
  const missing = lineCount(original) - lineCount(replacement)
  return missing > 0 ? replacement + '%\n'.repeat(missing) : replacement
}

export function preparePreview(content: string): PreparedSource {
  const ignored: string[] = []
  const note = (what: string) => {
    if (!ignored.includes(what)) ignored.push(what)
  }
  let s = content.replace(/\r\n?/g, '\n')
  s = expandNewcommands(s)
  // The comment package is not bundled with LaTeX.js: with it loaded, its environments are
  // blanked out here, the way LaTeX hides them, before anything could see them as unknown.
  if (usesPackage(s, 'comment')) s = s.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, (whole) => sameLines(whole, ''))
  s = filterPreamble(s, note)
  // Bibliography and file commands (the References list is built from the .bib instead) and
  // spacing that has no meaning on one screen page; what LaTeX.js knows (\setcounter,
  // \setlength, \pagestyle, \newpage, \tableofcontents) is left to it.
  s = s.replace(/^[ \t]*\\(?:bibliographystyle|bibliography|input|include|graphicspath|hypersetup|nocite|addbibresource|printbibliography|listoffigures|listoftables|linespread|onehalfspacing|doublespacing)\b.*$/gm, '')
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
  return { source: s, ignored }
}

/** The LaTeX.js-safe version of a file (see preparePreview). */
export function prepareSource(content: string): string {
  return preparePreview(content).source
}

// --- the preamble ---------------------------------------------------------------------

/** What may precede \begin{document}: LaTeX.js accepts these there (a \setcounter or
 * \setlength of something it lacks is caught by renderLatex) and nothing else. */
const PREAMBLE_ALLOWED = new Set(['documentclass', 'title', 'author', 'date', 'setcounter', 'setlength', 'pagestyle', 'makeatletter', 'makeatother'])

/** The end of the balanced group opening at `open` (`{` … `}` or `[` … `]`), or -1 when it
 * never closes. A backslash escapes the next character; `%` starts a comment to the end of
 * the line. Braces nest; a bracket group ends at the first `]` outside any brace. */
function groupEnd(text: string, open: number): number {
  const square = text[open] === '['
  let depth = 0
  for (let i = open + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') {
      i += 1
    } else if (ch === '%') {
      const eol = text.indexOf('\n', i)
      if (eol === -1) return -1
      i = eol
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      if (depth === 0) return square ? -1 : i
      depth -= 1
    } else if (ch === ']' && square && depth === 0) {
      return i
    }
  }
  return -1
}

/** The end of the arguments following a command at `from`: any run of `[…]` and `{…}`
 * groups, with spaces or newlines between them. */
function argumentsEnd(text: string, from: number): number {
  let i = from
  for (;;) {
    let j = i
    while (j < text.length && /\s/.test(text[j])) j += 1
    if (text[j] !== '{' && text[j] !== '[') return i
    const end = groupEnd(text, j)
    if (end === -1) return i
    i = end + 1
  }
}

/** `\usepackage[opts]{a,b}` as LaTeX.js can take it: the built-in packages without options,
 * or nothing. The others are reported. */
function rewriteUsepackage(statement: string, note: (what: string) => void): string {
  const names = [...statement.matchAll(/\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .filter(Boolean)
  const kept = names.filter((n) => BUILT_IN_PACKAGES.has(n))
  for (const n of names) if (!BUILT_IN_PACKAGES.has(n) && !KATEX_COVERS.has(n) && !EMULATED.has(n)) note(n)
  return kept.length ? `\\usepackage{${kept.join(',')}}` : ''
}

/**
 * Keeps only what LaTeX.js accepts before \begin{document}. Every other statement — a
 * command with its arguments, however many lines they span, or a stray group — becomes
 * comment lines, and its name goes to `note`. A file with no \begin{document} (a fragment)
 * is left as it is, apart from its \usepackage lines.
 */
function filterPreamble(source: string, note: (what: string) => void): string {
  const at = source.search(/^[ \t]*\\begin\{document\}/m)
  if (at === -1) {
    return source.replace(/^[ \t]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\}[ \t]*$/gm, (line) => rewriteUsepackage(line, note))
  }
  const preamble = source.slice(0, at)
  let out = ''
  let i = 0
  while (i < preamble.length) {
    const ch = preamble[i]
    if (ch === '%') {
      const eol = preamble.indexOf('\n', i)
      const end = eol === -1 ? preamble.length : eol
      out += preamble.slice(i, end)
      i = end
    } else if (ch === '\\') {
      const name = preamble.slice(i + 1).match(/^(?:[A-Za-z@]+\*?|.)/)?.[0] ?? ''
      const end = argumentsEnd(preamble, i + 1 + name.length)
      const statement = preamble.slice(i, end)
      const bare = name.replace(/\*$/, '')
      if (PREAMBLE_ALLOWED.has(bare)) out += statement
      else if (bare === 'usepackage') out += sameLines(statement, rewriteUsepackage(statement, note))
      else {
        if (/^[A-Za-z@]/.test(bare)) note(`\\${bare}`)
        out += sameLines(statement, '')
      }
      i = end
    } else if (ch === '{' || ch === '[') {
      const end = groupEnd(preamble, i)
      const statement = end === -1 ? ch : preamble.slice(i, end + 1)
      out += sameLines(statement, '')
      i += statement.length
    } else {
      out += /\s/.test(ch) ? ch : ''
      i += 1
    }
  }
  return out + source.slice(at)
}

/** Expands `\newcommand{\name}[n]{body}` (no defaults, up to three arguments) into the
 * text, then drops the definition. What it cannot expand is left for LaTeX.js to report. */
export function expandNewcommands(source: string): string {
  const definitions: { name: string; args: number; body: string }[] = []
  const rest = source.replace(
    /^[ \t]*\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[(\d)\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}[ \t]*$/gm,
    (whole, name: string, args: string | undefined, body: string) => {
      // a body spanning lines is expanded on one, so an expansion never adds lines
      definitions.push({ name, args: Number(args ?? 0), body: body.replace(/\s*\n\s*/g, ' ') })
      return sameLines(whole, '')
    },
  )
  let out = rest
  for (const { name, args, body } of definitions) {
    const pattern = new RegExp(`\\\\${name}(?![A-Za-z])` + '\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}'.repeat(args), 'g')
    out = out.replace(pattern, (...m: string[]) => sameLines(m[0], body.replace(/#(\d)/g, (_, i: string) => (m[Number(i)] ?? '').replace(/\n/g, ' '))))
  }
  return out
}

const MATH_ENVS = ['equation', 'equation*', 'displaymath', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'flalign', 'flalign*']

function rewriteMath(source: string): string {
  let s = source
  for (const env of MATH_ENVS) {
    const name = env.replace('*', '\\*')
    const aligned = !/^(equation|displaymath)/.test(env)
    s = s.replace(new RegExp(`\\\\begin\\{${name}\\}([\\s\\S]*?)\\\\end\\{${name}\\}`, 'g'), (whole, body: string) => {
      const inner = body.replace(/\\label\{[^}]*\}/g, '').replace(/\\nonumber|\\notag/g, '').trim()
      return sameLines(whole, aligned ? `\\[\\begin{aligned}${inner}\\end{aligned}\\]` : `\\[${inner}\\]`)
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
  s = s.replace(/\\begin\{(verbatim|lstlisting|minted)\}(?:\{[^}]*\})?(?:\[[^\]]*\])?\n?([\s\S]*?)\\end\{\1\}/g, (whole, __, body: string) =>
    sameLines(
      whole,
      `\\begin{flushleft}${body
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => `\\texttt{${escapeText(line) || '~'}}`)
        .join('\\\\ ')}\\end{flushleft}`,
    ),
  )
  // tabular: one row per line, cells separated by a bar
  s = s.replace(/\\begin\{(tabular\*?|tabularx|array|longtable)\}(?:\{[^}]*\})+([\s\S]*?)\\end\{\1\}/g, (whole, __, body: string) => {
    const rows = body
      .replace(/\\(?:hline|toprule|midrule|bottomrule|cmidrule(?:\([^)]*\))?\{[^}]*\}|cline\{[^}]*\})/g, '')
      .split(/\\\\/)
      .map((row) => row.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((row) => row.split(/(?<!\\)&/).map((cell) => cell.trim()).join(' │ '))
    return sameLines(whole, `\\begin{flushleft}${rows.map((r) => `\\texttt{${r}}`).join('\\\\ ')}\\end{flushleft}`)
  })
  // floats: a centered block, \includegraphics inside becomes the custom box
  s = s.replace(/\\begin\{(figure\*?|table\*?|subfigure|wrapfigure|minipage|center)\}(?:\[[^\]]*\])?(?:\{[^}]*\})*/g, (whole) => sameLines(whole, '\\begin{center}'))
  s = s.replace(/\\end\{(figure\*?|table\*?|subfigure|wrapfigure|minipage)\}/g, '\\end{center}')
  s = s.replace(/\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)\}/g, (whole, file: string) => sameLines(whole, `\\ssgraphic{${file}}`))
  s = s.replace(/\\captionof\{[^}]*\}/g, '\\caption')
  // theorem-like: a bold heading, then the text
  for (const env of THEOREM_ENVS) {
    s = s.replace(new RegExp(`\\\\begin\\{${env}\\}(?:\\[([^\\]]*)\\])?`, 'g'), (whole, title?: string) =>
      sameLines(whole, `\\par\\textbf{${env[0].toUpperCase()}${env.slice(1)}${title ? ` (${title.replace(/\n/g, ' ')})` : ''}.} `),
    )
    s = s.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), '\\par')
  }
  s = s.replace(/\\(?:qed|qedhere)\b/g, '')
  s = s.replace(/\\begin\{abstract\}\s*\\end\{abstract\}/g, (whole) => sameLines(whole, ''))
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
  thanks: ['H', 'g'],
  url: ['H', 'g'],
  eqref: ['H', 'g'],
  pageref: ['H', 'g'],
  caption: ['H', 'o?', 'g'],
  ssgraphic: ['H', 'g'],
  ssunknown: ['H', 'g'],
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
Macros.prototype.thanks = Macros.prototype.footnote
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
/** Where a macro LaTeX.js does not know stood: its name in a grey box, so the page still
 * renders and the author can see what the preview could not show. */
Macros.prototype.ssunknown = function (this: { g: Generator }, name: Node) {
  const box = this.g.create('span')
  box.className = 'ss-unknown'
  box.textContent = `\\${(name.textContent ?? '').replace(/‐/g, '-')}`
  box.title = 'Not supported by the preview (LaTeX.js). It still compiles with LaTeX.'
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

/** One thing LaTeX.js did not know, and the lines (in the author's file) it was used on. */
export type UnknownMacro = { what: string; lines: number[] }
export type RenderResult = { root: HTMLElement; unknown: UnknownMacro[] }
export type RenderFailure = { message: string; line?: number }

/** How many different unknown things one render neutralizes before giving up; each new one
 * costs a parse of the whole file. */
const MAX_UNKNOWN = 40

/** A rewrite that gets past one "I do not know this" from LaTeX.js: `apply` replaces every
 * use in a source and says which lines it touched. Kept in `learnt` once found, keyed by
 * LaTeX.js's own message, so the next render applies it before parsing. */
type Neutralization = { what: string; apply: (source: string) => { source: string; lines: number[] } }
/** Per set of loaded packages: \textalpha is unknown without textgreek and fine with it, so
 * what one file taught must not be applied to a file that loads different packages. */
const learnt = new Map<string, Map<string, Neutralization>>()

/** The bundled packages a prepared source loads, as a cache key. */
function packageScope(source: string): string {
  return [...source.matchAll(/\\usepackage\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .sort()
    .join(',')
}

/** How many times LaTeX.js has parsed, for the tests that check the cache. */
export const previewStats = { parses: 0 }

/** Forgets what earlier renders learnt (tests). */
export function forgetUnknowns(): void {
  learnt.clear()
}

type LatexModule = typeof import('latex.js')
let latexModule: Promise<LatexModule> | null = null

/** The library, loaded on first use (it is ~600 kB) and kept. */
function loadLatex(): Promise<LatexModule> {
  latexModule ??= import('latex.js')
  return latexModule
}

/**
 * Compiles LaTeX.js-safe source into a detached element. A macro, environment, counter or
 * length LaTeX.js does not know does not stop the page: every use of it is replaced (a grey
 * placeholder for a macro or environment, nothing for a counter or length), the source is
 * parsed again, and `unknown` lists what was replaced with its lines. Throws RenderFailure
 * with the line only for a real syntax error; never anything else, so the editor cannot
 * crash on it.
 */
export async function renderLatex(source: string): Promise<RenderResult> {
  const { parse, HtmlGenerator } = await loadLatex()
  const unknown: UnknownMacro[] = []
  let current = source
  const scope = packageScope(source)
  const known = learnt.get(scope) ?? new Map<string, Neutralization>()
  learnt.set(scope, known)
  // What earlier renders learnt, applied first; an entry with nothing left to match is gone.
  for (const [key, entry] of known) {
    const applied = entry.apply(current)
    if (applied.lines.length === 0) {
      known.delete(key)
      continue
    }
    unknown.push({ what: entry.what, lines: applied.lines })
    current = applied.source
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      previewStats.parses += 1
      const generator = new HtmlGenerator({ hyphenate: false, CustomMacros: SECRETSOURCE_MACROS })
      const doc = parse(current, { generator })
      const root = document.createElement('div')
      root.appendChild(doc.domFragment())
      return { root, unknown }
    } catch (error) {
      const e = error as { message?: string; location?: { start?: { line?: number } } }
      const message = e.message ?? String(error)
      const key = message.split('\n')[0]
      const fix = attempt < MAX_UNKNOWN && !known.has(key) ? neutralize(key) : null
      const applied = fix?.apply(current)
      if (!fix || !applied || applied.source === current) throw { message: readableMessage(message), line: e.location?.start?.line } satisfies RenderFailure
      known.set(key, fix)
      unknown.push({ what: fix.what, lines: applied.lines })
      current = applied.source
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lineAt(text: string, offset: number): number {
  return lineCount(text.slice(0, offset)) + 1
}

/** Every match of `pattern` replaced (line count kept), with the lines the matches were on. */
function replaceEach(source: string, pattern: RegExp, replacement: string): { source: string; lines: number[] } {
  const lines: number[] = []
  const out = source.replace(pattern, (...args: unknown[]) => {
    const whole = args[0] as string
    const offset = args[args.length - 2] as number
    const line = lineAt(source, offset)
    if (!lines.includes(line)) lines.push(line)
    return sameLines(whole, replacement)
  })
  return { source: out, lines }
}

/** The rewrite that gets past one of LaTeX.js's "I do not know this" messages, or null when
 * the message is something else (a syntax error). */
function neutralize(message: string): Neutralization | null {
  let m = message.match(/^unknown macro: \\([A-Za-z@]+)$/)
  if (m) {
    const name = m[1]
    return { what: `\\${name}`, apply: (source) => replaceEach(source, new RegExp(`(?<!\\\\)\\\\${name}(?![A-Za-z@])`, 'g'), `\\ssunknown{${name}}`) }
  }
  m = message.match(/^unknown environment: (\S+)$/)
  if (m) {
    const name = m[1]
    const env = escapeRegExp(name)
    return {
      what: `${name} environment`,
      apply: (source) => {
        const begun = replaceEach(source, new RegExp(`\\\\begin\\{${env}\\}`, 'g'), `\\ssunknown{begin ${name}}`)
        return { ...begun, source: begun.source.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), `\\ssunknown{end ${name}}`) }
      },
    }
  }
  m = message.match(/^no such counter: (\S+)$/)
  if (m) {
    const counter = escapeRegExp(m[1])
    return { what: `\\setcounter{${m[1]}}`, apply: (source) => replaceEach(source, new RegExp(`\\\\(?:setcounter|addtocounter|stepcounter|refstepcounter)\\{${counter}\\}(?:\\{[^}]*\\})?`, 'g'), '') }
  }
  m = message.match(/^no such length: (\S+)$/)
  if (m) {
    const length = escapeRegExp(m[1])
    return { what: `\\setlength{\\${m[1]}}`, apply: (source) => replaceEach(source, new RegExp(`\\\\(?:setlength|addtolength)\\{\\\\${length}\\}\\{[^}]*\\}`, 'g'), '') }
  }
  return null
}

/** LaTeX.js's messages in the author's words. The unknown-macro wording is reached only
 * past MAX_UNKNOWN different unknowns, or for a name the placeholder cannot stand in for. */
function readableMessage(message: string): string {
  const first = message.split('\n')[0]
  const macro = first.match(/^unknown macro: \\?(\S+)/)
  if (macro) return `\\${macro[1]} is not supported by the preview (LaTeX.js). It still compiles with LaTeX.`
  const env = first.match(/^unknown environment: (\S+)/)
  if (env) return `The ${env[1]} environment is not supported by the preview (LaTeX.js). It still compiles with LaTeX.`
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
