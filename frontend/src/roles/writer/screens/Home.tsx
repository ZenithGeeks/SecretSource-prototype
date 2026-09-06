/** Writer Home — greeting, quick actions, needs-attention list, recent papers. Data comes
 * from useWriterHome (mock-backed until the gateway endpoint exists); `onOpenDraftCheck`
 * and `onOpenFindSource` move to the other writer screens. */

import { ClaimRow } from '../../../components/ClaimRow'
import { EmptyState } from '../../../components/EmptyState'
import { ErrorState } from '../../../components/ErrorState'
import { HistoryItem } from '../../../components/HistoryItem'
import { LoadingState } from '../../../components/LoadingState'
import { useWriterHome } from '../../../lib/useWriter'
import './Home.css'

const QUICK_ACTIONS = [
  {
    icon: '/icons/icon-pen.svg',
    alt: 'Pen icon',
    title: 'Check a draft',
    description: 'Paste text, every citation gets a verdict',
    action: 'draft-check' as const,
  },
  {
    icon: '/icons/icon-search-accent.svg',
    alt: 'Search icon',
    title: 'Find a source for…',
    description: 'Search your library by meaning',
    action: 'find-source' as const,
  },
  {
    icon: '/icons/icon-list-checks.svg',
    alt: 'Checklist icon',
    title: 'Fix reference list',
    description: 'From a checked draft, with corrected sources',
    action: null,
  },
]

export function Home({
  onOpenDraftCheck,
  onOpenFindSource,
}: {
  onOpenDraftCheck: () => void
  onOpenFindSource: () => void
}) {
  const home = useWriterHome()

  const open = (action: 'draft-check' | 'find-source' | null) => {
    if (action === 'draft-check') onOpenDraftCheck()
    if (action === 'find-source') onOpenFindSource()
  }

  return (
    <>
      {home.isPending && <LoadingState label="Loading your workspace…" />}

      {home.isError && (
        <ErrorState message={(home.error as Error).message} onRetry={() => window.location.reload()} />
      )}

      {home.data && (
        <>
          <section className="greeting">
            <h1 className="greeting__title">Good morning, {home.data.user}</h1>
            <p className="greeting__subtitle">{home.data.alert}</p>
          </section>

          <section className="actions">
            {QUICK_ACTIONS.map((action) => (
              <button className="actions__item" type="button" key={action.title} onClick={() => open(action.action)}>
                <img className="actions__icon" src={action.icon} alt={action.alt} />
                <p className="actions__title">{action.title}</p>
                <p className="actions__description">{action.description}</p>
              </button>
            ))}
          </section>

          <section className="panel">
            <header className="panel__head">
              <p className="panel__title">Needs your attention</p>
              <p className="panel__meta">
                {home.data.draftFileName} · {home.data.draftLastCheckedLabel}
              </p>
            </header>

            {home.data.attention.length === 0 ? (
              <div className="panel__empty">
                <EmptyState title="Nothing needs your attention" hint="Every checked citation in this draft holds up." />
              </div>
            ) : (
              home.data.attention.map((claim) => (
                <ClaimRow claim={claim} onClick={onOpenDraftCheck} key={claim.id} />
              ))
            )}
          </section>

          <section className="columns">
            <div className="recent">
              <p className="recent__title">Recent papers and drafts</p>

              {home.data.recentPapers.length === 0 ? (
                <EmptyState title="No papers yet" hint="Check a draft or add a paper to see it here." />
              ) : (
                home.data.recentPapers.map((paper) => <HistoryItem paper={paper} key={paper.id} />)
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}
