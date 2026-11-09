/** Blind checks: papers someone else already labeled, which the signed-in person labels again
 * without seeing that label or the judge (#867). A lead also assigns them here. */

import { EyeOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { Badge, Button, Card, Empty, FadeIn, IconButton, LoadingScreen } from '../../../components/ui'
import { problem, useBlindCheck, usePool, type Pool } from '../../../lib/labeling'

type Paper = Pool['papers'][number]

export function BlindChecks({ onOpen }: { onOpen: (id: string) => void }) {
  const pool = usePool()
  if (pool.isLoading) return <LoadingScreen />
  if (!pool.data) return <Empty title="The paper list could not be read" hint="Reload the page to try again." />

  const mine = new Set(pool.data.blind ?? [])
  const papers = pool.data.papers.filter((paper) => mine.has(paper.analysis_id))
  return (
    <FadeIn className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-ink">
          <EyeOff className="size-6 text-accent" aria-hidden />
          Blind checks
        </h1>
        <p className="max-w-[68ch] text-sm text-ink-muted">
          Someone else already labeled these papers. Label each one on your own, the same way as any other paper.
          While you do, other people's labels are not shown, and Review and Ask are turned off, so nothing sways your
          levels. Your labels and theirs are compared afterwards to measure how well the team agrees.
        </p>
      </header>

      <section aria-labelledby="blind-mine" className="flex flex-col gap-3">
        <h2 id="blind-mine" className="text-sm font-semibold text-ink">
          Your blind checks <span className="font-normal text-ink-muted tabular-nums">({papers.length})</span>
        </h2>
        {papers.length === 0 ? (
          <Empty title="No blind checks for you" hint="A labeling lead assigns these during a labeling round." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
            {papers.map((paper) => (
              <BlindRow key={paper.analysis_id} paper={paper} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>

      {pool.data.lead && <AssignBlindChecks pool={pool.data} />}
    </FadeIn>
  )
}

function BlindRow({ paper, onOpen }: { paper: Paper; onOpen: (id: string) => void }) {
  const ready = paper.status === 'done'
  const finished = paper.claims > 0 && paper.judged >= paper.claims
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-ink" title={paper.title}>
          {paper.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
          {paper.topic} · {paper.judged} of {paper.claims} claims judged
        </p>
      </div>
      {finished && <Badge tone="supports">Done</Badge>}
      <Button variant={finished ? 'ghost' : 'solid'} disabled={!ready} onClick={() => onOpen(paper.analysis_id)} className="min-h-10">
        {finished ? 'Review my labels' : paper.judged > 0 ? 'Continue' : 'Start'}
      </Button>
    </li>
  )
}

/** The lead's form: give a person a paper to check blind, and the list of checks so far. */
function AssignBlindChecks({ pool }: { pool: Pool }) {
  const blind = useBlindCheck()
  const [name, setName] = useState('')
  const [paperId, setPaperId] = useState('')
  const checks = pool.blind_checks ?? []
  const titleOf = new Map(pool.papers.map((p) => [p.analysis_id, p.title]))
  const chosen = pool.papers.find((p) => p.analysis_id === paperId)
  // Their own labels on the paper would make a blind check of it meaningless.
  const alreadyLabeled = Boolean(chosen && name && chosen.labelers.includes(name))
  const duplicate = checks.some((c) => c.name === name && c.analysis_id === paperId)
  const sameTopic = Boolean(chosen && pool.people.find((p) => p.name === name)?.topic === chosen.topic)
  const canAssign = Boolean(name && paperId) && !alreadyLabeled && !duplicate && !blind.isPending
  let note = ''
  if (alreadyLabeled) note = `${name} already labeled this paper, so it cannot be a blind check for them.`
  else if (duplicate) note = `${name} already has this paper as a blind check.`
  else if (sameTopic) note = 'Same topic as this person: allowed, but a paper from another topic tells more.'

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Assign blind checks</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-muted">
          Only leads see this. Give each person papers someone else has labeled, ideally from another topic, so
          labeler style can be told apart from topic.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (canAssign) blind.mutate({ name, analysis_id: paperId, on: true }, { onSuccess: () => setPaperId('') })
        }}
      >
        <label className="flex min-w-48 flex-col gap-1 text-sm text-ink">
          Person
          <select value={name} onChange={(e) => setName(e.target.value)} className="min-h-10 rounded-lg border border-border-subtle bg-surface px-3 text-sm">
            <option value="">Choose a person</option>
            {pool.people.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
                {person.topic ? ` (${person.topic})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-ink">
          Paper
          <select value={paperId} onChange={(e) => setPaperId(e.target.value)} className="min-h-10 rounded-lg border border-border-subtle bg-surface px-3 text-sm">
            <option value="">Choose a labeled paper</option>
            {pool.papers
              .filter((p) => p.team_judged > 0)
              .map((paper) => (
                <option key={paper.analysis_id} value={paper.analysis_id}>
                  {paper.topic} · {paper.title}
                </option>
              ))}
          </select>
        </label>
        <Button type="submit" disabled={!canAssign} className="min-h-10">
          {blind.isPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          Assign
        </Button>
      </form>
      <p aria-live="polite" className="-mt-2 min-h-5 text-xs text-ink-muted">
        {note}
      </p>
      {blind.error && (
        <p role="alert" className="-mt-2 text-sm text-refutes">
          {problem(blind.error).title}. {problem(blind.error).hint}
        </p>
      )}

      {checks.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Blind checks on the team</caption>
          <thead className="text-xs text-ink-muted">
            <tr>
              <th scope="col" className="py-1.5 font-medium">Person</th>
              <th scope="col" className="py-1.5 font-medium">Paper</th>
              <th scope="col" className="w-12 py-1.5">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
            {checks.map((check) => (
              <tr key={`${check.name}|${check.analysis_id}`}>
                <td className="py-2 pr-4 align-top whitespace-nowrap text-ink">{check.name}</td>
                <td className="py-2 pr-4 align-top text-ink-muted">{titleOf.get(check.analysis_id) ?? check.analysis_id}</td>
                <td className="py-1 text-right">
                  <IconButton
                    aria-label={`Take back ${check.name}'s blind check of this paper`}
                    disabled={blind.isPending}
                    onClick={() => blind.mutate({ ...check, on: false })}
                  >
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
