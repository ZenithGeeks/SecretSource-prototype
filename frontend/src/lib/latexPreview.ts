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
 *    known unknowns costs one parse; an entry that no longer matches anything is dropped,
 *    and only the MAX_SCOPES most recently rendered package sets are remembered at all.
 *    Only a real syntax error — an unclosed group, a missing \end{document} — is reported.
 *    `renderIsolated` goes one step further: when the whole file fails, it renders the body
 *    section by section, so only the broken block becomes an inline error with its line.
 * 3. `SECRETSOURCE_MACROS` adds the commands the chapter still needs as LaTeX.js custom
 *    macros (\footnote, \url, \eqref, \pageref, \caption, \includegraphics as the draft's
 *    image or a sized box naming it, the placeholder). LaTeX.js copies the *enumerable*
 *    members of the macro object, so they are assigned on the prototype, never written as
 *    class methods.
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

/** Packages LaTeX.js lacks that preparePreview stands in for itself, so they get no notice
 * either: comment (its environments are blanked out, as LaTeX hides them), subcaption, subfig
 * and caption (a sub-figure becomes a block with its caption), and algorithm, algpseudocode
 * and algorithmic (an algorithm becomes numbered monospace lines). */
const EMULATED = new Set(['comment', 'subcaption', 'subfig', 'caption', 'algorithm', 'algpseudocode', 'algorithmic', 'algorithmicx'])

/** What the notice says for a package whose effect the preview cannot show, where its bare
 * name would not say what is missing. */
const NOT_SHOWN: Record<string, string> = { fancyhdr: 'fancyhdr (page headers and footers are not shown)' }

/** Page styles, headers and footers: the preview is one page with none. Dropped wherever they
 * are, with no notice of their own (fancyhdr's covers them). */
const PAGE_STYLE_COMMANDS = ['fancyhf', 'fancyhead', 'fancyfoot', 'lhead', 'chead', 'rhead', 'lfoot', 'cfoot', 'rfoot', 'fancypagestyle', 'pagestyle', 'thispagestyle']

/** Commands whose first argument is a bare control sequence, as in
 * `\algrenewcommand\algorithmicrequire{…}`: the preamble filter takes it with the command
 * instead of reading it as a statement of its own. */
const TAKES_A_MACRO = new Set(['algrenewcommand', 'algnewcommand', 'algrenewtext', 'algnewtext', 'renewcommand', 'newcommand', 'providecommand', 'DeclareRobustCommand', 'def', 'let'])

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
  { construct: 'anything else in the preamble (\\newtheorem, \\geometry, \\DeclareMathOperator, \\hypersetup, \\algrenewcommand, …)', shownAs: 'dropped and named in the notice; \\documentclass, \\title, \\author, \\date, \\setcounter and \\setlength stay' },
  { construct: '\\pagestyle, \\thispagestyle and fancyhdr (\\fancyhf, \\fancyhead, \\fancyfoot, …), anywhere', shownAs: 'dropped: the preview is one page with no header or footer; the notice says "fancyhdr (page headers and footers are not shown)" once' },
  { construct: 'a macro or environment LaTeX.js does not know, in the body', shownAs: 'a grey box with its name where it was; the rest of the page still renders, and the notice lists it with its lines' },
  { construct: '\\setcounter / \\setlength of a counter or length LaTeX.js does not have', shownAs: 'dropped and listed in the notice' },
  { construct: 'comment environments, with \\usepackage{comment}', shownAs: 'nothing, as LaTeX shows nothing (the package is not bundled, so the preview blanks them itself)' },
  { construct: '\\bibliography, \\bibliographystyle, \\input, \\include, \\graphicspath', shownAs: 'dropped; the References list is built from the .bib instead' },
  { construct: '\\newcommand / \\renewcommand with plain or #1…#3 bodies', shownAs: 'expanded in the source before parsing' },
  { construct: 'equation, equation*, displaymath', shownAs: 'display math \\[ … \\], \\label and \\nonumber removed' },
  { construct: 'align, align*, gather, gather*, multline, multline*, eqnarray', shownAs: 'display math with an aligned block' },
  { construct: 'figure, figure*, table, table*, subfigure, minipage', shownAs: 'a centered block with its caption' },
  { construct: '\\subcaptionbox{caption}{content}, \\subfloat[caption]{content}', shownAs: 'the content, then the caption, in a centered block' },
  { construct: 'algorithm with algorithmic (algpseudocode: \\State, \\If, \\For, \\While, \\Function, \\Return, \\Comment, …)', shownAs: '"Algorithm n:" and its caption, then numbered monospace lines indented by nesting' },
  { construct: 'thebibliography with \\bibitem', shownAs: 'a numbered References list; \\cite numbers follow it instead of the .bib' },
  { construct: 'tabular, tabularx, array', shownAs: 'one line per row, cells separated by │; rules dropped' },
  { construct: 'verbatim, lstlisting, minted', shownAs: 'typewriter lines' },
  { construct: 'theorem-like environments (theorem, lemma, proof, definition, remark, corollary)', shownAs: 'a bold heading and the text' },
  { construct: '\\footnote, \\thanks', shownAs: 'the note in superscript brackets' },
  { construct: '\\eqref, \\pageref', shownAs: '(label) / ?' },
  { construct: '\\url, \\href', shownAs: 'a link' },
  { construct: '\\includegraphics[width=0.49\\textwidth | 5cm | scale=0.5]{file}', shownAs: 'the image at that width when the draft has it, else a box of that width saying "Image not uploaded: file" (drafts keep no images yet)' },
  { construct: 'a block of the body that will not compile (an unclosed group, …)', shownAs: 'an inline error with its line where the block stood; the other sections still render' },
]

/** The LaTeX.js-safe version of a file, and what the preview left out of it. `source` has
 * exactly as many lines as `content`, so a line LaTeX.js reports is a line in the file. */
export type PreparedSource = {
  source: string
  /** What was dropped, in the author's words, in source order, each once: "geometry",
   * "\\newtheorem", "multicols (shown as one column)". Empty when nothing was. */
  ignored: string[]
  /** The keys of the file's own thebibliography, in order: its \cite numbers come from these
   * (the page shows that list) instead of the .bib. Empty when it has none. */
  bibitems: string[]
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
  s = replaceCommands(s, PAGE_STYLE_COMMANDS, () => '')
  s = rewriteMath(s)
  const bibitems: string[] = []
  s = rewriteEnvironments(s, bibitems)
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
  return { source: s, ignored, bibitems }
}

/** The LaTeX.js-safe version of a file (see preparePreview). */
export function prepareSource(content: string): string {
  return preparePreview(content).source
}

// --- the preamble ---------------------------------------------------------------------

/** What may precede \begin{document}: LaTeX.js accepts these there (a \setcounter or
 * \setlength of something it lacks is caught by renderLatex) and nothing else. */
const PREAMBLE_ALLOWED = new Set(['documentclass', 'title', 'author', 'date', 'setcounter', 'setlength', 'makeatletter', 'makeatother'])

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

/** Where `count` bare control sequences after `from` end (spaces before each allowed), or
 * `from` when there are none: `\algorithmicrequire` in `\algrenewcommand\algorithmicrequire`. */
function macroTokensEnd(text: string, from: number, count: number): number {
  let i = from
  for (let n = 0; n < count; n += 1) {
    let j = i
    while (j < text.length && /\s/.test(text[j])) j += 1
    const token = text[j] === '\\' ? text.slice(j + 1).match(/^(?:[A-Za-z@]+|.)/)?.[0] : undefined
    if (!token) return i
    i = j + 1 + token.length
  }
  return i
}

/** The brace groups after a command name at `from`: an optional `[…]` first when `optional`,
 * then exactly `count` `{…}` groups, with spaces or newlines between. Their contents and where
 * they end; null when a required group is missing or never closes. */
function commandArguments(text: string, from: number, count: number, optional = false): { optional?: string; args: string[]; end: number } | null {
  const skip = (at: number) => {
    let j = at
    while (j < text.length && /\s/.test(text[j])) j += 1
    return j
  }
  let i = from
  let opt: string | undefined
  if (optional && text[skip(i)] === '[') {
    const open = skip(i)
    const close = groupEnd(text, open)
    if (close === -1) return null
    opt = text.slice(open + 1, close)
    i = close + 1
  }
  const args: string[] = []
  for (let n = 0; n < count; n += 1) {
    const open = skip(i)
    if (text[open] !== '{') return null
    const close = groupEnd(text, open)
    if (close === -1) return null
    args.push(text.slice(open + 1, close))
    i = close + 1
  }
  return { optional: opt, args, end: i }
}

/**
 * Every use of the commands in `names` (not a longer name that starts with one) replaced by
 * what `render` makes of its arguments. `shape` says what each takes (see commandArguments);
 * by default all the `[…]` and `{…}` groups that follow, as `args` in order. A use whose
 * arguments are missing is left as it is. The replacement keeps the line count.
 */
function replaceCommands(
  text: string,
  names: readonly string[],
  render: (name: string, args: string[], optional: string | undefined) => string,
  shape?: (name: string) => { count: number; optional?: boolean },
): string {
  const pattern = new RegExp(`\\\\(${names.map(escapeRegExp).join('|')})\\*?(?![A-Za-z@])`, 'g')
  let out = ''
  let last = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const start = m.index
    const from = start + m[0].length
    let args: string[]
    let optional: string | undefined
    let end: number
    if (shape) {
      const { count, optional: takesOptional } = shape(m[1])
      const found = commandArguments(text, from, count, takesOptional)
      if (!found) continue
      ;({ args, optional, end } = found)
    } else {
      end = argumentsEnd(text, from)
      args = []
      for (let i = from; i < end; ) {
        while (/\s/.test(text[i])) i += 1
        const close = groupEnd(text, i)
        args.push(text.slice(i + 1, close))
        i = close + 1
      }
    }
    out += text.slice(last, start) + sameLines(text.slice(start, end), render(m[1], args, optional))
    last = end
    pattern.lastIndex = end
  }
  return out + text.slice(last)
}

/** `\usepackage[opts]{a,b}` as LaTeX.js can take it: the built-in packages without options,
 * or nothing. The others are reported. */
function rewriteUsepackage(statement: string, note: (what: string) => void): string {
  const names = [...statement.matchAll(/\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .filter(Boolean)
  const kept = names.filter((n) => BUILT_IN_PACKAGES.has(n))
  for (const n of names) if (!BUILT_IN_PACKAGES.has(n) && !KATEX_COVERS.has(n) && !EMULATED.has(n)) note(NOT_SHOWN[n] ?? n)
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
      const bare = name.replace(/\*$/, '')
      const after = TAKES_A_MACRO.has(bare) ? macroTokensEnd(preamble, i + 1 + name.length, bare === 'let' ? 2 : 1) : i + 1 + name.length
      const end = argumentsEnd(preamble, after)
      const statement = preamble.slice(i, end)
      if (PREAMBLE_ALLOWED.has(bare)) out += statement
      else if (bare === 'usepackage') out += sameLines(statement, rewriteUsepackage(statement, note))
      else if (PAGE_STYLE_COMMANDS.includes(bare)) out += sameLines(statement, '')
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

/** algpseudocode's statements: what each prints (`#` for its arguments, in order) and how it
 * moves the indentation. Unnumbered ones get no line number, as in LaTeX. */
type AlgStep = { words: string; args: number; outdent?: boolean; indent?: boolean; unnumbered?: boolean }
const ALG_STEPS: Record<string, AlgStep> = {
  State: { words: '', args: 0 },
  Statex: { words: '', args: 0, unnumbered: true },
  Require: { words: '\\textbf{Require:}', args: 0, unnumbered: true },
  Ensure: { words: '\\textbf{Ensure:}', args: 0, unnumbered: true },
  Input: { words: '\\textbf{Input:}', args: 0, unnumbered: true },
  Output: { words: '\\textbf{Output:}', args: 0, unnumbered: true },
  If: { words: '\\textbf{if} # \\textbf{then}', args: 1, indent: true },
  ElsIf: { words: '\\textbf{else if} # \\textbf{then}', args: 1, outdent: true, indent: true },
  Else: { words: '\\textbf{else}', args: 0, outdent: true, indent: true },
  EndIf: { words: '\\textbf{end if}', args: 0, outdent: true },
  For: { words: '\\textbf{for} # \\textbf{do}', args: 1, indent: true },
  ForAll: { words: '\\textbf{for all} # \\textbf{do}', args: 1, indent: true },
  EndFor: { words: '\\textbf{end for}', args: 0, outdent: true },
  While: { words: '\\textbf{while} # \\textbf{do}', args: 1, indent: true },
  EndWhile: { words: '\\textbf{end while}', args: 0, outdent: true },
  Repeat: { words: '\\textbf{repeat}', args: 0, indent: true },
  Until: { words: '\\textbf{until} #', args: 1, outdent: true },
  Loop: { words: '\\textbf{loop}', args: 0, indent: true },
  EndLoop: { words: '\\textbf{end loop}', args: 0, outdent: true },
  Function: { words: '\\textbf{function} #(#)', args: 2, indent: true },
  EndFunction: { words: '\\textbf{end function}', args: 0, outdent: true },
  Procedure: { words: '\\textbf{procedure} #(#)', args: 2, indent: true },
  EndProcedure: { words: '\\textbf{end procedure}', args: 0, outdent: true },
}

/** algpseudocode's commands inside a statement, with what each prints. */
const ALG_INLINE: Record<string, { args: number; words: string }> = {
  Return: { args: 0, words: '\\textbf{return}' },
  Comment: { args: 1, words: '~~$\\triangleright$ #' },
  Call: { args: 2, words: '#(#)' },
  True: { args: 0, words: '\\textbf{true}' },
  False: { args: 0, words: '\\textbf{false}' },
  And: { args: 0, words: '\\textbf{and}' },
  Or: { args: 0, words: '\\textbf{or}' },
  Not: { args: 0, words: '\\textbf{not}' },
  To: { args: 0, words: '\\textbf{to}' },
}

/** `words` with each `#` replaced by the next argument, on one line. */
function fill(words: string, args: string[]): string {
  let i = 0
  return words.replace(/#/g, () => (args[i++] ?? '').replace(/\s+/g, ' ').trim())
}

/** An algorithmic block as numbered monospace lines (every `every`-th numbered, as
 * `\begin{algorithmic}[every]`; none when 0), indented by its If/For/While nesting. */
function rewriteAlgorithmic(every: number, body: string): string {
  const text = replaceCommands(
    body.replace(/(?<!\\)%[^\n]*/g, ''),
    Object.keys(ALG_INLINE),
    (name, args) => fill(ALG_INLINE[name].words, args),
    (name) => ({ count: ALG_INLINE[name].args }),
  )
  const steps = [...text.matchAll(new RegExp(`\\\\(${Object.keys(ALG_STEPS).join('|')})(?![A-Za-z])`, 'g'))]
  const lines: string[] = []
  let depth = 0
  let number = 0
  steps.forEach((m, k) => {
    const step = ALG_STEPS[m[1]]
    const from = (m.index ?? 0) + m[0].length
    const found = commandArguments(text, from, step.args) ?? { args: [], end: from }
    const rest = text.slice(found.end, steps[k + 1]?.index ?? text.length).replace(/\s+/g, ' ').trim()
    if (step.outdent) depth = Math.max(0, depth - 1)
    if (!step.unnumbered) number += 1
    const label = every > 0 ? (!step.unnumbered && number % every === 0 ? `${number}:` : '').padStart(4, '~') + '~' : ''
    lines.push(`\\texttt{${label}${'~~'.repeat(depth)}${[fill(step.words, found.args), rest].filter(Boolean).join(' ')}}`)
    if (step.indent) depth += 1
  })
  return `\\begin{flushleft}${lines.join('\\\\ ')}\\end{flushleft}`
}

/** \includegraphics's width as the preview sizes it: a fraction of \textwidth, \linewidth or
 * \columnwidth as a percentage ("49%"), an absolute width as a CSS length ("5cm"), a scale as
 * "scale 0.5" (of the image's own size), or "" when the options set none of these. */
export function graphicWidth(options: string): string {
  const width = options.match(/(?:^|[[,\s])width\s*=\s*([\d.]*)\s*(\\(?:textwidth|linewidth|columnwidth|hsize)|cm|mm|in|pt|bp|pc|em|ex)(?![A-Za-z])/)
  if (width) {
    const n = width[1] === '' ? 1 : Number(width[1])
    if (!Number.isFinite(n) || n <= 0) return ''
    if (width[2].startsWith('\\')) return `${Math.round(Math.min(n, 1) * 10000) / 100}%`
    return `${n}${width[2] === 'bp' ? 'pt' : width[2]}`
  }
  const scale = options.match(/(?:^|[[,\s])scale\s*=\s*([\d.]+)/)
  if (scale && Number(scale[1]) > 0) return `scale ${Number(scale[1])}`
  return ''
}

function rewriteEnvironments(source: string, bibitems: string[]): string {
  let s = source
  // thebibliography: its own numbered list, which the \cite numbers then follow
  s = s.replace(/\\begin\{thebibliography\}\{[^}\n]*\}([\s\S]*?)\\end\{thebibliography\}/g, (whole, body: string) => {
    const parts = body.split(/\\bibitem(?:\[[^\]]*\])?\{([^}]*)\}/)
    const entries: string[] = []
    for (let i = 1; i < parts.length; i += 2) {
      bibitems.push(parts[i].trim())
      entries.push(`{[${bibitems.length}]}~${parts[i + 1].replace(/\s+/g, ' ').trim()}`)
    }
    return sameLines(whole, `\\begin{flushleft}\\textbf{References}${entries.map((e) => `\\\\ ${e}`).join('')}\\end{flushleft}`)
  })
  // algorithmic: numbered monospace lines; algorithm around it: "Algorithm n:" and its caption
  s = s.replace(/\\begin\{algorithmic\}(?:\[(\d*)\])?([\s\S]*?)\\end\{algorithmic\}/g, (whole, every: string | undefined, body: string) =>
    sameLines(whole, rewriteAlgorithmic(Number(every || 0), body)),
  )
  let algorithms = 0
  s = s.replace(/\\begin\{algorithm\*?\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{algorithm\*?\}/g, (whole, body: string) => {
    algorithms += 1
    const n = algorithms
    const captioned = replaceCommands(
      body,
      ['caption'],
      (_, [caption]) => `\\begin{flushleft}\\textbf{Algorithm ${n}:} ${caption.replace(/\s+/g, ' ')}\\end{flushleft}`,
      () => ({ count: 1, optional: true }),
    )
    return sameLines(whole, captioned)
  })
  // subfigure-like commands: the content, then its caption, in a centered block
  s = replaceCommands(
    s,
    ['subcaptionbox', 'subfloat'],
    (name, [first, second], optional) => {
      const [caption, content] = name === 'subfloat' ? [optional ?? '', first] : [first, second]
      return `\\begin{center}${content}${caption.trim() ? `\\caption{${caption}}` : ''}\\end{center}`
    },
    (name) => (name === 'subfloat' ? { count: 1, optional: true } : { count: 2, optional: true }),
  )
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
  // \includegraphics: the path and the width as text, escaped, so an `_` or `%` in a file name
  // is a character and not math or a comment (an unescaped `_` stopped LaTeX.js with "group
  // argument expected"); SECRETSOURCE_MACROS draws the image or a box naming it.
  s = s.replace(/\\includegraphics\*?(\[[^\]]*\])?\{([^}]*)\}/g, (whole, options: string | undefined, file: string) =>
    sameLines(whole, `\\ssgraphic{${escapeText(file.trim())}}{${escapeText(graphicWidth(options ?? ''))}}`),
  )
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
  ssgraphic: ['H', 'g', 'g'],
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
// An empty group ("no width") reaches a macro as undefined, not as an empty node.
Macros.prototype.ssgraphic = function (this: { g: Generator }, file?: Node, width?: Node) {
  return [graphic(this.g, plain(file?.textContent ?? ''), plain(width?.textContent ?? ''))]
}
/** Where a macro LaTeX.js does not know stood: its name in a grey box, so the page still
 * renders and the author can see what the preview could not show. */
Macros.prototype.ssunknown = function (this: { g: Generator }, name: Node) {
  const box = this.g.create('span')
  box.className = 'ss-unknown'
  box.textContent = `\\${plain(name.textContent ?? '')}`
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

/** An argument LaTeX.js has already typeset (fi → ﬁ, - → ‐, a zero-width space after `\_`)
 * with the plain characters back, as a file name or a width wants them. */
function plain(text: string): string {
  return text.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/‐/g, '-').replace(/​/g, '')
}

/** The draft's images by path ("figures/gemm_spock.png") to a URL the page can load. Nothing
 * supplies one yet: drafts keep only their .tex and .bib files, so every image is a box naming
 * it. When images are uploaded with a draft, the editor passes them here and they render. */
export type ImageMap = ReadonlyMap<string, string>

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'gif', 'eps']

function baseName(path: string): string {
  return path.replace(/^\.\//, '').split('/').pop() ?? path
}

/** The URL of the image \includegraphics{path} names, matched as LaTeX finds it: the exact
 * path first, then the same file name in any folder, and a path without an extension
 * ("figures/posv") matches posv.png, .jpg, .pdf, …. Undefined when the draft has none. */
export function findImage(images: ImageMap, path: string): string | undefined {
  const wanted = path.trim().replace(/^\.\//, '')
  const hasExtension = /\.[A-Za-z0-9]+$/.test(baseName(wanted))
  const candidates = hasExtension ? [wanted] : IMAGE_EXTENSIONS.map((ext) => `${wanted}.${ext}`)
  for (const candidate of candidates) {
    const exact = images.get(candidate) ?? images.get(`./${candidate}`)
    if (exact) return exact
  }
  for (const candidate of candidates) {
    for (const [key, url] of images) if (baseName(key) === baseName(candidate)) return url
  }
  return undefined
}

/** The CSS width for graphicWidth's answer, or "" for the image's own size. */
function cssWidth(width: string): string {
  return width.startsWith('scale ') ? '' : width
}

/** An image the draft has, at its \includegraphics width, or a box of that width naming the
 * file the draft does not have. */
function graphic(g: Generator, path: string, width: string, images?: ImageMap): HTMLElement {
  const url = images ? findImage(images, path) : undefined
  const scale = width.startsWith('scale ') ? Number(width.slice(6)) : null
  if (url) {
    const img = g.create('img') as HTMLImageElement
    img.className = 'ss-image'
    img.src = url
    img.alt = path
    img.style.width = cssWidth(width)
    if (scale) img.addEventListener('load', () => (img.style.width = `${Math.round(img.naturalWidth * scale)}px`), { once: true })
    return img
  }
  const box = g.create('div')
  box.className = 'ss-graphic'
  box.textContent = `Image not uploaded: ${path}`
  box.style.width = scale ? `${Math.round(Math.min(scale, 1) * 100)}%` : cssWidth(width)
  return box
}

/** SECRETSOURCE_MACROS with \ssgraphic drawing the draft's images from `images`. */
function macrosWith(images: ImageMap | undefined): typeof Macros {
  if (!images || images.size === 0) return Macros
  function WithImages(this: { g: Generator }, generator: Generator) {
    this.g = generator
  }
  WithImages.args = Macros.args
  WithImages.prototype = Object.create(Macros.prototype) as typeof Macros.prototype
  WithImages.prototype.ssgraphic = function (this: { g: Generator }, file?: Node, width?: Node) {
    return [graphic(this.g, plain(file?.textContent ?? ''), plain(width?.textContent ?? ''), images)]
  }
  return WithImages as unknown as typeof Macros
}

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
 * what one file taught must not be applied to a file that loads different packages. Ordered
 * by last use (a render moves its scope to the end), so the first entry is the one to drop. */
const learnt = new Map<string, Map<string, Neutralization>>()
/** How many package sets `learnt` keeps. A scope a draft stops using (another file, a removed
 * package, a closed draft) would otherwise stay for the page's lifetime, one per combination
 * a long session met; the least recently rendered one goes instead. Re-learning it costs one
 * parse per unknown, as on a first render. */
const MAX_SCOPES = 8

/** The bundled packages a prepared source loads, as a cache key. */
function packageScope(source: string): string {
  return [...source.matchAll(/\\usepackage\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .sort()
    .join(',')
}

/** How many times LaTeX.js has parsed, and how many package sets are remembered, for the
 * tests that check the cache. */
export const previewStats = {
  parses: 0,
  get scopes(): number {
    return learnt.size
  },
}

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
export async function renderLatex(source: string, options: { images?: ImageMap } = {}): Promise<RenderResult> {
  const { parse, HtmlGenerator } = await loadLatex()
  const CustomMacros = macrosWith(options.images)
  const unknown: UnknownMacro[] = []
  let current = source
  const scope = packageScope(source)
  const known = learnt.get(scope) ?? new Map<string, Neutralization>()
  // Re-inserted so the map's order is by last use; then the oldest go while over the cap.
  learnt.delete(scope)
  learnt.set(scope, known)
  for (const oldest of learnt.keys()) {
    if (learnt.size <= MAX_SCOPES) break
    learnt.delete(oldest)
  }
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
      const generator = new HtmlGenerator({ hyphenate: false, CustomMacros })
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

/** A block of the body that would not compile on its own, with the line LaTeX.js stopped at
 * (in the author's file) or, when it named none, the block's first line. */
export type BlockFailure = { message: string; line: number }
export type IsolatedResult = RenderResult & { failures: BlockFailure[] }

const HEADING = /^[ \t]*\\(?:part|chapter|section|subsection)\*?\s*[[{]/

/**
 * The body's blocks as line ranges [start, end) (0-based, in the prepared source): cut before
 * every \part, \chapter, \section or \subsection, or, in a body with none, at blank lines.
 * Never inside an environment, so a figure or an algorithm stays whole. Null when the source
 * has no \begin{document} … \end{document} or only one block.
 */
function bodyBlocks(lines: string[]): { first: number; last: number; blocks: [number, number][] } | null {
  const first = lines.findIndex((l) => /^[ \t]*\\begin\{document\}/.test(l))
  const last = lines.findLastIndex((l) => /^[ \t]*\\end\{document\}/.test(l))
  if (first === -1 || last <= first) return null
  const body = lines.slice(first + 1, last)
  const byHeading = body.some((l) => HEADING.test(l))
  const blocks: [number, number][] = []
  let start = first + 1
  let depth = 0
  for (let i = first + 1; i < last; i += 1) {
    const line = lines[i]
    const cut = byHeading ? HEADING.test(line) : line.trim() === '' && lines[i - 1]?.trim() !== ''
    if (cut && depth === 0 && i > start) {
      blocks.push([start, i])
      start = i
    }
    depth += (line.match(/\\begin\{/g)?.length ?? 0) - (line.match(/\\end\{/g)?.length ?? 0)
    if (depth < 0) depth = 0
  }
  blocks.push([start, last])
  return blocks.length > 1 ? { first, last, blocks } : null
}

/** How many headings of each level come before `line`, as \setcounter commands, so a block
 * rendered on its own numbers its sections as the whole document would. */
function countersBefore(lines: string[], line: number): string {
  let section = 0
  let subsection = 0
  for (let i = 0; i < line; i += 1) {
    if (/\\section\s*[[{]/.test(lines[i])) {
      section += 1
      subsection = 0
    } else if (/\\subsection\s*[[{]/.test(lines[i])) subsection += 1
  }
  return `\\setcounter{section}{${section}}\\setcounter{subsection}{${subsection}}`
}

/** Moves `from`'s children to the end of `into`, joining a leading `.body` wrapper with the
 * one `into` already ends with, so blocks rendered apart read as one page. */
function appendPage(into: HTMLElement, from: HTMLElement): void {
  for (const child of [...from.childNodes]) {
    const tail = into.lastElementChild
    if (child instanceof HTMLElement && child.classList.contains('body') && tail?.classList.contains('body')) tail.append(...child.childNodes)
    else into.append(child)
  }
}

/**
 * renderLatex, and when the whole file will not compile, the body block by block (see
 * bodyBlocks): each block is parsed with the preamble and every other body line blanked to a
 * comment, so the line numbers stay the file's. A block that fails is an inline error box with
 * its line where it stood; the others render. Throws the whole file's RenderFailure only when
 * no block compiles (the preamble itself is broken) or the body is one block.
 */
export async function renderIsolated(source: string, options: { images?: ImageMap } = {}): Promise<IsolatedResult> {
  try {
    return { ...(await renderLatex(source, options)), failures: [] }
  } catch (error) {
    const lines = source.split('\n')
    const split = bodyBlocks(lines)
    if (!split) throw error
    const root = document.createElement('div')
    const unknown = new Map<string, Set<number>>()
    const failures: BlockFailure[] = []
    let rendered = 0
    for (const [start, end] of split.blocks) {
      const only = lines.map((line, i) => (i > split.first && i < split.last && (i < start || i >= end) ? '%' : line))
      only[start] = countersBefore(lines, start) + only[start]
      try {
        const block = await renderLatex(only.join('\n'), options)
        for (const u of block.unknown) for (const l of u.lines) unknown.set(u.what, (unknown.get(u.what) ?? new Set()).add(l))
        appendPage(root, block.root)
        rendered += 1
      } catch (blockError) {
        const failure = blockError as RenderFailure
        const line = failure.line ?? start + 1
        failures.push({ message: failure.message, line })
        const box = document.createElement('div')
        box.className = 'ss-block-error'
        box.setAttribute('role', 'note')
        box.textContent = `Line ${line}: ${failure.message} · this part is left out of the preview`
        root.append(box)
      }
    }
    if (rendered === 0) throw error
    return { root, unknown: [...unknown].map(([what, l]) => ({ what, lines: [...l].sort((a, b) => a - b) })), failures }
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
