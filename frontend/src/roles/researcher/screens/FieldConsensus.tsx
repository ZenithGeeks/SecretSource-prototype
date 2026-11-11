/**
 * Ask the field (Researcher) — ask the library one claim, see how every paper answers.
 * Data comes from useFieldConsensus: the claims in the user's analysed papers that match the
 * question, with the verdicts and quotes already found. The input drives the query on "Ask".
 * Figma: Ask the field. The question box stays on screen while a new question loads, so a slow
 * answer never wipes what the reader typed (#226).
 */

import { Search } from 'lucide-react'
import { useState } from 'react'

import { Button, ErrorState, FadeIn, LoadingScreen } from '../../../components/ui'
import { errorMessage } from '../../../lib/author'
import { useFieldConsensus } from '../../../lib/useResearcher'
import { FieldCountTiles, FieldVerdictTable } from '../components/FieldResults'

export function FieldConsensus({ onOpenAnalysis }: { onOpenAnalysis: (id: string) => void }) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const { data: consensus, isError, isPending, error, refetch } = useFieldConsensus(question)

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 pt-4 pb-12">
      <header>
        <h1 className="type-display text-ink">What does your library say?</h1>
      </header>

      <form
        // The input has no outline of its own: the field shows focus as a ring.
        className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-accent bg-surface py-1.5 pr-1.5 pl-3.5 focus-within:ring-2 focus-within:ring-accent/30"
        onSubmit={(event) => {
          event.preventDefault()
          setQuestion(draft)
        }}
      >
        <Search className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. does late interaction generalize out of domain?"
          aria-label="Your question"
          className="min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-ink-muted"
        />
        <Button type="submit" className="rounded-[9px] px-4 py-[7px] pointer-coarse:min-h-11">
          Ask
        </Button>
      </form>

      {isPending && <LoadingScreen label="Checking your library…" />}
      {isError && (
        <ErrorState title="That question could not be checked" message={errorMessage(error)} onRetry={() => refetch()} />
      )}
      {consensus && (
        <FadeIn className="flex flex-col gap-6">
          {consensus.rows.length === 0 ? (
            <p className="text-[15px] text-ink-muted">
              {consensus.note || 'No claim in your papers matches that question.'}
            </p>
          ) : (
            <>
              <FieldCountTiles consensus={consensus} />
              <FieldVerdictTable consensus={consensus} onOpenAnalysis={onOpenAnalysis} />
            </>
          )}
        </FadeIn>
      )}
    </div>
  )
}
