import type { CitationMarker } from './api'

/**
 * Claim text as a reader sees it. Claims are extracted with their citation markers taken out,
 * which leaves the punctuation around them behind: "Inspired by,,, Yuan et al." or "priors-.".
 * This tidies the shown text only; the stored claim, and what an edit starts from, stay as they are.
 */

export function tidyClaim(text: string): string {
  return text
    .replace(/\(\s*[,;\s]*\)/g, '') // "()" or "( , )" where markers stood
    .replace(/\s*,(?:\s*,)+/g, ',') // ",,," -> ","
    .replace(/-(?=[.,;:])/g, '') // "priors-." -> "priors."
    .replace(/\s+([.,;:])/g, '$1') // "word ." -> "word."
    .replace(/,+(?=[.;:])/g, '') // ",." -> "."
    .replace(/(?<!\.)\.\.(?!\.)/g, '.') // ".." -> ".", an ellipsis stays
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * A sentence with each "[b12]" marker (GROBID's id for a reference) replaced by what the paper
 * prints there, e.g. "[13]", from the paper's citation markers. A marker the paper's markers do
 * not cover stays as it is: a guessed number would be worse than an id.
 */
type PrintedMarker = Pick<CitationMarker, 'ref' | 'text'> & Partial<Pick<CitationMarker, 'page' | 'x0' | 'y0' | 'x1' | 'y1'>>

export function printedMarkers(sentence: string, markers: PrintedMarker[]): string {
  // The extractor copies the text and box to every reference in a grouped citation.
  const boxKey = ({ page, x0, y0, x1, y1, text }: PrintedMarker) =>
    JSON.stringify([page, x0, y0, x1, y1, text.trim()])
  const boxes = new Map<string, string>()
  for (const marker of markers) {
    const key = boxKey(marker)
    const first = boxes.get(key)
    boxes.set(key, first === undefined || first === marker.ref ? marker.ref : '')
  }
  const printed = new Map<string, string>()
  for (const marker of markers) {
    const text = marker.text.trim()
    // Numeric lists and ranges are ambiguous even if another target was discarded upstream.
    if (!text || boxes.get(boxKey(marker)) !== marker.ref || /^\[?\s*\d+[a-z]?\s*[,;–—-]\s*\d/i.test(text)) continue
    const value = /^[[(]/.test(text) ? text : `[${text}]`
    const previous = printed.get(marker.ref)
    printed.set(marker.ref, previous === undefined || previous === value ? value : '')
  }
  return sentence.replace(/\[(b\d+)\]/g, (whole, ref: string) => {
    return printed.get(ref) || whole
  })
}

/** The number the paper prints for a reference, "[14]", or "" when its markers do not say.
 * Never GROBID's "[b13]", which the PDF beside it does not show. */
export function printedRef(reference: { ref?: string }, markers: PrintedMarker[] = []): string {
  if (!reference.ref) return ''
  const id = `[${reference.ref}]`
  const printed = printedMarkers(id, markers)
  return printed === id ? '' : printed
}
