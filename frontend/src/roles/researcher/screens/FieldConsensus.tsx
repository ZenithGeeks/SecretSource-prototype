/**
 * 10 Field consensus (Researcher) — ask the library one claim, see how every paper answers.
 * Data comes from useFieldConsensus (mock-backed until the gateway endpoint exists); the
 * input drives the query on "Ask library".
 */

import { Bookmark, Copy, Download, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Input, VerdictBadge } from '../../../components/ui'
import { useFieldConsensus } from '../../../lib/useResearcher'
import type { ViewerClaim } from './PageViewer'

export function FieldConsensus({ onShow }: { onShow?: (claims: ViewerClaim[], index: number) => void }) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showUnlisted, setShowUnlisted] = useState(false)
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
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const rows = [
      ['Paper', 'Cite', 'Verdict', 'Quote'],
      ...consensus.rows.map((r) => [r.paper, r.cite, r.verdict, r.quote]),
    ]
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'field-consensus.csv'
    a.click()
    URL.revokeObjectURL(url)
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
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setQuestion(draft.trim())
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask your library — e.g. late interaction beats single-vector retrieval"
            className="max-w-2xl"
          />
          <Button type="submit" className="shrink-0" disabled={!draft.trim()}>
            <Search className="size-4" />
            Ask library
          </Button>
        </form>
        <p className="text-sm text-ink-muted">
          Showing every paper’s answer to “
          <span className="text-ink">{question || consensus.question}</span>”
        </p>
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
        {consensus.rows.map((row, i) => (
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
              <button
                type="button"
                onClick={() =>
                  onShow?.(
                    consensus.rows.map((r) => ({ claim: r.paper, verdict: r.verdict, quote: r.quote, page: 'page 4 of 12' })),
                    i,
                  )
                }
                className="text-xs font-medium text-accent hover:underline"
              >
                show in the paper
              </button>
            </div>
          </div>
        ))}
        {showUnlisted &&
          Array.from({ length: consensus.unlisted }).map((_, i) => (
            <div key={`unlisted-${i}`} className="flex gap-4 border-t border-border-subtle px-5 py-3">
              <div className="w-56 shrink-0">
                <p className="text-sm font-medium text-ink-muted">Unlisted paper {i + 1}</p>
              </div>
              <div className="w-36 shrink-0">
                <VerdictBadge verdict="insufficient" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink-muted">Silent — no passage speaks to this claim.</p>
              </div>
            </div>
          ))}
        <div className="flex gap-2 border-t border-border-subtle px-5 py-3 text-xs text-ink-muted">
          {consensus.unlisted} more papers are silent or unchecked
          <button
            type="button"
            onClick={() => setShowUnlisted((v) => !v)}
            className="text-accent hover:underline"
          >
            {showUnlisted ? 'hide' : 'show'}
          </button>
        </div>
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
