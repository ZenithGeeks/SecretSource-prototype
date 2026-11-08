/**
 * Under each verdict: a note that an AI judge made it, and a way for the analysis's owner to
 * disagree, with a reason. The dispute is stored beside the verdict (POST /analyses/{id}/disputes);
 * the verdict itself does not change.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Dispute, type Verdict } from '../lib/api'
import { Button, Textarea, TextButton } from './ui'

export function VerdictDispute({
  analysisId,
  claimIndex,
  verdict,
  dispute,
}: {
  analysisId: string
  claimIndex: number
  verdict: Verdict
  /** The owner's earlier dispute of this verdict, if any. */
  dispute?: Dispute
}) {
  const [writing, setWriting] = useState(false)
  const [note, setNote] = useState(dispute?.note ?? '')
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: () => api.disputeVerdict(analysisId, claimIndex, verdict.source, note),
    onSuccess: () => {
      setWriting(false)
      queryClient.invalidateQueries({ queryKey: ['analysis', analysisId] })
    },
  })

  if (writing) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          send.mutate()
        }}
      >
        <label htmlFor={`dispute-${claimIndex}-${verdict.source}`} className="text-xs text-ink-muted">
          What did the judge get wrong? Name the page, table or figure if you can.
        </label>
        <Textarea
          id={`dispute-${claimIndex}-${verdict.source}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={2000}
          className="text-sm"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={send.isPending} className="px-3 py-1.5 text-[13px]">
            Send
          </Button>
          <TextButton onClick={() => setWriting(false)} className="text-[13px]">
            Cancel
          </TextButton>
          {send.isError && (
            <p role="alert" className="text-xs text-refutes">
              {(send.error as Error).message}
            </p>
          )}
        </div>
      </form>
    )
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
      {dispute ? (
        <span>
          You disagreed{dispute.note ? `: “${dispute.note}”` : '.'}
        </span>
      ) : (
        <span>Checked by an AI judge, which can be wrong.</span>
      )}
      <TextButton onClick={() => setWriting(true)} className="text-xs">
        {dispute ? 'Edit' : 'Disagree?'}
      </TextButton>
    </p>
  )
}
