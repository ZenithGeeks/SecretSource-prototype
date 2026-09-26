/** Helpers the two search surfaces (the Find sources card and the Find a source screen)
 * share, kept out of the component files so fast refresh keeps working. */

import type { SavedSource, SearchResult } from '../../types/draftCheck'

/** The results verified without being asked, at most two at a time (useVerification). */
export const AUTO_VERIFY = 3

/** Copies to the clipboard and says whether it worked — never "Copied!" with nothing copied
 * (a denied permission, an unfocused document, or plain http on a LAN address). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** What to say after a copy attempt. */
export function copiedMessage(ok: boolean, what: string): string {
  return ok ? `Copied ${what}` : 'Could not copy — the browser refused clipboard access'
}

/** The saved source a result is, if it was saved (same DOI, or same title). */
export function savedMatch(result: SearchResult, saved: SavedSource[] | undefined): SavedSource | undefined {
  const title = result.title.trim().toLowerCase()
  return saved?.find(
    (s) => (result.doi && s.doi?.toLowerCase() === result.doi.toLowerCase()) || s.title.trim().toLowerCase() === title,
  )
}
