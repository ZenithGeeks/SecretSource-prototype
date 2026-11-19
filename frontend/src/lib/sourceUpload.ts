/** An owner-uploaded PDF for one citation, and the re-check that follows it (#986). */

import type { Citation, Stage } from './api'

type Recheck = 'rechecking' | 'rechecked' | 'recheck-failed'

function asRecheck(stage: string): Recheck | undefined {
  if (stage === 'rechecking' || stage === 'rechecked' || stage === 'recheck-failed') return stage
  return undefined
}

/** The latest re-check stage for one reference, if a re-check has started. `recheck-failed` is
 * finished, the same as `rechecked`: the check stopped, it did not produce a new verdict. */
export function recheckStage(stages: Stage[], ref: string): Recheck | undefined {
  let last: Recheck | undefined
  for (const stage of stages) {
    const kind = stage.ref === ref ? asRecheck(stage.stage) : undefined
    if (kind) last = kind
  }
  return last
}

/** References whose re-check has started and not yet finished, in the order they started. */
export function refsRechecking(stages: Stage[]): string[] {
  const last = new Map<string, Recheck>()
  for (const stage of stages) {
    if (!stage.ref) continue
    const kind = asRecheck(stage.stage)
    if (kind) last.set(stage.ref, kind)
  }
  return [...last.entries()].filter((entry) => entry[1] === 'rechecking').map((entry) => entry[0])
}

/** What to tell the owner when the latest re-check of this reference failed. */
export function recheckFailure(stages: Stage[], ref: string): string | undefined {
  if (recheckStage(stages, ref) !== 'recheck-failed') return undefined
  let message: string | undefined
  for (const stage of stages) {
    if (stage.ref === ref && stage.stage === 'recheck-failed') message = stage.message
  }
  return message ?? 'Checking the uploaded PDF failed. You can upload it again.'
}

/** Whether this citation's verdict was read from a PDF the owner uploaded. */
export function fromUploadedPdf(pdfs: Record<string, string> | undefined, citation?: Citation) {
  const ref = citation?.ref
  if (!ref || !pdfs) return false
  return Boolean(pdfs[ref])
}

/** What to tell the owner when the upload is refused. 413 and 422 name the limit and the file type;
 * anything else stays one sentence, since the gateway's body is not written for this screen. */
export function sourceUploadMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.startsWith('413')) return 'That PDF is over 100 MB. Choose a smaller file.'
  if (text.startsWith('422')) return 'That file is not a PDF.'
  return 'The PDF could not be uploaded. Try again.'
}
