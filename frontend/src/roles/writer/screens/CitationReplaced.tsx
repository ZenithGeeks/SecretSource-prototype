/** Writer Citation replaced — the draft with the just-replaced citation, remaining
 * issues, and a toast confirming the swap. `newCitationLabel` is set only right after a
 * replace; visiting this screen otherwise (e.g. a refresh) just shows no toast. */

import { CheckCircle2, ChevronRight, Download, Loader2, Search } from 'lucide-react'

import { Button, Card } from '../../../components/ui'
import { useDraftCheck } from '../../../lib/useWriter'
import type { DraftWord, VerdictKind } from '../../../lib/writer'
import { cn } from '../../../lib/utils'

const LEGEND: { kind: VerdictKind; label: string }[] = [
  { kind: 'supports', label: 'source backs it' },
  { kind: 'refutes', label: 'source contradicts' },
  { kind: 'insufficient', label: 'source is silent' },
]

const MARK_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports-soft border-supports',
  refutes: 'bg-refutes-soft border-refutes',
  insufficient: 'bg-insufficient-soft border-insufficient',
}

const SWATCH_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports',
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
}

function DraftParagraph({ words }: { words: DraftWord[] }) {
  return (
    <p className="flex flex-wrap items-start gap-x-1.5 gap-y-1.5">
      {words.map((word, index) =>
        word.mark ? (
          <mark key={index} className={cn('rounded-none border-b-2 px-0.5 text-ink', MARK_STYLES[word.mark])}>
            {word.text}
          </mark>
        ) : (
          <span key={index} className="text-ink">
            {word.text}
          </span>
        ),
      )}
    </p>
  )
}

export function CitationReplaced({
  newCitationLabel,
  onBackToDraft,
}: {
  newCitationLabel: string | null
  onBackToDraft: () => void
}) {
  const draftCheck = useDraftCheck()

  if (draftCheck.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading your draft…
      </p>
    )
  }

  if (draftCheck.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not load this draft: {(draftCheck.error as Error).message}
      </Card>
    )
  }

  if (!draftCheck.data) return null

  return (
    <div className="relative">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">Check a draft</h1>
          <p className="text-sm text-ink-muted">
            {draftCheck.data.draft.fileName} · {draftCheck.data.draft.citationsFound} citations found ·{' '}
            {draftCheck.data.draft.issuesRemaining} need{draftCheck.data.draft.issuesRemaining === 1 ? 's' : ''} work
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Button variant="ghost">
            <Download className="size-4" />
            Export references
          </Button>
          <Button>
            <Search className="size-4" />
            Re-check
          </Button>
        </div>
      </header>

      <div className="mt-4 flex flex-1 items-stretch gap-4">
        <section className="flex flex-1 flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-7">
          <h2 className="font-serif text-lg font-semibold tracking-tight text-ink">{draftCheck.data.draft.heading}</h2>

          <div className="flex flex-col gap-4">
            {draftCheck.data.draft.paragraphs.map((words, index) => (
              <DraftParagraph words={words} key={index} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3.5">
            {LEGEND.map(({ kind, label }) => (
              <div className="flex items-center gap-1.5" key={kind}>
                <span className={cn('h-[3px] w-3.5', SWATCH_STYLES[kind])} />
                <span className="text-xs text-ink-muted">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex w-[400px] shrink-0 flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface p-5 text-center">
          <CheckCircle2 className="size-5 text-supports" />
          {draftCheck.data.issues.length > 0 ? (
            <>
              <p className="text-sm font-medium text-ink">
                {draftCheck.data.issues.length} issue{draftCheck.data.issues.length === 1 ? '' : 's'} left
              </p>
              <p className="text-xs text-ink-muted">{draftCheck.data.issues[0].explanation}</p>
              <Button onClick={onBackToDraft}>
                Next issue
                <ChevronRight className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">All caught up</p>
              <p className="text-xs text-ink-muted">Every citation in this draft checks out.</p>
            </>
          )}
        </section>
      </div>

      {newCitationLabel && (
        <div
          role="status"
          className="fixed bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-lg"
        >
          <CheckCircle2 className="size-4 shrink-0 text-supports" />
          <p className="text-sm">Citation replaced with {newCitationLabel}</p>
          <button type="button" onClick={onBackToDraft} className="rounded bg-white/10 px-2.5 py-1 text-xs font-medium">
            Undo
          </button>
          <p className="text-xs text-white/60">· 8 s</p>
        </div>
      )}
    </div>
  )
}
