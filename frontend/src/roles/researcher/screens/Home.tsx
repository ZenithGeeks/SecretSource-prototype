/**
 * 09 Home (Researcher) — greeting, quick actions, conflicts, reading queue, library
 * summary. Data comes from useResearcherHome (mock-backed until the gateway endpoint
 * exists); `onOpen` navigates to another researcher screen. Analyze a paper opens History,
 * the one screen wired to the gateway.
 */

import { FileSearch, FileText, Library, Plus, Search, Waypoints } from 'lucide-react'
import type { ComponentType } from 'react'

import { Card } from '../../../components/ui'
import type { ClaimStanding, ClaimTally } from '../../../lib/researcher'
import { useResearcherHome } from '../../../lib/useResearcher'
import { cn } from '../../../lib/utils'
import type { ResearcherScreen } from '../ResearcherApp'

type Icon = ComponentType<{ className?: string }>

const QUICK_ACTIONS: { title: string; hint: string; icon: Icon; to: ResearcherScreen }[] = [
  // The one action that reaches the working gateway today; the flow lives on History.
  { title: 'Analyze a paper', hint: 'DOI, arXiv ID, URL, or a PDF you upload', icon: FileSearch, to: 'history' },
  { title: 'Map my field', hint: 'Cluster library by meaning, see who agrees', icon: Waypoints, to: 'graph' },
  { title: 'What does the field say about…', hint: "One claim, every paper's answer", icon: Search, to: 'field-consensus' },
  { title: 'Add papers', hint: 'DOI, arXiv, PDF, or a whole bibliography', icon: Library, to: 'library' },
]

/** Display order and colour for the library tally; the bar and legend both follow it. */
const STANDINGS: { key: ClaimStanding; color: string }[] = [
  { key: 'backed', color: 'bg-supports' },
  { key: 'silent', color: 'bg-insufficient' },
  { key: 'contradicted', color: 'bg-refutes' },
  { key: 'unchecked', color: 'bg-ink-muted' },
]

function TallyBar({ tally }: { tally: ClaimTally }) {
  return (
    <>
      <div className="mt-2.5 flex h-2 w-full gap-0.5 overflow-hidden rounded">
        {STANDINGS.map(({ key, color }) => (
          <span key={key} className={cn('h-full rounded-sm', color)} style={{ flexGrow: tally[key] }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4">
        {STANDINGS.map(({ key, color }) => (
          <span key={key} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className={cn('size-2 rounded-full', color)} />
            {tally[key]} {key}
          </span>
        ))}
      </div>
    </>
  )
}

export function Home({ onOpen }: { onOpen: (screen: ResearcherScreen) => void }) {
  const home = useResearcherHome().data
  if (!home) return null

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">
          Good morning, {home.user}
        </h1>
        <p className="text-sm text-ink-muted">{home.alert}</p>
      </header>

      {/* Quick actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {QUICK_ACTIONS.map(({ title, hint, icon: Icon, to }) => (
          <button
            key={title}
            type="button"
            onClick={() => onOpen(to)}
            className="flex flex-1 flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent"
          >
            <Icon className="size-4 text-accent" />
            <p className="text-sm font-medium text-ink">{title}</p>
            <p className="text-xs text-ink-muted">{hint}</p>
          </button>
        ))}
      </div>

      {/* Conflicts + Reading queue */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <Card className="flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Conflicts in your library</h2>
            <button type="button" onClick={() => onOpen('field-consensus')} className="text-xs text-accent hover:underline">
              see all
            </button>
          </div>
          <ul>
            {home.conflicts.map((c) => (
              <li key={c.claim} className="border-t border-border-subtle first:mt-2">
                <button
                  type="button"
                  onClick={() => onOpen('field-consensus')}
                  className="flex w-full flex-col gap-1 py-2 text-left"
                >
                  <p className="text-sm text-ink">{c.claim}</p>
                  <span className="flex gap-3 text-xs">
                    <span className="flex gap-1">
                      <span className="font-medium text-supports">for</span>
                      <span className="text-ink-muted">{c.for.join(', ') || '—'}</span>
                    </span>
                    <span className="flex gap-1">
                      <span className="font-medium text-refutes">against</span>
                      <span className="text-ink-muted">{c.against.join(', ') || '—'}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Reading queue</h2>
            <span className="text-xs text-accent">{home.queue.length} papers</span>
          </div>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {home.queue.map((entry) => (
              <li key={entry.paper} className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{entry.paper}</p>
                  <p className="text-xs text-ink-muted">{entry.note}</p>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-accent-soft hover:text-ink"
                >
                  <Plus className="size-4" />
                  Add
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Library summary */}
      <button
        type="button"
        onClick={() => onOpen('library')}
        className="w-full rounded-xl border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Library</h2>
          <span className="text-xs text-accent">
            {home.library.papers} papers · {home.library.claims} claims · {home.library.verified} verified
          </span>
        </div>
        <TallyBar tally={home.library.tally} />
      </button>
    </>
  )
}
