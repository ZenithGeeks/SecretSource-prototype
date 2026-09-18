/**
 * 10 Field consensus (Researcher) — ask the library one claim, see how every paper answers.
 * Data comes from useFieldConsensus: the claims in the user's analysed papers that match the
 * question, with the verdicts and quotes already found. The input drives the query on "Ask library".
 */

import { Bookmark, Copy, Download, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Input, VerdictBadge } from '../../../components/ui'
import { csvText, downloadText } from '../../../lib/csv'
import { useFieldConsensus } from '../../../lib/useResearcher'

export function FieldConsensus({ onOpenAnalysis }: { onOpenAnalysis: (id: string) => void }) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const consensus = useFieldConsensus(question).data
  if (!consensus) return null

  const copyParagraph = async () => {
    const text =
      consensus.note +
      '\n\n' +
      consensus.rows
        .map((r) => `${r.paper} (${r.cite}) — ${r.verdict}: “${r.quote}”`)
        .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadCsv = () => {
    const rows = [
      ['Paper', 'Cite', 'Verdict', 'Quote'],
      ...consensus.rows.map((r) => [r.paper, r.cite, r.verdict, r.quote]),
    ]
    downloadText('field-consensus.csv', csvText(rows), 'text/csv;charset=utf-8')
  }

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
          className="flex flex-col gap-3 sm:flex-row"
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
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row">
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
        <div className="hidden gap-4 px-5 py-3 text-xs font-medium text-ink-muted sm:flex">
          <span className="w-56 shrink-0">Paper</span>
          <span className="w-36 shrink-0">Verdict</span>
          <span className="flex-1">Deciding passage</span>
        </div>
        {consensus.rows.map((row) => (
          <div
            key={`${row.analysis}-${row.claimIndex}-${row.paper}-${row.verdict}`}
            className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 sm:flex-row sm:gap-4 sm:px-5"
          >
            <div className="sm:w-56 sm:shrink-0">
              <p className="text-sm font-medium text-ink">{row.paper}</p>
              <p className="text-xs text-ink-muted">{row.cite}</p>
            </div>
            <div className="sm:w-36 sm:shrink-0">
              <VerdictBadge verdict={row.verdict} />
            </div>
            <div className="min-w-0 flex-1">
              {row.quote && <p className="font-serif text-[13px] italic text-ink-muted">“{row.quote}”</p>}
              <p className="mt-1 text-xs text-ink-muted">On the claim: {row.claim}</p>
              <button
                type="button"
                onClick={() => onOpenAnalysis(row.analysis)}
                className="text-xs font-medium text-accent hover:underline"
              >
                open the analysis
              </button>
            </div>
          </div>
        ))}
        {consensus.unlisted > 0 && (
          <div className="border-t border-border-subtle px-5 py-3 text-xs text-ink-muted">
            {consensus.unlisted} more verdicts match. Ask a narrower question to see them.
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setSaved(true)}>
          <Bookmark className="size-4" />
          {saved ? 'Saved ✓' : 'Save this question'}
        </Button>
        <Button variant="ghost" onClick={copyParagraph}>
          <Copy className="size-4" />
          {copied ? 'Copied ✓' : 'Copy as related-work paragraph'}
        </Button>
        <Button variant="ghost" onClick={downloadCsv}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>
    </>
  )
}
