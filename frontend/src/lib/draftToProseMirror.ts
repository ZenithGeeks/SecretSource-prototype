/**
 * Converts a Draft's DraftWord[][] into a ProseMirror document (Phase 0 of the rich-text
 * editor work, docs/draft-editor-assessment.md). One paragraph node per DraftWord[], one
 * text node per contiguous run of words sharing the same mark (or no mark). A run's words
 * are joined with spaces, matching how DraftParagraph used to render them.
 */

import type { JSONContent } from '@tiptap/react'

import type { Claim, Draft, DraftWord, VerdictKind } from './writer'

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * PHASE 0 BRIDGE, NOT A REAL LINK. DraftWord has no claimId (mocks/writer.ts never modeled
 * one) — this guesses which claim a marked run belongs to by checking that the run's verdict
 * matches a claim's verdict AND the run's text contains that claim's citation label once both
 * are stripped to bare alphanumerics. It will pick the wrong claim (or none) if two claims
 * with the SAME verdict cite the SAME work inside one paragraph — there is nothing here to
 * disambiguate that case, it just returns the first match. Phase 1 must replace this with a
 * real claim id carried in the data (e.g. on DraftWord, or wherever claims get attached to
 * text going forward) instead of inferring it at render time from text + verdict alone.
 */
function guessClaimId(runText: string, verdict: VerdictKind, claims: Claim[]): string | null {
  const key = normalize(runText)
  const claim = claims.find((c) => c.verdict === verdict && c.citation && key.includes(normalize(c.citation.label)))
  return claim?.id ?? null
}

function paragraphToNode(words: DraftWord[], claims: Claim[]): JSONContent {
  const content: JSONContent[] = []
  let i = 0
  while (i < words.length) {
    const mark = words[i].mark
    let j = i + 1
    while (j < words.length && words[j].mark === mark) j++
    const text = words
      .slice(i, j)
      .map((w) => w.text)
      .join(' ')
    // A separate text node per run means ProseMirror never inserts the word-space that used
    // to come from each word being its own flex item — add it back explicitly between runs.
    if (content.length > 0) content.push({ type: 'text', text: ' ' })
    content.push(
      mark
        ? { type: 'text', text, marks: [{ type: 'claimVerdict', attrs: { verdict: mark, claimId: guessClaimId(text, mark, claims) } }] }
        : { type: 'text', text },
    )
    i = j
  }
  return { type: 'paragraph', content }
}

export function draftToDoc(draft: Draft, claims: Claim[]): JSONContent {
  return { type: 'doc', content: draft.paragraphs.map((words) => paragraphToNode(words, claims)) }
}
