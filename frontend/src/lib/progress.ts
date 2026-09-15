/**
 * Where an analysis run is, worked out from its stages: which step it is on, how many checks
 * are done out of how many, what they found so far, which checks are running, and which
 * sources could not be checked, grouped by why.
 */

import type { Claim, Stage } from './api'
import { reasonText } from './api'
import { citedAs } from './claims'
import { reference } from './citations'

export type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'failed'

export type Step = { key: string; label: string; detail: string; state: StepState }

export type Progress = {
  steps: Step[]
  claims: number
  checksDone: number
  checksTotal: number | null // null for runs from before the gateway published the total
  verdicts: { supports: number; refutes: number; insufficient: number }
  failed: number
  running: { claim: number; source: string }[]
  failures: { reason: string; sources: string[] }[]
  seconds: number | null
  error: string | null
}

/** The cited work's short reference, or the lookup key when the claim no longer lists it. */
function sourceName(claims: Claim[], claimIndex: number | undefined, source: string | undefined) {
  if (!source) return ''
  const citation = claims[claimIndex ?? -1]?.citations.find((c) => citedAs(c) === source)
  return citation ? reference(citation) : source
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function summarise(stages: Stage[], claims: Claim[], status: string, now = Date.now() / 1000): Progress {
  const has = (name: Stage['stage']) => stages.some((s) => s.stage === name)
  const extracted = stages.find((s) => s.stage === 'extracted')
  const planned = stages.find((s) => s.stage === 'planned')
  const errorStage = stages.find((s) => s.stage === 'error')

  const finishedKeys = new Set<string>()
  const verdicts = { supports: 0, refutes: 0, insufficient: 0 }
  const failuresByReason = new Map<string, string[]>()
  let failed = 0
  for (const stage of stages) {
    if (stage.stage === 'verified') {
      finishedKeys.add(`${stage.claim}|${stage.source ?? ''}`)
      if (stage.verdict === 'supports' || stage.verdict === 'refutes' || stage.verdict === 'insufficient') {
        verdicts[stage.verdict] += 1
      }
    }
    if (stage.stage === 'failed') {
      failed += 1
      finishedKeys.add(`${stage.claim}|${stage.source ?? ''}`)
      const reason = reasonText(stage.reason)
      const name = sourceName(claims, stage.claim, stage.source)
      const names = failuresByReason.get(reason) ?? []
      if (!names.includes(name)) names.push(name)
      failuresByReason.set(reason, names)
    }
  }
  const checksDone = verdicts.supports + verdicts.refutes + verdicts.insufficient + failed

  // A check is running when it started and nothing has finished for it yet. Older gateways do
  // not put the source on "verified", so their finished checks are matched by claim alone.
  const finishedClaims = new Set(stages.filter((s) => s.stage === 'verified' && !s.source).map((s) => s.claim))
  const running = status === 'running'
    ? stages
        .filter((s) => s.stage === 'verifying')
        .filter((s) => !finishedKeys.has(`${s.claim}|${s.source ?? ''}`) && !finishedClaims.has(s.claim))
        .map((s) => ({ claim: (s.claim ?? 0) + 1, source: sourceName(claims, s.claim, s.source) }))
    : []

  const checking = has('planned') || has('verifying')
  const afterChecks = has('figures') || has('audited') || has('done')
  const verifyOff = Boolean(extracted) && !checking && afterChecks
  const figures = stages.find((s) => s.stage === 'figures')
  const audited = stages.find((s) => s.stage === 'audited')

  // Each step is done or skipped by what the stages show; the first step left is the one
  // running (or the one that failed), and the rest have not started.
  const rules: { key: string; label: string; detail: string; done: boolean; skipped?: boolean }[] = [
    { key: 'read', label: 'Read paper', detail: extracted ? count(extracted.claims ?? 0, 'claim') : '', done: Boolean(extracted) },
    {
      key: 'plan', label: 'Plan checks', done: checking, skipped: verifyOff,
      detail: planned ? `${count(planned.checks ?? 0, 'check')} · ${count(planned.sources ?? 0, 'source')}` : '',
    },
    {
      key: 'check', label: 'Check sources', done: checking && afterChecks, skipped: verifyOff,
      detail: planned ? `${checksDone} of ${planned.checks}` : checking ? count(checksDone, 'check') : '',
    },
    {
      key: 'figures', label: 'Figures', done: Boolean(figures),
      skipped: !figures && Boolean(audited), // runs from before this step existed
      detail: figures ? count(figures.figures ?? 0, 'figure') : '',
    },
    { key: 'audit', label: 'Audit', done: Boolean(audited), detail: audited ? count(audited.findings ?? 0, 'finding') : '' },
  ]
  let reachedCurrent = false
  const steps: Step[] = rules.map(({ key, label, detail, done, skipped }) => {
    if (done) return { key, label, detail, state: 'done' }
    if (skipped) return { key, label, detail: 'skipped', state: 'skipped' }
    if (reachedCurrent) return { key, label, detail, state: 'todo' }
    reachedCurrent = true
    const state: StepState = status === 'running' ? 'current' : status === 'error' ? 'failed' : 'todo'
    return { key, label, detail, state }
  })

  const times = stages.map((s) => s.at).filter((at): at is number => typeof at === 'number')
  const seconds = times.length ? Math.max(0, (status === 'running' ? now : times[times.length - 1]) - times[0]) : null

  return {
    steps,
    claims: extracted?.claims ?? claims.length,
    checksDone,
    checksTotal: planned?.checks ?? null,
    verdicts,
    failed,
    running,
    failures: [...failuresByReason.entries()].map(([reason, sources]) => ({ reason, sources })),
    seconds,
    error: errorStage?.message ?? null,
  }
}

/** "45 s", "4 min", "1 h 5 min". */
export function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
