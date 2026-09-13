/** How a cited work is written and linked, wherever the app shows one. */

import type { Citation } from './api'

/** "Khattab et al. (2020). ColBERT: ..." */
export function reference({ authors, year, title, arxiv }: Citation) {
  const who = authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : 'Unknown'
  return `${who}${year ? ` (${year})` : ''}. ${title || (arxiv ? `arXiv:${arxiv}` : 'Untitled')}`
}

/** Where this work lives, preferring the identifier that resolves exactly. */
export function citationLink({ doi, arxiv, url }: Citation) {
  if (doi) return `https://doi.org/${doi}`
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`
  return url || ''
}
