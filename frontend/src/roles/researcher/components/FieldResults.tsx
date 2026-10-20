/**
 * What "Ask the field" answers with (Figma: Ask the field): count tiles that add up to the
 * verdict table, then the table itself: paper, verdict, deciding passage. Rows where the paper is
 * silent sit behind "Show them", so the ones that back or contradict come first. The counts come
 * from the same rows the table lists, so the tiles and the table cannot disagree.
 */

import { useState } from 'react'

import { VerdictBadge } from '../../../components/ui'
import { verdictCountWord } from '../../../lib/claims'
import type { ConsensusRow, FieldConsensus } from '../../../lib/researcher'

function Tile({ value, label, tone, count }: { value: string; label: string; tone: string; count?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl border border-border-subtle bg-surface px-3.5 py-3">
      <p data-testid={count ? 'consensus-count' : undefined} className={`text-[26px] leading-8 font-semibold tracking-tight ${tone}`}>
        {value}
      </p>
      <p className="text-xs leading-4 font-medium text-ink-muted">{label}</p>
    </div>
  )
}

export function FieldCountTiles({ consensus }: { consensus: FieldConsensus }) {
  const { supports, refutes, silent, span } = consensus
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-row">
      <Tile count value={String(supports)} tone="text-supports" label={`${supports === 1 ? 'paper' : 'papers'} ${verdictCountWord('supports', supports)}`} />
      <Tile count value={String(refutes)} tone="text-refutes" label={verdictCountWord('refutes', refutes)} />
      <Tile count value={String(silent)} tone="text-insufficient" label="silent or not checked" />
      {span && <Tile value={span} tone="text-ink" label="evidence spans" />}
    </div>
  )
}

function Row({ row, onOpenAnalysis }: { row: ConsensusRow; onOpenAnalysis: (id: string) => void }) {
  return (
    <div data-testid="consensus-row" className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3.5 sm:flex-row sm:gap-5 sm:px-5">
      <div className="flex flex-col gap-0.5 sm:w-[220px] sm:shrink-0">
        <p className="text-[13px] leading-[18px] font-medium text-ink">{row.paper}</p>
        <p className="text-xs leading-4 text-ink-muted">{row.cite}</p>
      </div>
      <div className="sm:w-[150px] sm:shrink-0">
        <VerdictBadge verdict={row.verdict} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row.quote && <p className="font-serif text-[15px] leading-[22px] italic text-ink">“{row.quote}”</p>}
        <p className="text-xs leading-4 text-ink-muted">On the claim: {row.claim}</p>
        <button
          type="button"
          onClick={() => onOpenAnalysis(row.analysis)}
          className="self-start text-[13px] leading-[18px] font-medium text-accent hover:underline"
        >
          Open the analysis
        </button>
      </div>
    </div>
  )
}

export function FieldVerdictTable({
  consensus,
  onOpenAnalysis,
}: {
  consensus: FieldConsensus
  onOpenAnalysis: (id: string) => void
}) {
  const [showSilent, setShowSilent] = useState(false)
  const decisive = consensus.rows.filter((r) => r.verdict !== 'insufficient')
  const silent = consensus.rows.filter((r) => r.verdict === 'insufficient')
  // With nothing that backs or contradicts, the silent rows are the answer: do not fold them away.
  const folded = decisive.length > 0 && silent.length > 0 && !showSilent
  const shown = folded ? decisive : consensus.rows

  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[0_8px_12px_rgba(31,20,36,0.05),0_1px_1px_rgba(31,20,36,0.04)]">
      <div className="hidden gap-5 px-5 py-3 sm:flex">
        <span className="type-label w-[220px] shrink-0 text-ink-muted">Paper</span>
        <span className="type-label w-[150px] shrink-0 text-ink-muted">Verdict</span>
        <span className="type-label flex-1 text-ink-muted">Deciding passage</span>
      </div>
      {shown.map((row) => (
        <Row key={`${row.analysis}-${row.claimIndex}-${row.paper}-${row.verdict}`} row={row} onOpenAnalysis={onOpenAnalysis} />
      ))}
      {decisive.length > 0 && silent.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-border-subtle px-5 py-3 text-[13px] leading-[18px]">
          <span className="text-ink-muted">
            {silent.length} {silent.length === 1 ? 'paper is' : 'papers are'} silent or not checked
          </span>
          <button type="button" onClick={() => setShowSilent((v) => !v)} className="font-medium text-accent hover:underline">
            {showSilent ? 'Hide them' : 'Show them'}
          </button>
        </div>
      )}
      {consensus.unlisted > 0 && (
        <div className="border-t border-border-subtle px-5 py-3 text-xs text-ink-muted">
          {consensus.unlisted} more verdicts match. Ask a narrower question to see them.
        </div>
      )}
    </div>
  )
}
