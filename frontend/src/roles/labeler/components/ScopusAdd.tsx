/** Find papers in Scopus by topic and add them to the labeling list. */

import { Loader2, Plus, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button, Card, Input } from '../../../components/ui'
import { problem, TOPIC_INFO, useScopusAdd, useScopusSearch, type Pool } from '../../../lib/labeling'
import { TopicSelect } from './TopicSelect'

const THIS_YEAR = new Date().getFullYear()

export function ScopusAdd({ pool, myTopic }: { pool: Pool; myTopic: string }) {
  const [topic, setTopic] = useState(myTopic)
  const [text, setText] = useState('')
  const [since, setSince] = useState(2020)
  const [added, setAdded] = useState<Record<string, true>>({})
  const search = useScopusSearch()
  const add = useScopusAdd()

  const run = (event: FormEvent) => {
    event.preventDefault()
    if (topic) search.mutate({ topic, q: text, since })
  }
  const results = search.data?.results

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Add papers from Scopus</h2>
        <p className="text-xs text-ink-muted">
          Open-access papers from the topic's conferences and journals
          {topic && TOPIC_INFO[topic] ? ` (${TOPIC_INFO[topic].venues}; ${TOPIC_INFO[topic].journal})` : ''}.
        </p>
      </div>
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Topic
          <TopicSelect label="Topic to search" value={topic} topics={pool.topics} empty="Pick a topic" onChange={setTopic} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-ink">
          Words in the title or abstract (optional)
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} className="min-h-11" />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs font-medium text-ink">
          Since
          <Input
            type="number"
            min={1990}
            max={THIS_YEAR}
            value={since}
            onChange={(e) => setSince(Number(e.target.value) || 2020)}
            className="min-h-11"
          />
        </label>
        <Button type="submit" disabled={!topic || search.isPending} className="min-h-11">
          {search.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search Scopus
        </Button>
      </form>

      {search.isError && (
        <p role="alert" className="text-sm text-refutes">
          {problem(search.error).title}. {problem(search.error).hint}
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-sm text-refutes">
          {problem(add.error).title}. {problem(add.error).hint}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="text-sm text-ink-muted">Scopus found no open-access papers for that. Try other words or an earlier year.</p>
      )}
      {results && results.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle" aria-label="Scopus results">
          {results.map((paper) => {
            const done = paper.added || added[paper.doi]
            // false: the only copy is on a site that refuses scripts, so the paper could never be read.
            // null: it could not be checked, so adding stays allowed.
            if (paper.downloadable === false && !done) {
              return (
                <li key={paper.doi} className="flex items-center justify-between gap-3 py-2.5 opacity-60">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{paper.title}</span>
                    <span className="block truncate text-xs text-ink-muted">{[paper.venue, paper.year].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">No copy we can download</span>
                </li>
              )
            }
            return (
              <li key={paper.doi} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{paper.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[paper.venue, paper.year, paper.first_author, paper.cited_by ? `cited ${paper.cited_by}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  className="shrink-0"
                  disabled={Boolean(done) || add.isPending}
                  aria-label={`Add ${paper.title}`}
                  onClick={() => add.mutate({ doi: paper.doi, topic }, { onSuccess: () => setAdded((all) => ({ ...all, [paper.doi]: true })) })}
                >
                  {done ? 'Added' : <><Plus className="size-4" />Add</>}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
