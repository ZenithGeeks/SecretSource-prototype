/**
 * A paper in the browser, opened at the place a claim or a passage came from.
 *
 * The PDF is drawn by pdf.js (react-pdf), not shown as a picture from the gateway. Pages are
 * drawn at screen resolution at every zoom level, the text can be selected, and the PDF's
 * own links work. The highlight and the citation markers are drawn on top of their page.
 */

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import '../styles/pdf-annotation-layer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { API_BASE, type Citation, type CitationMarker, type Source, type Verdict } from '../lib/api'
import { citationLink, reference } from '../lib/citations'
import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'
import { Button } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
// One worker for every PDF on the page. With only workerSrc, pdf.js starts a worker (about 1 MB
// of code) per document, and the labeler shows two documents at once. It is passed to each
// Document as `worker`, not set as GlobalWorkerOptions.workerPort: with workerPort every loading
// task owns the same cached worker, so closing one PDF destroys it under a PDF still loading.
// pdf.js never destroys a worker it was given. Tests run in jsdom, which has no Worker, so there
// pdf.js keeps the per-document default.
const DOCUMENT_OPTIONS =
  typeof Worker === 'undefined'
    ? undefined
    : { worker: pdfjs.PDFWorker.create({ port: new Worker(workerUrl, { type: 'module' }) }) }

export type Target = {
  paper: string // file name, e.g. "colbertv2.pdf"
  label: string // what the reader clicked, shown above the page
  detail?: string // a second line before the file name, e.g. the authors and year
  quote?: string // the text being pointed at, if there is one to show
  source: Source | null // null when it could not be located: the page shows unmarked
  verdict?: Verdict['verdict'] // colors a located passage by the result it represents
  page?: number // fall back to this when there is no source to take a page from
  error?: string // a lookup failure that should remain distinct from an unlocated passage
  section?: string // the analysed paper's section this points into, for the table of contents
  paperRole?: PaperRole // which of two papers on screen this is: a strip at the top says so (labeler)
}

export type PaperRole = 'under-review' | 'reference'

const ZOOMS = [1, 1.25, 1.5, 2, 3] // 1 = fit the panel; beyond that the panel scrolls
const COMPACT_TOOLBAR_BELOW = 420 // px of panel; narrower than this the full toolbar does not fit
const PAGE_GAP = 16 // px between pages, and around them
const TOOLBAR_HEIGHT = 48 // px; the translucent toolbar floats over the top of the scrolling page
const RENDERED_AROUND = 2 // pages drawn on each side of the one in view; the rest are placeholders
const MAX_PAGE_WIDTH = 2400 // css px; wider than this only costs memory
const MAX_CANVAS_WIDTH = 4096 // device px; a canvas this wide is already sharp at any zoom here

type Box = { x0: number; y0: number; x1: number; y1: number }

/** Boxes arrive in PDF points; percentages keep them right at any rendered size. */
function boxStyle(box: Box, width: number, height: number) {
  return {
    left: `${(box.x0 / width) * 100}%`,
    top: `${(box.y0 / height) * 100}%`,
    width: `${((box.x1 - box.x0) / width) * 100}%`,
    height: `${((box.y1 - box.y0) / height) * 100}%`,
  }
}

/** pdf.js draws a PDF's links as empty boxes over the text; give each one a name to read out. */
function nameLinks(viewer: HTMLElement) {
  for (const link of viewer.querySelectorAll<HTMLAnchorElement>('.annotationLayer a:not([aria-label])')) {
    const href = link.getAttribute('href') ?? ''
    const inPaper = !href || href.startsWith('#')
    link.setAttribute('aria-label', link.title || (inPaper ? 'Go to a place in this paper' : `Open ${href}`))
  }
}

const VERDICT_HIGHLIGHT = {
  supports: 'bg-supports/20 ring-supports/70',
  refutes: 'bg-refutes/20 ring-refutes/70',
  insufficient: 'bg-insufficient/20 ring-insufficient/70',
} as const

function Highlight({ box, source, verdict }: { box: Box; source: Source; verdict?: Verdict['verdict'] }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-10 rounded-xs ring-2',
        verdict ? VERDICT_HIGHLIGHT[verdict] : 'bg-accent/20 ring-accent/70',
      )}
      style={boxStyle(box, source.page_width, source.page_height)}
    />
  )
}

/** The reference a clicked citation marker points to, next to the marker. */
function ReferencePopover({ marker, citation }: { marker: CitationMarker; citation: Citation }) {
  const link = citationLink(citation)
  const left = Math.min((marker.x0 / marker.page_width) * 100, 50)
  // Near the bottom of the page, open upwards so the card stays on the page.
  const below = marker.y1 / marker.page_height < 0.75
  return (
    <div
      role="dialog"
      aria-label="Cited paper"
      className="absolute z-20 w-72 max-w-[90%] space-y-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 shadow-lg"
      style={
        below
          ? { left: `${left}%`, top: `calc(${(marker.y1 / marker.page_height) * 100}% + 6px)` }
          : { left: `${left}%`, bottom: `calc(${(1 - marker.y0 / marker.page_height) * 100}% + 6px)` }
      }
    >
      <p className="text-[11px] leading-4 font-semibold tracking-wide text-ink-muted uppercase">
        Cited paper{marker.text ? ` · ${marker.text}` : ''}
      </p>
      <p className="text-[13px] leading-[18px] text-ink">{reference(citation)}</p>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Open the paper
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="size-10 px-0" // 40px: a real touch target, not a 24px icon
    >
      {children}
    </Button>
  )
}

/** True below the xl breakpoint, where AnalysisView stacks the viewer under the claims. */
function useNarrowScreen() {
  const query = '(max-width: 1279px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return narrow
}
/** The zoom kept under `key`, when it is still one of the steps. */
function storedZoom(key: string | undefined) {
  if (!key) return 1
  try {
    const zoom = Number(window.localStorage.getItem(key))
    return ZOOMS.includes(zoom) ? zoom : 1
  } catch {
    return 1
  }
}

function targetPage(target: Target) {
  return target.source?.page ?? target.page ?? 1
}

export function PageViewer({
  target,
  onClose,
  markers = [],
  references = {},
  className,
  keyboard = true,
  onSelectText,
  compactQuote = false,
  zoomKey,
  onCitation,
  toolbarLead,
  embedded = false,
}: {
  target: Target
  /** Without it there is no close button: the viewer is part of the page, not a panel over it. */
  onClose?: () => void
  /** Height of the side panel, instead of the full-height default. */
  className?: string
  /** Escape and the arrow keys act on this viewer. Off when two are on screen at once. */
  keyboard?: boolean
  /** Quoted passage as two lines (full text on hover), so the page gets the height. */
  compactQuote?: boolean
  /** Remember the zoom under this localStorage key, so it survives opening another paper. */
  zoomKey?: string
  /** Called when the reader selects text in a page: the text, whitespace squeezed, and its page. */
  onSelectText?: (selection: { text: string; page: number | null }) => void
  /** Citation markers of this paper. Only passed when the viewer shows the analysed paper. */
  markers?: CitationMarker[]
  references?: Record<string, Citation>
  /** Called when a citation marker is clicked, in place of the card that names the paper. */
  onCitation?: (marker: CitationMarker) => void
  /** Extra control placed inside the viewer toolbar (for example the labeler's reference picker). */
  toolbarLead?: React.ReactNode
  /** The caller provides a pane even below xl; keep the viewer in it until expanded. */
  embedded?: boolean
}) {
  const [pageCount, setPageCount] = useState(0)
  const [pageRatio, setPageRatio] = useState(1.294) // height / width; US Letter until page 1 says
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(targetPage(target))
  // Which pages to draw leads `page` by `rootMargin` (see the observer below), so a page is
  // never blank when the reader actually scrolls onto it — only `page` itself (the toolbar's
  // count, and where the arrow keys and zoom return to) must stay exact.
  const [leadPage, setLeadPage] = useState(targetPage(target))
  const [zoom, setZoomState] = useState(() => storedZoom(zoomKey))
  const setZoom = (next: number) => {
    setZoomState(next)
    if (!zoomKey) return
    try {
      window.localStorage.setItem(zoomKey, String(next))
    } catch {
      // the zoom just is not remembered
    }
  }
  const [expanded, setExpanded] = useState(false)
  // Below xl there is no column beside the claims, so the viewer would open under all of them.
  // It opens over the whole screen instead.
  const narrowScreen = useNarrowScreen()
  const narrow = narrowScreen && !embedded
  const fullScreen = narrow || expanded
  const [panelWidth, setPanelWidth] = useState(0)
  const [opened, setOpened] = useState<{ marker: CitationMarker; target: Target } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pageNodes = useRef(new Map<number, HTMLDivElement>())
  const pageInView = useRef(page) // for effects that must not re-run on every scroll

  const reportSelection = () => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!onSelectText || !selection || selection.isCollapsed || !node || !scroller.current?.contains(node)) return
    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (!text) return
    const element = node instanceof Element ? node : node.parentElement
    onSelectText({ text, page: Number(element?.closest('[data-page]')?.getAttribute('data-page')) || null })
  }

  const pageWidth = Math.min(Math.max(0, panelWidth - 2 * PAGE_GAP) * zoom, MAX_PAGE_WIDTH)
  // Sharp on high-density screens, but capped: a 3x zoom on a 4K screen would otherwise ask
  // for canvases of hundreds of megabytes.
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_WIDTH / Math.max(pageWidth, 1))

  // The page is as wide as the panel, so it follows the panel's size (and the expand button).
  useEffect(() => {
    const node = scroller.current
    /* v8 ignore next -- the scroller is always mounted when effects run; this satisfies the type */
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Name the PDF's links as pdf.js adds them. react-pdf's onRenderAnnotationLayerSuccess fires
  // before pdf.js has drawn them, so it cannot be used for this.
  useEffect(() => {
    const node = scroller.current
    /* v8 ignore next -- the scroller is always mounted when effects run; this satisfies the type */
    if (!node) return
    const observer = new MutationObserver(() => nameLinks(node))
    observer.observe(node, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  /** Scroll so page `number` is in view; with a box, so that box is. */
  const scrollToPage = useCallback((number: number, box?: Box, size?: Source) => {
    const node = pageNodes.current.get(number)
    const container = scroller.current
    if (!node || !container) return
    const inside = box && size ? (box.y0 / size.page_height) * node.offsetHeight - 80 : -PAGE_GAP
    container.scrollTo({ top: node.offsetTop + Math.max(0, inside) - PAGE_GAP - TOOLBAR_HEIGHT })
    pageInView.current = number
    setPage(number)
  }, [])

  // A new target opens at its page and its highlight. The viewer is remounted for another
  // paper (AnalysisView keys it by paper), so zoom only resets then: comparing two claims in
  // the same paper keeps the reader's zoom level.
  const ready = pageCount > 0 && panelWidth > 0
  useEffect(() => {
    if (ready) scrollToPage(targetPage(target), target.source?.boxes[0], target.source ?? undefined)
  }, [target, ready, scrollToPage])

  // Zooming keeps the reader on the page they were reading.
  useEffect(() => {
    if (ready) scrollToPage(pageInView.current)
  }, [zoom, ready, scrollToPage])

  // The page counter follows the scroll, exactly: widening this observer's own root would
  // count a page not yet on screen as "in view" and move the counter (and the arrow keys,
  // and where zooming returns to) ahead of what the reader is actually looking at.
  useEffect(() => {
    const container = scroller.current
    if (!container || !pageCount) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const number = Number(visible?.target.getAttribute('data-page'))
        if (number) {
          pageInView.current = number
          setPage(number)
        }
      },
      { root: container, threshold: [0.25, 0.5, 0.75] },
    )
    pageNodes.current.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [pageCount])

  // A separate observer, its root widened by `rootMargin`, only decides which pages to draw
  // (see `drawn` below) — never the page count. It counts a page "in view" half a panel early,
  // so the pages around it are drawn before the reader scrolls onto them, not after: without
  // this the blank placeholder of an undrawn page flashed into view first and only then filled in.
  useEffect(() => {
    const container = scroller.current
    if (!container || !pageCount) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const number = Number(visible?.target.getAttribute('data-page'))
        if (number) setLeadPage(number)
      },
      { root: container, rootMargin: '50% 0px', threshold: [0.25, 0.5, 0.75] },
    )
    pageNodes.current.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [pageCount])

  // Escape closes an open reference first, then the full-window view, then the viewer.
  // Arrows page, unless the reader is typing somewhere.
  useEffect(() => {
    if (!keyboard) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') {
        if (opened) setOpened(null)
        else if (expanded && !narrow) setExpanded(false)
        else onClose?.()
      }
      if (event.key === 'ArrowLeft') scrollToPage(Math.max(1, page - 1))
      if (event.key === 'ArrowRight') scrollToPage(Math.min(pageCount || page, page + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, onClose, opened, expanded, narrow, page, pageCount, scrollToPage])

  const zoomIndex = ZOOMS.indexOf(zoom)
  const compactToolbar = panelWidth > 0 && panelWidth < COMPACT_TOOLBAR_BELOW
  const openMarker = opened && opened.target === target ? opened.marker : null
  const highlightPage = target.source ? target.source.page : null
  // The gateway serves a paper only with the user's token, so pdf.js and the links below
  // get an in-memory copy fetched with it (#135).
  const pdf = useAuthorizedUrl(`${API_BASE}/api/papers/${encodeURIComponent(target.paper)}`)
  const cannotOpen = failed || pdf.failed

  // A paper shown as a role (the claim's paper, a cited reference) names itself in the
  // toolbar row instead of a header line of its own: one row less above the page.
  const roleTitle = target.paperRole ? (
    <h2
      title={target.quote ? `${target.label} — “${target.quote}”` : target.label}
      className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-ink"
    >
      <span className="sr-only">{target.paperRole === 'under-review' ? 'Paper under review: ' : 'Cited reference: '}</span>
      {target.paperRole === 'under-review' ? 'Paper: ' : ''}
      {target.label}
      {target.detail && <span className="font-normal text-ink-muted"> · {target.detail}</span>}
      <span className="font-normal text-ink-muted"> · p.{targetPage(target)}</span>
      {target.quote && (
        <span className="font-serif font-normal italic text-ink-muted"> · “{target.quote}”</span>
      )}
      {!target.error && !target.source && target.quote && (
        <span className="font-normal text-ink-muted"> · exact place not found</span>
      )}
    </h2>
  ) : null
  const frameButtons = (
    <div className="flex shrink-0 items-center">
      {!narrow && (
        <IconButton
          label={expanded ? 'Back to the side panel' : 'Fill the window'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </IconButton>
      )}
      {onClose && (
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      )}
    </div>
  )

  return (
    <>
      {expanded && !narrow && (
        <div className="fixed inset-0 z-40 bg-ink/30" onClick={() => setExpanded(false)} aria-hidden />
      )}
      <aside
        aria-label={`${target.paper}, page ${page}`}
        className={cn(
          'flex flex-col overflow-hidden border-border-subtle bg-surface',
          target.paperRole ? 'gap-0' : 'gap-3',
          narrow
            ? cn('fixed inset-0 z-50', !target.paperRole && 'p-3')
            : cn(
                'rounded-xl border',
                !target.paperRole && 'p-4',
                fullScreen ? 'fixed inset-4 z-50 shadow-2xl' : (className ?? 'h-[calc(100vh-3rem)]'),
              ),
        )}
      >
        {target.paperRole ? null : (
          <>
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* h2, so the "Quoted passage" h3 below sits under a heading of its own. */}
                <h2 title={target.label} className="truncate text-sm font-medium">{target.label}</h2>
                <p className="truncate text-xs text-ink-muted">
                  {target.detail && `${target.detail} · `}
                  {target.paper}
                  {/* Only when there was a passage to find: opening the paper itself has none. */}
                  {!target.error && !target.source && target.quote && ' · exact place not found, showing the page'}
                </p>
              </div>
              {frameButtons}
            </header>

            {target.quote && (
              <div
                className={cn(
                  'shrink-0 rounded-xl bg-neutral-soft px-3.5',
                  compactQuote ? 'space-y-0.5 py-2' : 'max-h-32 space-y-1.5 overflow-y-auto py-3',
                )}
              >
                <h3 className="type-label text-ink-muted">Quoted passage · page {targetPage(target)}</h3>
                <blockquote
                  title={compactQuote ? target.quote : undefined}
                  className={cn(
                    'font-serif italic text-ink',
                    compactQuote ? 'line-clamp-2 text-[13px] leading-5' : 'text-[15px] leading-[22px]',
                  )}
                >
                  “{target.quote}”
                </blockquote>
              </div>
            )}
          </>
        )}

        {target.error && (
          <p role="alert" className={cn('bg-refutes-soft px-3 py-2 text-sm leading-5 text-refutes', target.paperRole ? 'border-b border-border-subtle' : 'rounded-lg')}>
            {target.error}
          </p>
        )}

        <div className={cn('relative min-h-0 flex-1 overflow-hidden bg-canvas', !target.paperRole && 'rounded-lg border border-border-subtle')}>
          <div
            role="toolbar"
            aria-label="Page controls"
            className="absolute inset-x-0 top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-border-subtle bg-surface/80 px-2 backdrop-blur-md"
            style={{ height: TOOLBAR_HEIGHT }}
          >
            <IconButton label="Previous page" onClick={() => scrollToPage(Math.max(1, page - 1))} disabled={page <= 1}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span
              className={cn(
                'text-center font-mono text-[13px] whitespace-nowrap text-ink-muted tabular-nums',
                compactToolbar ? 'min-w-12' : 'min-w-24',
              )}
              aria-live="polite"
            >
              {compactToolbar ? page : `Page ${page}`}
              {pageCount ? (compactToolbar ? `/${pageCount}` : ` of ${pageCount}`) : ''}
            </span>
            <IconButton
              label="Next page"
              onClick={() => scrollToPage(Math.min(pageCount, page + 1))}
              disabled={!pageCount || page >= pageCount}
            >
              <ChevronRight className="size-4" />
            </IconButton>
            {toolbarLead && <div className="min-w-0 max-w-56 flex-1">{toolbarLead}</div>}
            {roleTitle ?? <span className="flex-1" />}
            <IconButton
              label="Zoom out"
              onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
              disabled={zoomIndex <= 0}
            >
              <ZoomOut className="size-4" />
            </IconButton>
            <span className="min-w-10 text-center text-[13px] text-ink-muted tabular-nums">{zoom === 1 ? 'fit' : `${zoom}×`}</span>
            <IconButton
              label="Zoom in"
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
              disabled={zoomIndex >= ZOOMS.length - 1}
            >
              <ZoomIn className="size-4" />
            </IconButton>
            {!compactToolbar && (
              <IconButton label="Fit to view" onClick={() => setZoom(1)} disabled={zoom === 1}>
                <Scan className="size-4" />
              </IconButton>
            )}
            {pdf.url && (
              <a
                href={pdf.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open original PDF"
                title="Open original PDF"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
            {target.paperRole && frameButtons}
          </div>
          <div
            ref={scroller}
            onMouseUp={reportSelection}
            onKeyUp={reportSelection}
            onTouchEnd={reportSelection}
            className="h-full overflow-auto"
            style={{ paddingTop: TOOLBAR_HEIGHT }}
          >
          {panelWidth > 0 && !pdf.url && !pdf.failed && (
            <p className="flex items-center gap-2 p-4 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" />
              Opening the paper…
            </p>
          )}
          {panelWidth > 0 && pdf.url && (
            <Document
              file={pdf.url}
              options={DOCUMENT_OPTIONS}
              externalLinkTarget="_blank"
              onLoadSuccess={async (pdf) => {
                const first = await pdf.getPage(1)
                const { width, height } = first.getViewport({ scale: 1 })
                setPageRatio(height / width)
                setPageCount(pdf.numPages)
              }}
              onLoadError={() => setFailed(true)}
              // A link inside the PDF, like a reference number, jumps to its page.
              onItemClick={({ pageNumber }) => scrollToPage(pageNumber)}
              loading={
                <p className="flex items-center gap-2 p-4 text-sm text-ink-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Opening the paper…
                </p>
              }
              error={
                <p className="p-4 text-sm text-ink-muted">
                  This PDF could not be shown here. Open the original PDF instead.
                </p>
              }
              className="flex min-w-max flex-col items-center pb-4"
            >
              {Array.from({ length: pageCount }, (_, index) => {
                const number = index + 1
                // Drawing every page of a long paper at high resolution costs a lot of memory,
                // so only the pages near the one in view are drawn.
                const around = zoom > 1 ? 1 : RENDERED_AROUND
                const drawn =
                  Math.abs(number - page) <= around || Math.abs(number - leadPage) <= around || number === targetPage(target)
                const pageMarkers = markers.filter((marker) => marker.page === number && references[marker.ref])
                return (
                  <div key={number} style={{ padding: `${PAGE_GAP}px ${PAGE_GAP}px 0` }}>
                    <div
                      ref={(node) => {
                        if (node) pageNodes.current.set(number, node)
                        else pageNodes.current.delete(number)
                      }}
                      data-page={number}
                      className="relative bg-white shadow-sm"
                      style={{ width: pageWidth, minHeight: drawn ? undefined : pageWidth * pageRatio }}
                    >
                      {drawn && (
                        <Page
                          pageNumber={number}
                          width={pageWidth}
                          devicePixelRatio={pixelRatio}
                          renderTextLayer
                          renderAnnotationLayer
                          loading={<div style={{ height: pageWidth * pageRatio }} />}
                        />
                      )}
                      {number === highlightPage &&
                        target.source?.boxes.map((box, i) => (
                          <Highlight key={i} box={box} source={target.source as Source} verdict={target.verdict} />
                        ))}
                      {pageMarkers.map((marker, i) => (
                        <button
                          key={`marker-${i}`}
                          type="button"
                          onClick={() => (onCitation ? onCitation(marker) : setOpened(marker === openMarker ? null : { marker, target }))}
                          aria-label={`Cited paper ${marker.text}: ${reference(references[marker.ref])}`}
                          aria-expanded={marker === openMarker}
                          className={cn(
                            'absolute z-10 rounded-xs ring-1 ring-accent/50 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent',
                            marker === openMarker ? 'bg-accent/20 ring-2 ring-accent' : 'bg-accent/5',
                          )}
                          style={boxStyle(marker, marker.page_width, marker.page_height)}
                        />
                      ))}
                      {openMarker?.page === number && references[openMarker.ref] && (
                        <ReferencePopover marker={openMarker} citation={references[openMarker.ref]} />
                      )}
                    </div>
                  </div>
                )
              })}
            </Document>
          )}
          {cannotOpen && pdf.url && (
            <a href={pdf.url} target="_blank" rel="noreferrer" className="block px-4 text-sm text-accent hover:underline">
              Original PDF
            </a>
          )}
          {pdf.failed && <p className="p-4 text-sm text-ink-muted">This paper could not be opened. Its PDF may not be on the server yet: upload it again from Analyses.</p>}
          </div>
        </div>
      </aside>
    </>
  )
}
