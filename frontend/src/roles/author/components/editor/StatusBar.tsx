/** The strip under the editor: the current file's verdict counts on the left, the cursor,
 * \cite count and warning count on the right. Counts are for the open file only. */

import { VerdictLegend } from '../../../../components/VerdictBar'
import type { CursorPosition } from './CodeEditor'
import type { Verdict } from '../../../../types/draftCheck'

export function StatusBar({
  counts,
  cursor,
  citeCount,
  warningCount,
}: {
  counts: Record<Verdict, number>
  cursor: CursorPosition
  citeCount: number
  warningCount: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1 border-t border-border-subtle bg-canvas px-3.5 py-1.5 text-caption">
      <VerdictLegend counts={counts} className="text-caption" />
      <p className="text-ink-muted" aria-live="polite">
        Ln {cursor.line}, Col {cursor.column} · {citeCount} \cite · {warningCount} warning{warningCount === 1 ? '' : 's'}
      </p>
    </div>
  )
}
