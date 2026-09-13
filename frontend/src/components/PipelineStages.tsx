/** Live pipeline progress: one line per stage, newest last. */

import { AlertCircle, CheckCircle2, Loader2, SearchX } from 'lucide-react'

import type { Stage } from '../lib/api'
import { reasonText } from '../lib/api'

const LABELS: Record<Stage['stage'], (stage: Stage) => string> = {
  extracting: (stage) => stage.message ?? 'Reading the paper',
  extracted: (stage) =>
    `Found ${stage.claims} claims` +
    ((stage.extracted ?? 0) > (stage.claims ?? 0)
      ? ` of ${stage.extracted}, the ones a reader can follow furthest`
      : '') +
    ((stage.windows ?? 1) > 1 ? ` across ${stage.windows} parts of the paper` : ''),
  verifying: (stage) => `Checking claim ${(stage.claim ?? 0) + 1} against ${stage.source}`,
  verified: (stage) => `Claim ${(stage.claim ?? 0) + 1}: ${stage.verdict}`,
  failed: (stage) =>
    `Claim ${(stage.claim ?? 0) + 1}: could not check ${stage.source} — ` +
    `${reasonText(stage.reason)}`,
  figures: (stage) =>
    stage.figures
      ? `Found ${stage.figures} numbered figures in the paper`
      : 'Found no numbered figures in the paper',
  audited: (stage) =>
    stage.findings
      ? `Checked the results: ${stage.findings} to look at`
      : 'Checked the results: nothing to flag',
  done: () => 'Finished',
  error: (stage) => stage.message ?? 'Failed',
}

export function PipelineStages({ stages, running }: { stages: Stage[]; running: boolean }) {
  if (!stages.length) return null

  return (
    <ol className="space-y-1.5 text-sm" aria-live="polite" aria-busy={running}>
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1
        const pending = running && isLast
        return (
          <li key={index} className="flex items-center gap-2">
            {stage.stage === 'error' ? (
              <AlertCircle className="size-4 shrink-0 text-refutes" />
            ) : /* an audit that found something is not a green tick */
            stage.stage === 'failed' || (stage.stage === 'audited' && stage.findings) ? (
              <SearchX className="size-4 shrink-0 text-insufficient" />
            ) : pending ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-supports" />
            )}
            <span className={stage.stage === 'error' ? 'text-refutes' : 'text-ink-muted'}>
              {/* A stage this build does not know yet shows its name instead of crashing. */}
              {LABELS[stage.stage]?.(stage) ?? stage.stage}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
