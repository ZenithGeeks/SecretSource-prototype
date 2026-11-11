/** How a cited work is written and linked, wherever the app shows one. */

import type { Citation } from './api'

/** "Khattab et al. (2020). ColBERT: ..." */
export function reference({ authors, year, title, venue, arxiv }: Citation) {
  const who = authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : 'Unknown'
  const head = `${who}${year ? ` (${year})` : ''}`
  // "et al." already ends with a full stop; a second one reads as a typo.
  // A work whose reference list gave no title is written by its journal (#937).
  return `${head}${head.endsWith('.') ? '' : '.'} ${title || venue || (arxiv ? `arXiv:${arxiv}` : 'Untitled')}`
}

/** The number the paper prints for this work, like "13", or empty. Author-year labels
 * ("Khattab et al., 2020") are not numbers and are left out: the reference line already
 * shows the author and year. */
export function citationNumber({ label }: Citation) {
  return label && /^\d+[a-z]?$/i.test(label) ? label : ''
}

/** Where this work lives, preferring the identifier that resolves exactly. */
export function citationLink({ doi, arxiv, url }: Citation) {
  if (doi) return `https://doi.org/${doi}`
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`
  return url || ''
}

/** "checked against the arXiv preprint 2507.11408". A preprint's wording or numbers can
 * differ from the published paper, so a verdict read from one says so (#424). */
export function preprintNote(arxiv?: string) {
  return `checked against the arXiv preprint${arxiv ? ` ${arxiv}` : ''}`
}

const MESSAGE_LIMIT = 140

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

/** Why a source could not be read, fit for one line. A citation's `message` can be whatever a
 * server answered, such as a whole Cloudflare error page: that becomes a summary, and anything
 * else loses its tags and is cut short. */
export function shortMessage(message: string | undefined): string {
  if (!message) return ''
  if (/<(!doctype|html|head|body)\b/i.test(message)) {
    const title = /<title[^>]*>([^<]*)/i.exec(message)?.[1].replace(/\s+/g, ' ').trim()
    return title ? `the server sent an error page (${clip(title, 60)})` : 'the server sent an error page'
  }
  return clip(message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), MESSAGE_LIMIT)
}
