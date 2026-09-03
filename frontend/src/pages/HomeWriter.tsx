import { Link } from 'react-router-dom'

import { Badge } from '../components/Badge'
import { Sidebar } from '../components/Sidebar'
import { attentionRows, quickActions, recentPapers } from '../data/home'
import './HomeWriter.css'

export default function HomeWriter() {
  return (
    <div className="app" data-page="home">
      <Sidebar roleChange />

      <main className="main">
        <section className="greeting">
          <h1 className="greeting__title">Good morning, Wittawat</h1>
          <p className="greeting__subtitle">2 claims in your draft still point at sources that do not say that.</p>
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
            <p className="panel__meta">draft-v3.docx · checked 2h ago</p>
          </header>

          {attentionRows.map((row) => (
            <Link className="row" to="/draft-check" key={row.citation}>
              <Badge variant={row.badgeVariant}>{row.badgeLabel}</Badge>
              <p className="row__claim">{row.claim}</p>
              <p className="row__citation">{row.citation}</p>
              <img className="row__chevron" src="/icons/icon-chevron-right.svg" alt="Chevron right icon" />
            </Link>
          ))}
        </section>

        <section className="columns">
          <div className="recent">
            <p className="recent__title">Recent papers and drafts</p>

            {recentPapers.map((paper) => (
              <div className="recent__item" key={paper.name}>
                <img className="recent__icon" src="/icons/icon-file-text.svg" alt="File text icon" />
                <div className="recent__text">
                  <p className="recent__name">{paper.name}</p>
                  <p className="recent__meta">{paper.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
