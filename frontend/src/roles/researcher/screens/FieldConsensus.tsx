/**
 * 10 Field consensus (Researcher) — ask the library one claim, see how every paper answers.
 * Data comes from useFieldConsensus (mock-backed until the gateway endpoint exists); the
 * input drives the query on "Ask library".
 */

import { Bookmark, Copy, Download, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Input, VerdictBadge } from '../../../components/ui'
import { useFieldConsensus } from '../../../lib/useResearcher'

export function FieldConsensus() {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const consensus = useFieldConsensus(question).data
  if (!consensus) return null

  const stats = [
    { value: String(consensus.supports), label: 'papers support', className: 'text-supports' },
    { value: String(consensus.refutes), label: 'papers contradict', className: 'text-refutes' },
    { value: String(consensus.silent), label: 'are silent', className: 'text-insufficient' },
    { value: consensus.span, label: 'span', className: 'text-ink' },
  ]

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">
          What does the field say about…
        </h1>
        <form
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setQuestion(draft)
          }}
        >
          <Input
            value={draft || consensus.question}
            onChange={(event) => setDraft(event.target.value)}
            className="max-w-2xl"
          />
          <Button type="submit" className="shrink-0">
            <Search className="size-4" />
            Ask library
          </Button>
        </form>
      </header>

      {/* Summary stats */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {stats.map((s) => (
          <div key={s.label} className="flex-1 rounded-xl border border-border-subtle bg-surface px-4 py-3">
            <p className={`font-serif text-2xl font-semibold tracking-tight ${s.className}`}>{s.value}</p>
            <p className="text-xs text-ink-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Consensus note */}
      <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
        <p className="text-[13px] text-ink">{consensus.note}</p>
      </div>

      {/* Verdict table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="flex gap-4 px-5 py-3 text-xs font-medium text-ink-muted">
          <span className="w-56 shrink-0">Paper</span>
          <span className="w-36 shrink-0">Verdict</span>
          <span className="flex-1">Deciding passage</span>
        </div>
        {consensus.rows.map((row) => (
          <div key={row.paper} className="flex gap-4 border-t border-border-subtle px-5 py-3">
            <div className="w-56 shrink-0">
              <p className="text-sm font-medium text-ink">{row.paper}</p>
              <p className="text-xs text-ink-muted">{row.cite}</p>
            </div>
            <div className="w-36 shrink-0">
              <VerdictBadge verdict={row.verdict} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[13px] italic text-ink-muted">“{row.quote}”</p>
              <button type="button" className="text-xs font-medium text-accent hover:underline">
                show in the paper
              </button>
            </div>
          </div>
        ))}
        <div className="flex gap-2 border-t border-border-subtle px-5 py-3 text-xs text-ink-muted">
          {consensus.unlisted} more papers are silent or unchecked
          <button type="button" className="text-accent hover:underline">
            show
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost">
          <Bookmark className="size-4" />
          Save this question
        </Button>
        <Button variant="ghost">
          <Copy className="size-4" />
          Copy as related-work paragraph
        </Button>
        <Button variant="ghost">
          <Download className="size-4" />
          CSV
        </Button>
      </div>
    </>
  )
}
