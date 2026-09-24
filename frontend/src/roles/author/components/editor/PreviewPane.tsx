/**
 * The right half of the split: "Live preview · rendered with LaTeX.js" over the rendered
 * page. Compiles the open file a moment after typing stops; when the source will not
 * compile, the last good page stays and a one-line error says where. The `[n]` markers are
 * coloured by verdict when the toggle is on, and a flagged one opens the issue popover.
 */

// latex.js does not list its stylesheets in its package exports, so KaTeX's layout sheet
// (needed for math to line up) is reached by path. The Computer Modern sheet is left out on
// purpose: it would pull 8 MB of fonts into the bundle.
import '../../../../../node_modules/latex.js/dist/css/katex.css'
import './preview.css'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../../../lib/utils'
import { appendReferences, decorateCitations, prepareSource, referenceNumbers, renderLatex, type RenderFailure } from '../../../../lib/latexPreview'
import type { BibEntry } from '../../../../lib/bibtex'
import { findCites } from '../../../../lib/latexProject'
import { isOpenIssue } from '../../../../lib/verdict'
import type { Citation } from '../../../../types/draftCheck'
import { IssuePopover, type PopoverAnchor } from './IssuePopover'

const RENDER_DELAY_MS = 300

type RenderState = {
  root: HTMLElement | null
  error: RenderFailure | null
  /** The source the state above came from; rendering is under way while it lags `debounced`. */
  source: string | null
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

export function PreviewPane({
  content,
  citations,
  bibEntries,
  verdictColors,
  onToggleVerdictColors,
  onReplace,
  onKeepMine,
}: {
  content: string
  /** The open file's citations, in line order. */
  citations: Citation[]
  bibEntries: BibEntry[]
  verdictColors: boolean
  onToggleVerdictColors: () => void
  onReplace: (citation: Citation) => void
  onKeepMine: (citation: Citation, note: string) => void
}) {
  const debounced = useDebounced(content, RENDER_DELAY_MS)
  const [state, setState] = useState<RenderState>({ root: null, error: null, source: null })
  const rendering = state.source !== debounced
  const page = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ id: string; anchor: PopoverAnchor; trigger: HTMLElement | null; containerWidth: number } | null>(null)

  // Compile after typing pauses; keep the last good page on failure.
  useEffect(() => {
    let cancelled = false
    renderLatex(prepareSource(debounced))
      .then(({ root }) => !cancelled && setState({ root, error: null, source: debounced }))
      .catch((error: RenderFailure) => !cancelled && setState((s) => ({ root: s.root, error, source: debounced })))
    return () => {
      cancelled = true
    }
  }, [debounced])

  // Numbered like plainnat: only the works this file cites, by first author.
  const numbers = useMemo(
    () => referenceNumbers(bibEntries, new Set(findCites({ name: 'preview', content }).map((c) => c.key))),
    [bibEntries, content],
  )
  const issues = useMemo(() => citations.filter(isOpenIssue), [citations])

  // Put the page in the DOM with the markers decorated. A fresh clone each time, so the
  // decoration can be redone when the citations change without recompiling.
  useEffect(() => {
    const host = page.current
    if (!host || !state.root) return
    const clone = state.root.cloneNode(true) as HTMLElement
    const seen = new Map<string, Citation[]>()
    for (const c of citations) seen.set(c.key, [...(seen.get(c.key) ?? []), c])
    const cited = new Set<string>()
    decorateCitations(clone, (key, occurrence) => {
      cited.add(key)
      const citation = seen.get(key)?.[occurrence]
      return { id: citation?.id, verdict: citation?.verdict, n: numbers.get(key) ?? null }
    })
    appendReferences(clone, bibEntries, numbers, cited)
    host.replaceChildren(clone)
  }, [state.root, citations, bibEntries, numbers])

  const close = useCallback(() => {
    setOpen((o) => {
      o?.trigger?.focus()
      return null
    })
  }, [])

  const openFor = useCallback((id: string, trigger: HTMLElement | null) => {
    const box = scroller.current
    if (!box) return
    const target = trigger ?? box.querySelector<HTMLElement>(`.ss-cite[data-id="${id}"]`)
    if (!target) return
    const r = target.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    target.scrollIntoView({ block: 'nearest' })
    setOpen({
      id,
      anchor: { top: r.top - b.top + box.scrollTop, left: r.left - b.left + box.scrollLeft, width: r.width, height: r.height },
      trigger: target,
      containerWidth: box.clientWidth,
    })
  }, [])

  // Clicks and Enter/Space on a flagged marker open its popover (event delegation: the
  // markers are created outside React).
  const onPageClick = (event: React.MouseEvent) => {
    const marker = (event.target as HTMLElement).closest<HTMLElement>('.ss-cite[data-id]')
    if (marker?.dataset.id) openFor(marker.dataset.id, marker)
  }
  const onPageKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const marker = (event.target as HTMLElement).closest<HTMLElement>('.ss-cite[data-id]')
    if (!marker?.dataset.id) return
    event.preventDefault()
    openFor(marker.dataset.id, marker)
  }

  const current = open ? citations.find((c) => c.id === open.id) : undefined
  const currentIndex = current ? issues.findIndex((c) => c.id === current.id) : -1

  // Highlight the open issue's sentence.
  useEffect(() => {
    const host = page.current
    if (!host) return
    host.querySelectorAll('.ss-active').forEach((el) => el.classList.remove('ss-active'))
    if (open) host.querySelector(`.ss-sentence[data-id="${open.id}"]`)?.classList.add('ss-active')
  }, [open, state.root, citations])

  const next = () => {
    if (issues.length === 0) return
    const target = issues[(currentIndex + 1) % issues.length]
    openFor(target.id, null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-canvas px-3.5 py-2 text-xs">
        <span className="text-[12.5px] font-medium text-ink">Live preview</span>
        <span className="hidden text-ink-muted sm:inline">rendered with LaTeX.js · updates as you type</span>
        {rendering && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Rendering" />}
        <button type="button" onClick={onToggleVerdictColors} aria-pressed={verdictColors} className="ml-auto rounded text-accent hover:underline">
          verdict colors {verdictColors ? 'on' : 'off'}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="flex items-center gap-2 border-b border-insufficient bg-insufficient-soft px-3.5 py-1.5 text-xs text-insufficient">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {state.error.line ? `Line ${state.error.line}: ` : ''}
            {state.error.message}
            {state.root ? ' · showing the last good render' : ''}
          </span>
        </p>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto p-4 sm:p-8">
        {!state.root && !state.error && (
          <p className="text-center text-xs text-ink-muted">Rendering…</p>
        )}
        <div
          ref={page}
          onClick={onPageClick}
          onKeyDown={onPageKey}
          className={cn('ss-preview mx-auto min-h-[24rem] max-w-[560px] rounded-sm bg-surface px-10 py-12 shadow-md sm:px-14', verdictColors && 'ss-verdicts')}
          aria-live="polite"
          aria-busy={rendering}
        />
        {open && current && (
          <IssuePopover
            citation={current}
            index={currentIndex}
            total={issues.length}
            anchor={open.anchor}
            containerWidth={open.containerWidth}
            numberOf={(key) => numbers.get(key) ?? null}
            onReplace={() => {
              onReplace(current)
              close()
            }}
            onKeepMine={(note) => {
              onKeepMine(current, note)
              close()
            }}
            onNext={next}
            onClose={close}
          />
        )}
      </div>
    </div>
  )
}
