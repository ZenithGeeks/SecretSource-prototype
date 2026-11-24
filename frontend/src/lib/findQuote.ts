/** Finds where a quote sits in a paper, for "Show in cited paper" and the other show-in-PDF links. */

import { api, type Source } from './api'

/**
 * Where `quote` sits in `paper`, or null when no page holds it.
 *
 * `page` is where the retrieved passage starts, and the quote can sit on the next page. The
 * gateway accepts a match that covers 80% of the quote's words, so a part match on the hinted
 * page is not proof the quote is there: unless that match is whole, the paper is searched too
 * and the better match wins, the hinted page on a tie.
 */
export async function findQuote(paper: string, quote: string, page?: number): Promise<Source | null> {
  const onPage = page ? await api.findInPaper(paper, quote, page).catch(() => null) : null
  const hinted = onPage?.page ? onPage : null
  if (hinted && (hinted.coverage ?? 0) >= 1) return hinted
  const found = await api.findInPaper(paper, quote).catch(() => null)
  const anywhere = found?.page ? found : null
  if (!hinted || !anywhere) return hinted ?? anywhere
  return (hinted.coverage ?? 0) >= (anywhere.coverage ?? 0) ? hinted : anywhere
}
