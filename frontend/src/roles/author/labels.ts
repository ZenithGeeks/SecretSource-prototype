/** The little wording helpers the Author cards share (kept out of the component files so
 * fast refresh keeps working). */

import type { Citation } from '../../types/draftCheck'

/** "Khattab & Zaharia, 2020" or the bare key when nothing resolved. */
export function sourceLabel(c: Citation): string {
  return c.sourceRef ? `${c.sourceRef.authors}${c.sourceRef.year ? `, ${c.sourceRef.year}` : ''}` : `\\cite{${c.key}}`
}

/** "1 issue" · "3 issues". */
export function issues(n: number): string {
  return `${n} issue${n === 1 ? '' : 's'}`
}
