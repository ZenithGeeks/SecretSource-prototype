/** The little wording helpers the Author cards share (kept out of the component files so
 * fast refresh keeps working). */

import type { Citation, SearchResult } from '../../types/draftCheck'

/** The search box's id, so "Find a source" up top can scroll to it and focus it. */
export const FIND_SOURCES_INPUT_ID = 'author-find-sources'

/** "Khattab & Zaharia, 2020" or the bare key when nothing resolved. */
export function sourceLabel(c: Citation): string {
  return c.sourceRef ? `${c.sourceRef.authors}${c.sourceRef.year ? `, ${c.sourceRef.year}` : ''}` : `\\cite{${c.key}}`
}

/** "Santhanam 2022" — the short form on the Replace button. */
export function replacementLabel(r: Pick<SearchResult, 'authors' | 'year' | 'key'>): string {
  const first = r.authors.replace(/ et al\.$/, '').replace(/ & .*$/, '')
  return first ? `${first}${r.year ? ` ${r.year}` : ''}` : r.key
}

/** "cited 1.2k" past a thousand, as the design abbreviates it. */
export function citedBy(n: number | null): string {
  if (n === null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
}

/** "1 issue" · "3 issues". */
export function issues(n: number): string {
  return `${n} issue${n === 1 ? '' : 's'}`
}
