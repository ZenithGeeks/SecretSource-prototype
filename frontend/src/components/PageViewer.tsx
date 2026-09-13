/** The page a claim or a passage came from, with the region it came from boxed on it. */

import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Citation, CitationMarker, Source } from '../lib/api'
import { pageImageUrl } from '../lib/api'
import { citationLink, reference } from '../lib/citations'
import { cn } from '../lib/utils'
import { Button } from './ui'

export type Target = {
  paper: string // file name, e.g. "colbertv2.pdf"
  label: string // what the reader clicked, shown above the page
  quote?: string // the text being pointed at, if there is one to show
  source: Source | null // null when it could not be located: the page shows unmarked
  page?: number // fall back to this when there is no source to take a page from
}

const ZOOMS = [1, 1.5, 2, 3] // 1 = fit the panel; beyond that the panel scrolls

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

function Highlight({ box, source }: { box: Box; source: Source }) {
  return (
    <div
      className="pointer-events-none absolute rounded-xs bg-accent/20 ring-2 ring-accent/70"
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
      className="absolute z-10 w-72 max-w-[90%] space-y-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 shadow-lg"
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
      className="size-11 px-0" // 44px: a real touch target, not a 24px icon
    >
      {children}
    </Button>
  )
}

export function PageViewer({
  target,
  onClose,
  markers = [],
  references = {},
}: {
  target: Target
  onClose: () => void
  /** Citation markers of this paper. Only passed when the viewer shows the analysed paper. */
  markers?: CitationMarker[]
  references?: Record<string, Citation>
}) {
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(target.source?.page ?? target.page ?? 1)
  const [zoom, setZoom] = useState(1)
  const [opened, setOpened] = useState<{ marker: CitationMarker; target: Target } | null>(null)
  const previousPaper = useRef(target.paper)

  // A new target updates the page to wherever it points; zoom only resets when it is a
  // different paper, so comparing two claims in the same paper keeps the reader's zoom level.
  useEffect(() => {
    setPage(target.source?.page ?? target.page ?? 1)
    if (previousPaper.current !== target.paper) setZoom(1)
    previousPaper.current = target.paper
  }, [target])

  // Only the page changes the image URL. Resetting on zoom would hide it forever:
  // the src is unchanged, so the browser fires no second load event.
  useEffect(() => setLoaded(false), [page])

  // Escape closes, arrows page: a reader checking a source should never feel trapped in it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape closes an open reference first, then the viewer.
      if (event.key === 'Escape') {
        if (opened) setOpened(null)
        else onClose()
      }
      if (event.key === 'ArrowLeft') setPage((n) => Math.max(1, n - 1))
      if (event.key === 'ArrowRight') setPage((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, opened])

  // Highlights belong to one page; paging away from it must not leave them behind.
  const onOriginalPage = page === (target.source?.page ?? target.page ?? 1)
  const zoomIndex = ZOOMS.indexOf(zoom)
  const pageMarkers = markers.filter((marker) => marker.page === page && references[marker.ref])
  // An open reference belongs to one marker on one page: paging away or a new target hides it.
  const openMarker =
    opened && opened.target === target && opened.marker.page === page ? opened.marker : null

  return (
    <aside
      aria-label={`${target.paper}, page ${page}`}
      className="flex h-[calc(100vh-3rem)] flex-col gap-3 overflow-hidden rounded-xl border border-border-subtle bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{target.label}</p>
          <p className="truncate text-xs text-ink-muted">
            {target.paper}
            {/* Only when there was a passage to find: opening the paper itself has none. */}
            {!target.source && target.quote && onOriginalPage && ' · exact place not found, showing the page'}
          </p>
        </div>
        <IconButton label="Close the page view" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      {target.quote && (
        <blockquote className="max-h-20 shrink-0 overflow-y-auto border-l-2 border-accent pl-3 text-sm italic text-ink-muted">
          “{target.quote}”
        </blockquote>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-border-subtle bg-canvas">
        {!loaded && (
          <p className="absolute inset-x-0 top-0 flex items-center gap-2 p-4 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            Rendering page {page}…
          </p>
        )}
        <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
          <img
            src={pageImageUrl(target.paper, page)}
            alt={`Page ${page} of ${target.paper}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={cn('w-full transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          />
          {loaded &&
            onOriginalPage &&
            target.source?.boxes.map((box, i) => (
              <Highlight key={i} box={box} source={target.source as Source} />
            ))}
          {loaded &&
            pageMarkers.map((marker, i) => (
              <button
                key={`marker-${i}`}
                type="button"
                onClick={() => setOpened(marker === openMarker ? null : { marker, target })}
                aria-label={`Cited paper ${marker.text}: ${reference(references[marker.ref])}`}
                aria-expanded={marker === openMarker}
                className={cn(
                  'absolute rounded-xs ring-1 ring-accent/50 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent',
                  marker === openMarker ? 'bg-accent/20 ring-2 ring-accent' : 'bg-accent/5',
                )}
                style={boxStyle(marker, marker.page_width, marker.page_height)}
              />
            ))}
          {loaded && openMarker && references[openMarker.ref] && (
            <ReferencePopover marker={openMarker} citation={references[openMarker.ref]} />
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous page"
            onClick={() => setPage((n) => Math.max(1, n - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="min-w-16 text-center text-sm tabular-nums" aria-live="polite">
            page {page}
          </span>
          <IconButton label="Next page" onClick={() => setPage((n) => n + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            label="Zoom out"
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
            disabled={zoomIndex <= 0}
          >
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="min-w-12 text-center text-sm tabular-nums">
            {zoom === 1 ? 'fit' : `${zoom}×`}
          </span>
          <IconButton
            label="Zoom in"
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
            disabled={zoomIndex >= ZOOMS.length - 1}
          >
            <ZoomIn className="size-4" />
          </IconButton>
          <a
            href={`/api/papers/${encodeURIComponent(target.paper)}`}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ExternalLink className="size-3.5" />
            Original PDF
          </a>
        </div>
      </footer>
    </aside>
  )
}
