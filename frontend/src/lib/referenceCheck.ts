/** What the index lookup of a cited DOI (#421) or title (#439) found, in words for the author. */

import type { Citation } from '../types/draftCheck'

/** The note about a citation's reference, or null when there is nothing to say: no lookup, or
 * a work an index knows and whose year and first author match the .bib entry. */
export function referenceNote(c: Pick<Citation, 'exists' | 'index' | 'mismatches' | 'lookedUpBy'>): string | null {
  const byTitle = c.lookedUpBy === 'title'
  if (c.exists === 'no' && byTitle) {
    return 'No index (Crossref, OpenAlex, arXiv or Semantic Scholar) lists a work with this title and first author, so the reference may not exist. Check the title, the authors and that the paper is real.'
  }
  if (c.exists === 'no') {
    return 'Neither Crossref nor OpenAlex knows this DOI, so the reference may not exist. Check the DOI and that the paper is real.'
  }
  if (c.exists === 'unknown') {
    return `The indexes could not be reached, so it is not known yet whether this ${byTitle ? 'work' : 'DOI'} exists.`
  }
  if (c.mismatches?.length) return `The .bib entry disagrees with ${c.index ?? 'the index'}: ${c.mismatches.join('; ')}.`
  return null
}
