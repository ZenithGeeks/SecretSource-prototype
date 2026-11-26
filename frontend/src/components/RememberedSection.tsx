/**
 * Settings → Your data → What the assistant remembers (SPEC.md user story 2: "I can see
 * everything the assistant remembers about me, and I can delete any item").
 *
 * One row per fact the assistant keeps about the signed-in researcher, each with its own Forget
 * button, and "Forget everything" behind a confirm. A forgotten fact leaves the list at once and
 * comes back if the gateway refuses.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { accountApi, MEMORIES_KEY, type Memory } from '../lib/accountApi'
import { authEnabled } from '../lib/supabase'
import { Row, Section } from './settings'

const KIND_NAMES: Record<Memory['kind'], string> = { paper: 'Paper', concept: 'Concept', question: 'Question' }

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export function RememberedSection({ isPreview }: { isPreview: boolean }) {
  const queryClient = useQueryClient()
  const facts = useQuery({ queryKey: MEMORIES_KEY, queryFn: accountApi.listMemories })
  const [notice, setNotice] = useState('')

  const forgetOne = useMutation({
    mutationFn: accountApi.deleteMemory,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: MEMORIES_KEY })
      const before = queryClient.getQueryData<Memory[]>(MEMORIES_KEY)
      queryClient.setQueryData<Memory[]>(MEMORIES_KEY, (list) => list?.filter((fact) => fact.id !== id))
      setNotice('')
      return { before }
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(MEMORIES_KEY, context?.before)
      setNotice('That fact could not be forgotten, so it is still remembered. Try again.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: MEMORIES_KEY }),
  })

  const forgetAll = useMutation({
    mutationFn: accountApi.deleteAllMemories,
    onSuccess: () => {
      queryClient.setQueryData<Memory[]>(MEMORIES_KEY, [])
      setNotice('Everything was forgotten.')
    },
    onError: () => setNotice('Nothing was forgotten. Try again.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MEMORIES_KEY }),
  })

  const list = facts.data ?? []
  const locked = isPreview || forgetOne.isPending || forgetAll.isPending

  const confirmForgetAll = () => {
    if (!window.confirm('Forget everything the assistant remembers about you? This cannot be undone.')) return
    forgetAll.mutate()
  }

  return (
    <Section title="What the assistant remembers">
      {notice && (
        <p role="alert" className="w-full rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      )}
      {facts.isPending && <p className="py-3 text-sm text-ink-muted">Loading what the assistant remembers…</p>}
      {facts.isError && (
        <p className="py-3 text-sm text-ink-muted">
          The list could not be loaded.{' '}
          <button type="button" onClick={() => void facts.refetch()} className="font-medium text-ink underline">
            Try again
          </button>
        </p>
      )}
      {facts.isSuccess && list.length === 0 && (
        <p className="py-3 text-sm text-ink-muted">
          The assistant has not remembered anything about you yet. It learns what you study from your chats.
          {!authEnabled && ' Sign-in is off here, so nothing is kept.'}
        </p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {list.map((fact) => (
            <li key={fact.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded-sm bg-accent-soft px-1.5 text-xs text-ink-muted">{KIND_NAMES[fact.kind]}</span>
                  <span className="font-medium text-ink">{fact.subject}</span>
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">{fact.summary}</p>
                <p className="mt-0.5 text-xs text-ink-muted">Updated {date(fact.updated_at)}</p>
              </div>
              <button
                type="button"
                disabled={locked}
                aria-label={`Forget ${fact.subject}`}
                onClick={() => forgetOne.mutate(fact.id)}
                className="shrink-0 text-sm font-medium text-refutes hover:underline disabled:opacity-50"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
      <Row
        label="Forget everything"
        hint={
          isPreview
            ? 'Deletes every fact above. Switch to Researcher to change them.'
            : 'Deletes every fact above. The assistant learns again from your next chats.'
        }
      >
        <button
          type="button"
          disabled={locked || list.length === 0}
          onClick={confirmForgetAll}
          className="text-sm font-medium text-refutes hover:underline disabled:opacity-50"
        >
          Forget everything
        </button>
      </Row>
    </Section>
  )
}
