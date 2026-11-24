/**
 * The right half of the split: "Live preview · rendered with LaTeX.js" over the rendered
 * page. Compiles the open file a moment after typing stops; when a part of it will not
 * compile, that part is an inline error and the rest of the page renders (renderIsolated),
 * and a one-line error says where (the line in the author's file: preparePreview keeps the
 * line count). Only when nothing compiles does the last good page stay. What the preview had to leave out
 * (packages and preamble commands LaTeX.js lacks) and what it did not know in the body
 * (shown as grey placeholders) are named in a quiet notice that never blocks the page. The
 * `[n]` markers are coloured by verdict when the toggle is on, and a flagged one opens the
 * issue popover.
 *
 * The page lives in a shadow root, so LaTeX.js's and KaTeX's stylesheets (and the page's own
 * paper look) never leak into the app and the app's Tailwind never reaches the page. Fonts
 * are the exception: an @font-face inside a shadow root does not register, so those rules
 * are lifted into the document once, and KaTeX's woff2 files ship with the bundle.
 */

import katexCss from 'latex.js/dist/css/katex.css?inline'
import { AlertTriangle, Info, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../../../lib/utils'
import {
  appendReferences,
  decorateCitations,
  preparePreview,
  referenceNumbers,
  renderIsolated,
  type BlockFailure,
  type ImageMap,
  type RenderFailure,
  type UnknownMacro,
} from '../../../../lib/latexPreview'
import type { BibEntry } from '../../../../lib/bibtex'
import { findCites } from '../../../../lib/latexProject'
import { useDebounced } from '../../../../lib/useDebounced'
import { isOpenIssue } from '../../../../lib/verdict'
import type { Citation } from '../../../../types/draftCheck'
import { IssuePopover, type PopoverAnchor } from './IssuePopover'
import previewCss from './preview.css?inline'
import { HIGHLIGHT } from '../../hover'

const RENDER_DELAY_MS = 300
const FONT_STYLE_ID = 'ss-preview-fonts'

/** The @font-face rules of a stylesheet, and the sheet without them. */
function splitFontFaces(css: string): { fonts: string; rest: string } {
  const fonts: string[] = []
  const rest = css.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    fonts.push(rule)
    return ''
  })
  return { fonts: fonts.join('\n'), rest }
}

/** Puts KaTeX's fonts on the document once; every preview shares them. */
function ensureFonts(fonts: string) {
  if (document.getElementById(FONT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = FONT_STYLE_ID
  style.textContent = fonts
  document.head.appendChild(style)
}

const KATEX = splitFontFaces(katexCss)

type RenderState = {
  root: HTMLElement | null
  error: RenderFailure | null
  /** What the last good render had to stand in for. */
  unknown: UnknownMacro[]
  /** The blocks of the body left out because they would not compile on their own. */
  failures: BlockFailure[]
  /** The source the state above came from; rendering is under way while it lags `debounced`. */
  source: string | null
}

export function PreviewPane({
  content,
  citations,
  bibEntries,
  images,
  verdictColors,
  onToggleVerdictColors,
  onKeepMine,
  onAskToFix,
}: {
  content: string
  /** The open file's citations, in line order. */
  citations: Citation[]
  bibEntries: BibEntry[]
  /** The draft's images by path, drawn where \includegraphics names them (latexPreview's
   * ImageMap); without it every image is a box naming the file. */
  images?: ImageMap
  verdictColors: boolean
  onToggleVerdictColors: () => void
  onKeepMine: (citation: Citation, note: string) => void
  /** Hands the flagged citation to Ask's Do it mode; none hides "Ask AI how to fix". */
  onAskToFix?: (citation: Citation) => void
}) {
  const debounced = useDebounced(content, RENDER_DELAY_MS)
  const prepared = useMemo(() => preparePreview(debounced), [debounced])
  const [state, setState] = useState<RenderState>({ root: null, error: null, unknown: [], failures: [], source: null })
  const rendering = state.source !== debounced
  const host = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ id: string; anchor: PopoverAnchor; trigger: HTMLElement | null; containerWidth: number } | null>(null)

  // Compile after typing pauses. A block that will not compile is left out with an inline
  // error and the rest renders; only when nothing compiles does the last good page stay.
  useEffect(() => {
    let cancelled = false
    renderIsolated(prepared.source, { images, cancelled: () => cancelled })
      .then(({ root, unknown, failures }) => !cancelled && setState({ root, error: null, unknown, failures, source: debounced }))
      .catch((error: RenderFailure) => !cancelled && setState((s) => ({ ...s, error, source: debounced })))
    return () => {
      cancelled = true
    }
  }, [debounced, prepared, images])

  // Numbered like plainnat: only the works this file cites, by first author. From the debounced
  // text, like the render the numbers decorate: not a scan and a redecoration per keystroke. A
  // file with its own thebibliography is numbered by it, as LaTeX does, and lists it itself.
  const ownList = prepared.bibitems.length > 0
  const numbers = useMemo(
    () =>
      ownList
        ? new Map(prepared.bibitems.map((key, i) => [key, i + 1]))
        : referenceNumbers(bibEntries, new Set(findCites({ name: 'preview', content: debounced }).map((c) => c.key))),
    [bibEntries, debounced, ownList, prepared.bibitems],
  )
  const issues = useMemo(() => citations.filter(isOpenIssue), [citations])

  const openFor = useCallback((id: string, trigger: HTMLElement | null) => {
    const box = scroller.current
    if (!box) return
    const target = trigger ?? page.current?.querySelector<HTMLElement>(`.ss-cite[data-id="${id}"]`) ?? null
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

  // The shadow root: the stylesheets and the page element, made once per mount. Clicks and
  // Enter/Space on a flagged marker open its popover (the markers are created outside React,
  // inside the shadow tree, so the listeners live there too).
  useEffect(() => {
    const element = host.current
    if (!element) return
    ensureFonts(KATEX.fonts)
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    shadow.replaceChildren()
    const katex = document.createElement('style')
    katex.textContent = KATEX.rest
    const look = document.createElement('style')
    look.textContent = previewCss
    const body = document.createElement('article')
    body.className = 'ss-preview'
    body.setAttribute('aria-live', 'polite')
    shadow.append(katex, look, body)
    page.current = body
    const onClick = (event: Event) => {
      const marker = (event.target as HTMLElement).closest?.('.ss-cite[data-id]') as HTMLElement | null
      if (marker?.dataset.id) {
        event.preventDefault()
        openFor(marker.dataset.id, marker)
      }
    }
    const onKey = (event: Event) => {
      const key = (event as KeyboardEvent).key
      if (key !== 'Enter' && key !== ' ') return
      const marker = (event.target as HTMLElement).closest?.('.ss-cite[data-id]') as HTMLElement | null
      if (!marker?.dataset.id) return
      event.preventDefault()
      openFor(marker.dataset.id, marker)
    }
    body.addEventListener('click', onClick)
    body.addEventListener('keydown', onKey)
    return () => {
      body.removeEventListener('click', onClick)
      body.removeEventListener('keydown', onKey)
    }
  }, [openFor])

  // Put the page in the shadow tree with the markers decorated. A fresh clone each time, so
  // the decoration can be redone when the citations change without recompiling.
  useEffect(() => {
    const body = page.current
    if (!body || !state.root) return
    const clone = state.root.cloneNode(true) as HTMLElement
    const seen = new Map<string, Citation[]>()
    for (const c of citations) seen.set(c.key, [...(seen.get(c.key) ?? []), c])
    const cited = new Set<string>()
    decorateCitations(clone, (key, occurrence) => {
      cited.add(key)
      const citation = seen.get(key)?.[occurrence]
      return { id: citation?.id, verdict: citation?.verdict, n: numbers.get(key) ?? null }
    })
    if (!ownList) appendReferences(clone, bibEntries, numbers, cited)
    body.replaceChildren(clone)
    body.classList.toggle('ss-verdicts', verdictColors)
    body.setAttribute('aria-busy', String(rendering))
  }, [state.root, citations, bibEntries, numbers, ownList, verdictColors, rendering])

  useEffect(() => {
    page.current?.classList.toggle('ss-verdicts', verdictColors)
  }, [verdictColors])

  const close = useCallback(() => {
    setOpen((o) => {
      o?.trigger?.focus()
      return null
    })
  }, [])

  const current = open ? citations.find((c) => c.id === open.id) : undefined
  const currentIndex = current ? issues.findIndex((c) => c.id === current.id) : -1

  // Highlight the open issue's sentence.
  useEffect(() => {
    const body = page.current
    if (!body) return
    body.querySelectorAll('.ss-active').forEach((el) => el.classList.remove('ss-active'))
    if (open) body.querySelector(`.ss-sentence[data-id="${open.id}"]`)?.classList.add('ss-active')
  }, [open, state.root, citations])

  // One quiet line for everything the page is not showing as written.
  const notice = [
    prepared.ignored.length ? `Ignored in the preview (LaTeX still compiles them): ${prepared.ignored.join(', ')}` : '',
    state.unknown.length
      ? `Unknown to the preview, shown as grey boxes: ${state.unknown.map((u) => `${u.what} (line${u.lines.length === 1 ? '' : 's'} ${u.lines.join(', ')})`).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const next = () => {
    if (issues.length === 0) return
    const target = issues[(currentIndex + 1) % issues.length]
    openFor(target.id, null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-canvas px-3.5 py-2 text-xs">
        <span className="text-[12px] font-medium text-ink">Live preview</span>
        <span className="hidden text-ink-muted sm:inline">rendered with LaTeX.js · updates as you type</span>
        {rendering && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Rendering" />}
        <button type="button" onClick={onToggleVerdictColors} aria-pressed={verdictColors} className={`ml-auto rounded-sm px-1 text-accent ${HIGHLIGHT}`}>
          verdict colors {verdictColors ? 'on' : 'off'}
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="flex items-center gap-2 border-b border-insufficient bg-insufficient-soft px-3.5 py-1.5 text-xs text-insufficient">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {state.error.line ? `Line ${state.error.line}: ` : ''}
            {state.error.message}
            {state.root ? ' · showing the last good render' : ''}
          </span>
        </p>
      ) : (
        state.failures.length > 0 && (
          <p role="alert" className="flex items-center gap-2 border-b border-insufficient bg-insufficient-soft px-3.5 py-1.5 text-xs text-insufficient">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {state.failures.map((f) => `Line ${f.line}: ${f.message}`).join(' · ')} · {state.failures.length === 1 ? 'that part is' : 'those parts are'} left out, the rest
              of the page is shown
            </span>
          </p>
        )
      )}
      {notice && (
        <p data-testid="preview-ignored" className="flex items-center gap-2 border-b border-border-subtle bg-canvas px-3.5 py-1 text-caption text-ink-muted">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={notice}>
            {notice}
          </span>
        </p>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto p-4 sm:p-8">
        {!state.root && !state.error && <p className="text-center text-xs text-ink-muted">Rendering…</p>}
        <div
          ref={host}
          data-testid="preview-page"
          className={cn('mx-auto min-h-96 max-w-150 rounded-sm bg-surface px-10 py-12 shadow-md sm:px-14', !state.root && 'hidden')}
        />
        {open && current && (
          <IssuePopover
            citation={current}
            index={currentIndex}
            total={issues.length}
            anchor={open.anchor}
            containerWidth={open.containerWidth}
            numberOf={(key) => numbers.get(key) ?? null}
            onKeepMine={(note) => {
              onKeepMine(current, note)
              close()
            }}
            onAskToFix={
              onAskToFix &&
              (() => {
                onAskToFix(current)
                close()
              })
            }
            onNext={next}
            onClose={close}
          />
        )}
      </div>
    </div>
  )
}
