/**
 * The labeler's bell: how the papers you added are doing. The count is the papers that finished
 * or failed since you last opened the panel; a spinner shows while any of yours is being read.
 * The data is the paper list's own poll (usePool), so the bell asks the gateway for nothing.
 */

import { Bell, CircleAlert, CircleCheck, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../../components/ui'
import { usePool, useRetryPaper, type Pool } from '../../../lib/labeling'

type Paper = Pool['papers'][number]
type Seen = Record<string, Paper['status']> // analysis id -> the status the viewer last saw

const SEEN_KEY = 'labeler.seenPapers'
const PANEL_WIDTH = 352 // px, 22rem
const READY_SHOWN = 8 // ready papers listed, new ones first; the paper table has the rest

const readSeen = (): Seen | null => {
  try {
    const stored = window.localStorage.getItem(SEEN_KEY)
    return stored ? (JSON.parse(stored) as Seen) : null
  } catch {
    return null
  }
}

const writeSeen = (seen: Seen) => {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {
    // not remembered: the count comes back after a reload
  }
}

export function PaperBell({ onOpen }: { onOpen: (analysisId: string) => void }) {
  const pool = usePool()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<Seen | null>(readSeen)
  const [place, setPlace] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const mine = (pool.data?.papers ?? []).filter((p) => p.mine)
  const reading = mine.filter((p) => p.status === 'running')
  const failed = mine.filter((p) => p.status === 'error')
  const ready = mine.filter((p) => p.status === 'done')
  const isNew = (p: Paper) => seen !== null && p.status !== 'running' && seen[p.analysis_id] !== p.status
  const unseen = mine.filter(isNew).length
  // What was new when the panel opened keeps its "New" tag while the panel stays open.
  const [newAtOpen, setNewAtOpen] = useState<Set<string>>(new Set())
  const wasNew = (p: Paper) => newAtOpen.has(p.analysis_id)

  const markSeen = () => {
    const next = Object.fromEntries(mine.map((p) => [p.analysis_id, p.status]))
    setSeen(next)
    writeSeen(next)
  }

  // Nothing stored yet (first visit, or storage blocked): what is there now counts as seen, so a
  // labeler with twenty finished papers does not start with a count of twenty.
  useEffect(() => {
    if (seen === null && pool.data) markSeen()
  })

  const toggle = () => {
    if (open) return setOpen(false)
    // Fixed, not inside the sidebar: the sidebar scrolls and would clip the panel.
    const rect = button.current!.getBoundingClientRect()
    setPlace({ top: rect.bottom + 8, left: Math.max(16, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 16)) })
    setNewAtOpen(new Set(mine.filter(isNew).map((p) => p.analysis_id)))
    setOpen(true)
    markSeen()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const openPaper = (id: string) => {
    setOpen(false)
    onOpen(id)
  }

  const label = [
    'Your papers',
    unseen > 0 && `${unseen} new`,
    reading.length > 0 && `${reading.length} being read`,
  ].filter(Boolean).join(', ')

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Your papers"
          style={{ top: place.top, left: place.left, width: PANEL_WIDTH }}
          // Below the toasts (sonner draws them on top of everything), so a toast stays readable.
          className="fixed z-30 flex max-h-[min(70vh,32rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
            <h2 className="text-sm font-semibold text-ink">Your papers</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-accent-soft hover:text-ink"
            >
              <X className="size-4" />
            </button>
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
        </div>
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
