/**
 * The labeler's bell: how the papers you added are doing. The count is the papers that finished
 * or failed since you last opened the panel; a spinner shows while any of yours is being read.
 * The data is the paper list's own poll (usePool), so the bell asks the gateway for nothing.
 */

import { Bell, CircleAlert, CircleCheck, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { Button, IconButton } from '../../../components/ui'
import { usePool, useRetryPaper, type Pool } from '../../../lib/labeling'

type Paper = Pool['papers'][number]
type Seen = Record<string, Paper['status']> // analysis id -> the status the viewer last saw

const PANEL_WIDTH = 352 // px, 22rem
const READY_SHOWN = 8 // ready papers listed, new ones first; the paper table has the rest

/** What the viewer has seen, shared by every bell on the page (the shell renders one in the
 * sidebar and one in the phone top bar) and kept in localStorage. When storage is blocked it
 * lives in memory for this page only. */
const seenStore = (() => {
  const KEY = 'labeler.seenPapers'
  const listeners = new Set<() => void>()
  let memory: Seen | null = null
  let parsed: { raw: string; seen: Seen | null } | null = null
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get(): Seen | null {
      let raw: string | null
      try {
        raw = window.localStorage.getItem(KEY)
      } catch {
        return memory
      }
      if (raw === null) return memory
      if (parsed?.raw !== raw) {
        let seen: Seen | null = null
        try {
          seen = JSON.parse(raw) as Seen
        } catch {
          // a broken value counts as nothing seen; the next write replaces it
        }
        parsed = { raw, seen }
      }
      return parsed.seen
    },
    set(seen: Seen) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(seen))
      } catch {
        memory = seen
      }
      listeners.forEach((listener) => listener())
    },
  }
})()

export function PaperBell({ onOpen }: { onOpen: (analysisId: string) => void }) {
  const pool = usePool()
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState({ top: 0, left: 0 })
  // What was new when the panel opened keeps its "New" tag while the panel stays open.
  const [newAtOpen, setNewAtOpen] = useState<Set<string>>(new Set())
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const mine = (pool.data?.papers ?? []).filter((p) => p.mine)
  const reading = mine.filter((p) => p.status === 'running')
  const failed = mine.filter((p) => p.status === 'error')
  const ready = mine.filter((p) => p.status === 'done')
  const isNew = (p: Paper) => seen !== null && p.status !== 'running' && seen[p.analysis_id] !== p.status
  const unseen = mine.filter(isNew).length
  const wasNew = (p: Paper) => newAtOpen.has(p.analysis_id)

  const markSeen = () => seenStore.set(Object.fromEntries(mine.map((p) => [p.analysis_id, p.status])))

  // Nothing stored yet (first visit): what is there now counts as seen, so a labeler with twenty
  // finished papers does not start with a count of twenty.
  useEffect(() => {
    if (seen === null && pool.data) markSeen()
  })

  // Closing also marks as seen what finished while the panel was open: it was on screen.
  const close = (refocus: boolean) => {
    setOpen(false)
    markSeen()
    if (refocus) button.current?.focus()
  }
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  const toggle = () => {
    if (open) return close(false)
    const rect = button.current!.getBoundingClientRect()
    setPlace({ top: rect.bottom + 8, left: Math.max(16, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 16)) })
    setNewAtOpen(new Set(mine.filter(isNew).map((p) => p.analysis_id)))
    setOpen(true)
    markSeen()
  }

  // The panel is placed once, under the bell, so anything that moves the bell closes it.
  useEffect(() => {
    if (!open) return
    heading.current?.focus()
    const inPanel = (node: EventTarget | null) => node instanceof Node && Boolean(panel.current?.contains(node))
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (inPanel(document.activeElement) || document.activeElement === button.current)) {
        closeRef.current(true)
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!inPanel(event.target) && !button.current?.contains(event.target as Node)) closeRef.current(false)
    }
    const onMove = (event: Event) => {
      if (!inPanel(event.target)) closeRef.current(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onMove)
    document.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const openPaper = (id: string) => {
    close(false)
    onOpen(id)
  }

  const label = [
    'Your papers',
    unseen > 0 && `${unseen} new`,
    reading.length > 0 && `${reading.length} being read`,
  ].filter(Boolean).join(', ')

  return (
    <>
      <IconButton
        ref={button}
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative size-10 lg:size-8"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unseen > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-refutes px-1 text-[10px] leading-4 font-semibold text-white tabular-nums"
          >
            {unseen}
          </span>
        )}
        {unseen === 0 && reading.length > 0 && (
          <Loader2 aria-hidden="true" className="absolute right-0.5 bottom-0.5 size-3 animate-spin text-accent motion-reduce:animate-none" />
        )}
      </IconButton>

      {/* In document.body: inside the sticky sidebar its z-index would only count within the
          sidebar, and the page content would paint over it. */}
      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Your papers"
          style={{ top: place.top, left: place.left, width: PANEL_WIDTH }}
          // Over the page (the sticky bars are z-30), below the toasts, which sonner draws on top.
          className="fixed z-40 flex max-h-[min(70vh,32rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
            <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold text-ink outline-none">
              Your papers
            </h2>
            <IconButton onClick={() => close(true)} aria-label="Close" className="size-8">
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="flex flex-col gap-4 overflow-y-auto p-4">
            {mine.length === 0 && (
              <p className="text-sm text-ink-muted">No papers of yours yet. Add one from Scopus on the paper list.</p>
            )}
            <Section title="Being read" papers={reading}>
              {() => (
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Reading the paper and its references
                </p>
              )}
            </Section>
            <Section title="Could not be read" papers={failed} isNew={wasNew}>
              {(p) => <FailedPaper paper={p} />}
            </Section>
            <Section title="Ready to label" papers={[...ready].sort((a, b) => Number(wasNew(b)) - Number(wasNew(a))).slice(0, READY_SHOWN)} isNew={wasNew}>
              {(p) => (
                <Button variant="ghost" className="min-h-9 self-start px-2 text-accent" onClick={() => openPaper(p.analysis_id)}>
                  <CircleCheck className="size-4" aria-hidden="true" />
                  Open
                </Button>
              )}
            </Section>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function Section({
  title,
  papers,
  isNew,
  children,
}: {
  title: string
  papers: Paper[]
  isNew?: (paper: Paper) => boolean
  children: (paper: Paper) => React.ReactNode
}) {
  if (papers.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="type-label text-ink-muted">
        {title} · {papers.length}
      </h3>
      <ul className="flex flex-col gap-2">
        {papers.map((p) => (
          <li key={p.analysis_id} className="flex flex-col gap-1 rounded-lg border border-border-subtle px-3 py-2">
            <p className="line-clamp-2 text-sm text-ink">
              {isNew?.(p) && <span className="mr-1.5 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent">New</span>}
              {p.title}
            </p>
            {children(p)}
          </li>
        ))}
      </ul>
    </section>
  )
}

function FailedPaper({ paper }: { paper: Paper }) {
  const retry = useRetryPaper()
  return (
    <>
      <p className="flex items-start gap-1.5 text-xs text-refutes">
        <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        {paper.reason || 'The analysis stopped.'}
      </p>
      <Button
        variant="ghost"
        className="min-h-9 self-start px-2"
        aria-label={`${retry.isPending ? 'Starting' : 'Try again'} ${paper.title}`}
        disabled={retry.isPending}
        onClick={() => retry.mutate(paper.analysis_id)}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        {retry.isPending ? 'Starting…' : 'Try again'}
      </Button>
    </>
  )
}
