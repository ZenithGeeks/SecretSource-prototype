/** An owner-uploaded PDF for one citation, and the re-check that follows it (#986). */

import type { Citation, Stage } from './api'

/** The latest re-check stage for one reference, if a re-check has started. */
export function recheckStage(stages: Stage[], ref: string): 'rechecking' | 'rechecked' | undefined {
  let last: 'rechecking' | 'rechecked' | undefined
  for (const stage of stages) {
    if (stage.ref === ref && (stage.stage === 'rechecking' || stage.stage === 'rechecked')) last = stage.stage
  }
  return last
}

/** References whose re-check has started and not yet finished, in the order they started. */
export function refsRechecking(stages: Stage[]): string[] {
  const last = new Map<string, 'rechecking' | 'rechecked'>()
  for (const stage of stages) {
    if ((stage.stage === 'rechecking' || stage.stage === 'rechecked') && stage.ref) last.set(stage.ref, stage.stage)
  }
  return [...last.entries()].filter((entry) => entry[1] === 'rechecking').map((entry) => entry[0])
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
