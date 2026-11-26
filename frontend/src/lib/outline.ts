/** The analysed paper's sections (#152), shaped for the table of contents (#153). */

import type { Claim, OutlineEntry } from './api'
import { standingOf } from './claims'

export type ContentsRow = OutlineEntry & {
  depth: number // 0 for "3", 1 for "3.1", 2 for "4.1.3"
  claims: number // claims whose sentence is in this section itself, not in its subsections
  contradicted: number // how many of those claims a source contradicts
}

/** Every top-level section, and a subsection only when a claim comes from it, so a long paper
 * keeps a short table of contents. `counted` are the claims a filter leaves: the rows stay those
 * of all `claims`, and each counts only its `counted` ones. */
export function contentsRows(outline: OutlineEntry[], claims: Claim[], counted: Claim[] = claims): ContentsRow[] {
  return outline
    .filter((entry) => !entry.n.includes('.') || claims.some((claim) => claim.section === entry.n))
    .map((entry) => {
      const own = counted.filter((claim) => claim.section === entry.n)
      return {
        ...entry,
        depth: entry.n.split('.').length - 1,
        claims: own.length,
        contradicted: own.filter((claim) => standingOf(claim) === 'refutes').length,
      }
    })
}

/** The row to mark for a section: the section itself, or the nearest shown section it is
 * part of ("3.4" with no claims marks "3"). */
export function shownRow(rows: ContentsRow[], section: string | null): string | null {
  if (!section) return null
  const parts = section.split('.')
  for (let length = parts.length; length > 0; length -= 1) {
    const n = parts.slice(0, length).join('.')
    if (rows.some((row) => row.n === n)) return n
  }
  return null
}

/** The section a page belongs to: the last heading on or before that page. */
export function sectionOfPage(outline: OutlineEntry[], page: number): string | null {
  const before = outline.filter((entry) => entry.page <= page)
  return before.length ? before[before.length - 1].n : null
}

/** "Section 3.3 · Representation", or "Section 3.3" when the outline no longer has it. */
export function sectionName(outline: OutlineEntry[], n: string) {
  const entry = outline.find((item) => item.n === n)
  return entry ? `Section ${n} · ${entry.title}` : `Section ${n}`
}
