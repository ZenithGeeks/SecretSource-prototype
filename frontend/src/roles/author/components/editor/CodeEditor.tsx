/**
 * CodeMirror 6 for one LaTeX file. Owns the editor view; React only pushes in a new document
 * when the file's stored content differs from what is on screen (a replacement made from the
 * Draft check / popover) and reads back changes and cursor moves.
 *
 * Verdicts arrive as `marks`: which line holds a \cite, how it fared, and which lines its
 * sentence spans. They become gutter dots, coloured underlines on the key, and a soft shade
 * on a refuted sentence. Positions are mapped through edits, so a mark stays on its \cite
 * while the author types above it, until the store re-parses and sends fresh line numbers.
 *
 * A .bib's parse warnings arrive as `problems`, one per entry: an amber dot in the same gutter,
 * a wavy underline on the key, and what is wrong in a tooltip while the cursor is on that line.
 * A click on the dot or the key puts the cursor there, so clicking a mark shows what is wrong.
 */

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker, keymap, lineNumbers, showTooltip, type Tooltip } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

import type { Verdict } from '../../../../types/draftCheck'

export type LineMark = {
  line: number
  key: string
  verdict: Verdict
  /** First line of the sentence, for the shaded background on a refuted claim. */
  shadeFrom?: number
}

/** What `\cite{` can complete to: the keys of the project's .bib files, then the sources
 * saved to the project that are not in a .bib yet. */
export type CiteCompletionSource = {
  bibKeys: { key: string; detail: string }[]
  suggested: { key: string; detail: string }[]
}

export type CursorPosition = { line: number; column: number }

/** A .bib problem on the entry's "@type{key," line: a gutter dot, the key underlined, and what
 * is wrong in a tooltip while the cursor is on that line (a click on the dot or key puts it there). */
export type ProblemMark = { line: number; key: string; title: string; message: string }

// --- verdict marks: a state field of doc positions, mapped through changes ---------------

type PositionedMark = { pos: number; shadePos?: number; key: string; verdict: Verdict }

const setMarks = StateEffect.define<LineMark[]>()

const marksField = StateField.define<PositionedMark[]>({
  create: () => [],
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) {
        const doc = tr.state.doc
        return effect.value
          .filter((m) => m.line >= 1 && m.line <= doc.lines)
          .map((m) => ({
            pos: doc.line(m.line).from,
            shadePos: m.shadeFrom && m.shadeFrom <= doc.lines ? doc.line(m.shadeFrom).from : undefined,
            key: m.key,
            verdict: m.verdict,
          }))
      }
    }
    if (!tr.docChanged) return marks
    return marks.map((m) => ({
      ...m,
      pos: tr.changes.mapPos(m.pos, 1),
      shadePos: m.shadePos === undefined ? undefined : tr.changes.mapPos(m.shadePos, 1),
    }))
  },
})

class VerdictDot extends GutterMarker {
  readonly verdict: Verdict
  constructor(verdict: Verdict) {
    super()
    this.verdict = verdict
  }
  eq(other: VerdictDot) {
    return other.verdict === this.verdict
  }
  toDOM() {
    const dot = document.createElement('span')
    dot.className = `cm-verdict-dot cm-verdict-${this.verdict}`
    dot.title = this.verdict
    return dot
  }
}

// --- .bib problems: the same mapping, a dot in the same gutter, a tooltip on the cursor's line --

type PositionedProblem = Omit<ProblemMark, 'line'> & { pos: number }

const setProblems = StateEffect.define<ProblemMark[]>()

const problemsField = StateField.define<PositionedProblem[]>({
  create: () => [],
  update(problems, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setProblems)) {
        const doc = tr.state.doc
        return effect.value.filter((p) => p.line >= 1 && p.line <= doc.lines).map(({ line, ...p }) => ({ ...p, pos: doc.line(line).from }))
      }
    }
    if (!tr.docChanged) return problems
    return problems.map((p) => ({ ...p, pos: tr.changes.mapPos(p.pos, 1) }))
  },
})

// The problems by line, worked out once per problem list and document rather than once per line
// the gutter draws: a .bib can have hundreds of entries.
const byLine = new WeakMap<PositionedProblem[], { doc: EditorState['doc']; lines: Map<number, PositionedProblem[]> }>()

function problemsOnLine(state: EditorState, line: number): PositionedProblem[] {
  const problems = state.field(problemsField)
  let known = byLine.get(problems)
  if (!known || known.doc !== state.doc) {
    const lines = new Map<number, PositionedProblem[]>()
    for (const p of problems) {
      const n = state.doc.lineAt(p.pos).number
      lines.set(n, [...(lines.get(n) ?? []), p])
    }
    byLine.set(problems, (known = { doc: state.doc, lines }))
  }
  return known.lines.get(line) ?? []
}

/** Where `key` sits on its "@type{key," line, or -1: the whole key, so "p" is not found in "@misc{pq,". */
function keyOffset(text: string, key: string): number {
  const open = text.search(/[{(]/)
  if (open < 0) return -1
  const at = open + 1 + (text.slice(open + 1).length - text.slice(open + 1).trimStart().length)
  const rest = text.slice(at + key.length)
  return text.startsWith(key, at) && (rest === '' || /^[\s,]/.test(rest)) ? at : -1
}

class ProblemDot extends GutterMarker {
  readonly title: string
  constructor(title: string) {
    super()
    this.title = title
  }
  eq(other: ProblemDot) {
    return other.title === this.title
  }
  toDOM() {
    const dot = document.createElement('span')
    dot.className = 'cm-verdict-dot cm-bib-problem-dot'
    dot.title = this.title
    return dot
  }
}

type OpenProblems = Tooltip & { at: string }

/** The problems of the line the cursor is on, under that line. It opens when the person moves
 * the cursor onto a problem's line (a click on the dot or the key, the arrow keys), not on its
 * own when a file opens, and closes when the cursor leaves the line. While nothing about it
 * changes it is the same tooltip, so typing on the line neither rebuilds nor re-announces it. */
const problemTooltip = StateField.define<OpenProblems | null>({
  create: () => null,
  update(open, tr) {
    const { state } = tr
    const line = state.doc.lineAt(state.selection.main.head)
    const problems = problemsOnLine(state, line.number)
    if (problems.length === 0) return null
    const at = `${line.from}:${problems.map((p) => p.message).join('\n')}`
    if (open?.at === at) return open
    if (!open && !tr.isUserEvent('select')) return null
    return {
      at,
      pos: line.from,
      above: false,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-bib-problem-tooltip'
        dom.setAttribute('role', 'status')
        for (const p of problems) {
          const row = document.createElement('p')
          const title = document.createElement('strong')
          title.textContent = `${p.title}: `
          row.append(title, p.message)
          dom.append(row)
        }
        return { dom }
      },
    }
  },
  provide: (f) => showTooltip.from(f),
})

const verdictGutter = gutter({
  class: 'cm-verdict-gutter',
  lineMarker(view, block) {
    const line = view.state.doc.lineAt(block.from)
    const mark = view.state.field(marksField).find((m) => view.state.doc.lineAt(m.pos).number === line.number)
    if (mark) return new VerdictDot(mark.verdict)
    const problems = problemsOnLine(view.state, line.number)
    return problems.length ? new ProblemDot(problems.map((p) => p.message).join('\n')) : null
  },
  lineMarkerChange: (update) =>
    update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setMarks) || e.is(setProblems))),
  domEventHandlers: {
    // A click on a problem's dot puts the cursor on its key, which opens what is wrong.
    mousedown(view, block) {
      const line = view.state.doc.lineAt(block.from)
      const problem = problemsOnLine(view.state, line.number)[0]
      if (!problem) return false
      const at = keyOffset(line.text, problem.key)
      view.dispatch({ selection: { anchor: line.from + Math.max(0, at) }, userEvent: 'select.pointer' })
      view.focus()
      return true
    },
  },
})

const CITE_KEYS = /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const mark of state.field(marksField)) {
    const line = state.doc.lineAt(mark.pos)
    if (mark.verdict === 'refutes' && mark.shadePos !== undefined) {
      const first = state.doc.lineAt(mark.shadePos).number
      for (let n = Math.min(first, line.number); n <= line.number; n += 1) {
        ranges.push(Decoration.line({ class: 'cm-line-refutes' }).range(state.doc.line(n).from))
      }
    }
    for (const match of line.text.matchAll(CITE_KEYS)) {
      const inner = match[0].lastIndexOf('{') + 1
      let offset = (match.index ?? 0) + inner
      for (const raw of match[1].split(',')) {
        const key = raw.trim()
        const at = offset + raw.indexOf(key)
        if (key === mark.key) {
          ranges.push(
            Decoration.mark({ class: `cm-cite-key cm-cite-${mark.verdict}`, attributes: { 'data-verdict': mark.verdict } }).range(
              line.from + at,
              line.from + at + key.length,
            ),
          )
        }
        offset += raw.length + 1
      }
    }
  }
  const underlined = new Set<string>()
  for (const problem of state.field(problemsField)) {
    const line = state.doc.lineAt(problem.pos)
    const at = keyOffset(line.text, problem.key)
    // A key with two problems (a duplicate never cited) is underlined once.
    if (at < 0 || underlined.has(`${line.number}:${problem.key}`)) continue
    underlined.add(`${line.number}:${problem.key}`)
    ranges.push(Decoration.mark({ class: 'cm-bib-problem' }).range(line.from + at, line.from + at + problem.key.length))
  }
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of ranges) builder.add(r.from, r.to, r.value)
  return builder.finish()
}

const decorationsField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setMarks) || e.is(setProblems))) return buildDecorations(tr.state)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// --- \cite{ completion --------------------------------------------------------------------

const CITE_BEFORE = /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{[^}]*$/

function completeCite(context: CompletionContext, source: CiteCompletionSource) {
  const before = context.matchBefore(CITE_BEFORE)
  if (!before) return null
  const inner = before.text.slice(before.text.lastIndexOf('{') + 1)
  const word = inner.slice(inner.lastIndexOf(',') + 1).trimStart()
  const from = context.pos - word.length
  const needle = word.toLowerCase()
  const matches = (key: string) => needle === '' || key.toLowerCase().includes(needle)
  const options: Completion[] = [
    ...source.bibKeys.filter((k) => matches(k.key)).map((k) => ({ label: k.key, detail: k.detail, type: 'bib' })),
    ...source.suggested.filter((k) => matches(k.key)).map((k) => ({ label: k.key, detail: k.detail, type: 'suggested' })),
  ]
  if (options.length === 0) return null
  return { from, options, filter: false, validFor: /^[\w:./-]*$/ }
}

// --- look --------------------------------------------------------------------------------

const latexHighlight = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--color-code-command)' },
  { tag: tags.keyword, color: 'var(--color-code-command)' },
  { tag: tags.bracket, color: 'var(--color-code-brace)' },
  { tag: tags.atom, color: 'var(--color-code-math)' },
  { tag: tags.number, color: 'var(--color-code-math)' },
  { tag: tags.comment, color: 'var(--color-code-comment)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--color-surface)', color: 'var(--color-ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '20px', overflow: 'auto' },
  '.cm-content': { padding: '4px 0', caretColor: 'var(--color-accent)' },
  '.cm-line': { padding: '0 8px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-accent-soft)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-canvas)',
    color: 'var(--color-ink-muted)',
    borderRight: '1px solid var(--color-border-subtle)',
    fontSize: '12px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 5px 0 2px', minWidth: '28px' },
  '.cm-verdict-gutter .cm-gutterElement': { width: '12px', paddingLeft: '6px', display: 'flex', alignItems: 'center' },
  '.cm-verdict-dot': { display: 'inline-block', width: '6px', height: '6px', borderRadius: '999px' },
  '.cm-verdict-supports': { backgroundColor: 'var(--color-supports)' },
  '.cm-verdict-insufficient': { backgroundColor: 'var(--color-insufficient)' },
  '.cm-verdict-refutes': { backgroundColor: 'var(--color-refutes)' },
  '.cm-verdict-unavailable, .cm-verdict-unchecked': { backgroundColor: 'var(--color-ink-muted)' },
  '.cm-cite-key': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-cite-supports': { color: 'var(--color-supports)' },
  '.cm-cite-insufficient': { color: 'var(--color-insufficient)' },
  '.cm-cite-refutes': { color: 'var(--color-refutes)' },
  '.cm-cite-unavailable, .cm-cite-unchecked': { color: 'var(--color-ink-muted)' },
  '.cm-line-refutes': { backgroundColor: 'var(--color-refutes-soft)' },
  // .bib problems take the parse warnings' colour (BibliographyCard), not a verdict's.
  '.cm-bib-problem-dot': { backgroundColor: 'var(--color-insufficient)', cursor: 'pointer' },
  '.cm-bib-problem': { textDecoration: 'underline wavy var(--color-insufficient)', textUnderlineOffset: '3px', cursor: 'pointer' },
  '.cm-tooltip.cm-bib-problem-tooltip': { padding: '6px 10px', borderRadius: '8px', fontSize: '12px', maxWidth: '360px', boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)' },
  '.cm-tooltip': { border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-surface)', color: 'var(--color-ink)' },
  '.cm-tooltip.cm-tooltip-autocomplete': { borderRadius: '8px', boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)', overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px 4px 6px', display: 'flex', alignItems: 'center', gap: '8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--color-accent)', color: 'white' },
  '.cm-completionLabel': { flex: '1 0 auto' },
  '.cm-completionDetail': { fontStyle: 'normal', fontSize: '11px', opacity: '0.75', marginLeft: 'auto', fontFamily: 'inherit' },
  '.cm-completionIcon': { width: '1em', opacity: '0.8', paddingRight: '0' },
  '.cm-completionIcon-bib::after': { content: '"▤"' },
  '.cm-completionIcon-suggested::after': { content: '"✦"' },
})

const NO_PROBLEMS: ProblemMark[] = []

export function CodeEditor({
  value,
  marks,
  problems = NO_PROBLEMS,
  completions,
  onChange,
  onCursor,
  onSave,
  jumpTo,
  ariaLabel,
}: {
  value: string
  marks: LineMark[]
  /** The open .bib file's problems (lib/latexProject bibProblems); none for a .tex. */
  problems?: ProblemMark[]
  completions: CiteCompletionSource
  onChange: (value: string) => void
  onCursor: (position: CursorPosition) => void
  onSave: () => void
  /** Move the cursor here; a new `nonce` repeats the same line. */
  jumpTo?: { line: number; column?: number; nonce: number }
  ariaLabel: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const initialValue = useRef(value)
  // The problem list last sent to the view, to leave out sends that change nothing.
  const sentProblems = useRef('[]')
  // The view's extensions read the latest callbacks through this ref, so they never go stale
  // without the view having to be rebuilt.
  const latest = useRef({ onChange, onCursor, onSave, completions, problems })
  useEffect(() => {
    latest.current = { onChange, onCursor, onSave, completions, problems }
  })

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        marksField,
        problemsField,
        problemTooltip,
        decorationsField,
        verdictGutter,
        lineNumbers(),
        history(),
        closeBrackets(),
        StreamLanguage.define(stex),
        syntaxHighlighting(latexHighlight),
        autocompletion({ override: [(ctx) => completeCite(ctx, latest.current.completions)], activateOnTyping: true }),
        keymap.of([
          { key: 'Mod-s', run: () => (latest.current.onSave(), true) },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        theme,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            latest.current.onCursor({ line: line.number, column: head - line.from + 1 })
          }
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    // A new view (a remount, StrictMode's second mount) holds no problems yet.
    sentProblems.current = '[]'
    return () => {
      v.destroy()
      view.current = null
    }
    // The view is created once per mounted file (the parent keys this component by file
    // name); later `value` changes flow through the effect below.
  }, [ariaLabel])

  // External change (a replacement, another tab's edit landing): replace the document.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current === value) return
    // The whole document is replaced, which would map every problem to its end: they are placed
    // afresh on the new text in the same step.
    const { problems: now } = latest.current
    v.dispatch({ changes: { from: 0, to: current.length, insert: value }, effects: setProblems.of(now) })
    sentProblems.current = JSON.stringify(now)
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of(marks) })
  }, [marks])

  // A keystroke anywhere makes a new (usually equal, for a .tex empty) list: only a different
  // one is sent, so the decorations are not rebuilt for nothing.
  useEffect(() => {
    const v = view.current
    const signature = JSON.stringify(problems)
    if (!v || signature === sentProblems.current) return
    sentProblems.current = signature
    v.dispatch({ effects: setProblems.of(problems) })
  }, [problems])

  useEffect(() => {
    const v = view.current
    if (!v || !jumpTo) return
    const line = v.state.doc.line(Math.min(Math.max(1, jumpTo.line), v.state.doc.lines))
    const pos = Math.min(line.from + Math.max(0, (jumpTo.column ?? 1) - 1), line.to)
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    v.focus()
  }, [jumpTo])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" data-testid="code-editor" />
}
