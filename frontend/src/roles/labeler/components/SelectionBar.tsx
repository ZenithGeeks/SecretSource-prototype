/** What to do with the text just selected in one of the two PDFs. */

import { Quote, X } from 'lucide-react'

import { Button } from '../../../components/ui'

/** `file`: the PDF it was selected in, so it is not attributed to whatever is on screen later. */
export type Picked = { side: 'paper' | 'reference'; file: string; text: string; page: number | null }

const SHOWN = 240

export function SelectionBar({
  picked,
  /** Why the text cannot be added as evidence yet, if so. */
  blocked,
  onEvidence,
  onClaimWording,
  onNewClaim,
  onClear,
}: {
  picked: Picked
  blocked: string | null
  onEvidence: () => void
  onClaimWording: () => void
  onNewClaim: () => void
  onClear: () => void
}) {
  const quote = picked.text.length > SHOWN ? `${picked.text.slice(0, SHOWN)}…` : picked.text
  const where = picked.side === 'paper' ? 'the paper' : 'the reference'
  return (
    <div
      role="region"
      aria-label="Selected text"
      className="flex flex-col gap-2 rounded-xl border border-accent bg-accent-soft p-3 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <p className="flex min-w-0 flex-1 gap-2 text-sm text-ink">
        <Quote className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="block text-xs text-ink-muted">
            Selected in {where}
            {picked.page ? `, page ${picked.page}` : ''}
          </span>
          <span className="block break-words">{quote}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {picked.side === 'reference' ? (
          <Button type="button" onClick={onEvidence} disabled={Boolean(blocked)} title={blocked ?? undefined}>
            Add as evidence
          </Button>
        ) : (
          <>
            <Button type="button" onClick={onClaimWording}>
              Use as this claim's wording
            </Button>
            <Button type="button" variant="ghost" onClick={onNewClaim}>
              Add as a new claim
            </Button>
          </>
        )}
        <Button type="button" variant="ghost" onClick={onClear} aria-label="Clear the selection">
          <X className="size-4" />
        </Button>
      </div>
      {blocked && picked.side === 'reference' && <p className="text-xs text-ink-muted sm:basis-full">{blocked}</p>}
    </div>
  )
}
