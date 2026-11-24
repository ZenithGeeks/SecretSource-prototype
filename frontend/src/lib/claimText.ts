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
export function printedMarkers(sentence: string, markers: { ref: string; text: string }[]): string {
  const printed = new Map(markers.map((marker) => [marker.ref, marker.text.trim()]))
  return sentence.replace(/\[(b\d+)\]/g, (whole, ref: string) => {
    const text = printed.get(ref)
    if (!text) return whole
    return /^[[(]/.test(text) ? text : `[${text}]`
  })
}

/** The number the paper prints for a reference, "[14]", or "" when its markers do not say.
 * Never GROBID's "[b13]", which the PDF beside it does not show. */
export function printedRef(reference: { ref?: string }, markers: { ref: string; text: string }[] = []): string {
  if (!reference.ref) return ''
  const id = `[${reference.ref}]`
  const printed = printedMarkers(id, markers)
  return printed === id ? '' : printed
}
