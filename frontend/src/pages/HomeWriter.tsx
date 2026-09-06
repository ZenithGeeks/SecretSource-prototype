import { Link } from 'react-router-dom'

import { ClaimRow } from '../components/ClaimRow'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { HistoryItem } from '../components/HistoryItem'
import { LoadingState } from '../components/LoadingState'
import { Sidebar } from '../components/Sidebar'
import { quickActions } from '../data/home'
import { useWriterHome } from '../lib/useWriter'
import './HomeWriter.css'

export default function HomeWriter() {
  const home = useWriterHome()

  return (
    <div className="app" data-page="home">
      <Sidebar roleChange />

      <main className="main">
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
              {quickActions.map((action) =>
                action.to ? (
                  <Link className="actions__item" to={action.to} key={action.title}>
                    <img className="actions__icon" src={action.icon} alt={action.alt} />
                    <p className="actions__title">{action.title}</p>
                    <p className="actions__description">{action.description}</p>
                  </Link>
                ) : (
                  <a
                    className="actions__item"
                    href="#"
                    key={action.title}
                    onClick={(event) => event.preventDefault()}
                  >
                    <img className="actions__icon" src={action.icon} alt={action.alt} />
                    <p className="actions__title">{action.title}</p>
                    <p className="actions__description">{action.description}</p>
                  </a>
                ),
              )}
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
                home.data.attention.map((claim) => <ClaimRow claim={claim} to="/draft-check" key={claim.id} />)
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
      </main>
    </div>
  )
}
