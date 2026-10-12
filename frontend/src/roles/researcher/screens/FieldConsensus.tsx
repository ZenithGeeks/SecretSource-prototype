/**
 * Ask the field (Researcher) — ask the library one claim, see how every paper answers.
 * Data comes from useFieldConsensus: the claims in the user's analysed papers that match the
 * question, with the verdicts and quotes already found. The input drives the query on "Ask".
 * Figma: Ask the field. The question box stays on screen while a new question loads, so a slow
 * answer never wipes what the reader typed (#226).
 */

import { Search } from 'lucide-react'
import { useState } from 'react'

import { Empty, FadeIn, LoadingScreen } from '../../../components/ui'
import { useFieldConsensus } from '../../../lib/useResearcher'
import { FieldCountTiles, FieldVerdictTable } from '../components/FieldResults'

export function FieldConsensus({ onOpenAnalysis }: { onOpenAnalysis: (id: string) => void }) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const { data: consensus, isError, isPending } = useFieldConsensus(question)

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 pt-4 pb-12">
      <header className="flex flex-col gap-2">
        <p className="type-label text-accent">Across your library</p>
        <h1 className="type-display tracking-[-0.01em] text-ink">What does your library say?</h1>
      </header>

      <form
        className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-accent bg-surface py-1.5 pr-1.5 pl-3.5"
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
        <button
          type="submit"
          className="shrink-0 rounded-[9px] bg-accent px-3 py-[7px] text-[13px] leading-[18px] font-medium text-white hover:opacity-90"
        >
          Ask
        </button>
      </form>

      {isPending && <LoadingScreen label="Checking your library…" />}
      {isError && <Empty title="That question could not be checked" hint="Refresh the page and try again." />}
      {consensus && (
        <FadeIn className="flex flex-col gap-6">
          {consensus.rows.length === 0 ? (
            consensus.note && <p className="text-[15px] text-ink-muted">{consensus.note}</p>
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
