/** Writer Home — greeting, quick actions, needs-attention list, recent papers. Data comes
 * from useWriterHome (mock-backed until the gateway endpoint exists). `onNewDraft` creates
 * a draft and opens it in Draft check; `onFixReferences` opens Draft check pre-filtered to
 * claims that need work; `onOpenClaim` opens Draft check with a claim selected. */

import { ChevronRight, FileText, ListChecks, Loader2, Pen, Search } from 'lucide-react'

import { Card, Empty, StandingBadge } from '../../../components/ui'
import { useWriterHome } from '../../../lib/useWriter'
import type { Claim, VerdictKind } from '../../../lib/writer'

/** A claim only belongs in "needs your attention" once it has been checked at all. */
function isAnswered(claim: Claim): claim is Claim & { verdict: VerdictKind } {
  return claim.verdict !== undefined
}

export function Home({
  onNewDraft,
  onOpenFindSource,
  onFixReferences,
  onOpenClaim,
}: {
  onNewDraft: () => void
  onOpenFindSource: () => void
  onFixReferences: () => void
  onOpenClaim: (claimId: string) => void
}) {
  const home = useWriterHome()

  if (home.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading your workspace…
      </p>
    )
  }

  if (home.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not load your workspace: {(home.error as Error).message}
      </Card>
    )
  }

  if (!home.data) return null

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">
          Good morning, {home.data.user}
        </h1>
        <p className="text-sm text-ink-muted">{home.data.alert}</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onNewDraft}
          className="flex flex-1 flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent"
        >
          <Pen className="size-4 text-accent" />
          <p className="text-sm font-medium text-ink">Check a draft</p>
          <p className="text-xs text-ink-muted">Paste text, every citation gets a verdict</p>
        </button>
        <button
          type="button"
          onClick={onOpenFindSource}
          className="flex flex-1 flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent"
        >
          <Search className="size-4 text-accent" />
          <p className="text-sm font-medium text-ink">Find a source for…</p>
          <p className="text-xs text-ink-muted">Search your library by meaning</p>
        </button>
        <button
          type="button"
          onClick={onFixReferences}
          className="flex flex-1 flex-col items-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent"
        >
          <ListChecks className="size-4 text-accent" />
          <p className="text-sm font-medium text-ink">Fix reference list</p>
          <p className="text-xs text-ink-muted">From a checked draft, with corrected sources</p>
        </button>
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="text-sm font-semibold text-ink">Needs your attention</p>
          <p className="text-xs text-ink-muted">
            {home.data.draftFileName} · {home.data.draftLastCheckedLabel}
          </p>
        </div>

        {home.data.attention.filter(isAnswered).length === 0 ? (
          <div className="px-5 pb-5">
            <Empty title="Nothing needs your attention" hint="Every checked citation in this draft holds up." />
          </div>
        ) : (
          home.data.attention.filter(isAnswered).map((claim) => (
            <button
              key={claim.id}
              type="button"
              onClick={() => onOpenClaim(claim.id)}
              className="flex w-full items-center gap-3 border-t border-border-subtle px-5 py-3 text-left hover:bg-accent-soft"
            >
              <StandingBadge standing={claim.verdict} />
              <p className="min-w-0 flex-1 text-sm text-ink">{claim.text}</p>
              <p className="shrink-0 whitespace-nowrap text-xs text-ink-muted">{claim.citation?.label}</p>
              <ChevronRight className="size-4 shrink-0 text-ink-muted" />
            </button>
          ))
        )}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-ink">Recent papers and drafts</p>
        {home.data.recentPapers.length === 0 ? (
          <Empty title="No papers yet" hint="Check a draft or add a paper to see it here." />
        ) : (
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {home.data.recentPapers.map((paper) => (
              <li key={paper.id} className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{paper.fileName}</p>
                  <p className="text-xs text-ink-muted">{paper.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
