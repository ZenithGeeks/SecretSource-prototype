/** Phase 0, docs/draft-editor-assessment.md: draftToDoc converts a mocked Draft's
 * DraftWord[][] into a ProseMirror doc. Covers the run-grouping (spacing at mark
 * boundaries), and the guessClaimId heuristic's known-good and known-null cases against
 * the real d1 fixtures — see the "PHASE 0 BRIDGE" warning in draftToProseMirror.ts for
 * why this is a heuristic, not a real link. */

import type { JSONContent } from '@tiptap/react'
import { expect, test } from 'vitest'

import { draftToDoc } from '../src/lib/draftToProseMirror'
import type { Draft, DraftWord } from '../src/lib/writer'
import { MOCK_CLAIMS, MOCK_DRAFTS } from '../src/mocks/writer'

const d1 = MOCK_DRAFTS.find((d) => d.id === 'd1')!
const d1Claims = MOCK_CLAIMS.filter((c) => c.draftId === 'd1')

function textOf(node: JSONContent): string {
  return (node.content ?? []).map((n) => n.text ?? '').join('')
}

function marksOf(node: JSONContent) {
  return (node.content ?? []).filter((n) => n.marks?.length)
}

test('paragraphs round-trip to the same words, with no missing/extra spaces at mark boundaries', () => {
  const doc = draftToDoc(d1, d1Claims)
  const paragraphTexts = doc.content!.map(textOf)

  expect(paragraphTexts[0]).toBe(
    'Late interaction retrievers encode queries and documents into token-level vectors and score them with MaxSim ' +
      '[Khattab & Zaharia, 2020]. ColBERTv2 further reduces index size by 6–10× while matching retrieval quality ' +
      '[Khattab & Zaharia, 2020]. On out-of-domain data these models outperform single-vector retrievers on BEIR ' +
      '[Thakur et al., 2021].',
  )
  expect(paragraphTexts[1]).toBe(
    'Denoised supervision from a cross-encoder teacher improves learned representations [Santhanam et al., 2022]. ' +
      'MS MARCO contains 8.8M passages [Nguyen et al., 2016].',
  )
})

test('guessClaimId links a marked run to its real claim by verdict + citation label', () => {
  const doc = draftToDoc(d1, d1Claims)
  const marks = [...marksOf(doc.content![0]), ...marksOf(doc.content![1])]

  const byText = (needle: string) => marks.find((m) => m.text?.includes(needle))!

  expect(byText('reduces index size').marks![0].attrs).toEqual({ verdict: 'refutes', claimId: 'c1' })
  expect(byText('outperform single-vector').marks![0].attrs).toEqual({ verdict: 'insufficient', claimId: 'c2' })
  expect(byText('Nguyen et al., 2016').marks![0].attrs).toEqual({ verdict: 'supports', claimId: 'c3' })
})

test('guessClaimId leaves a decorative same-citation mention unlinked (no claim shares its verdict)', () => {
  const doc = draftToDoc(d1, d1Claims)
  const marks = marksOf(doc.content![0])
  // "[Khattab & Zaharia, 2020]" appears twice: once as a plain "supports" citation mention
  // (no claim has that citation at verdict "supports"), once as the real "refutes" run (c1).
  const decorative = marks.find((m) => m.text === '[Khattab & Zaharia, 2020].')!
  expect(decorative.marks![0].attrs).toEqual({ verdict: 'supports', claimId: null })
})

test('an unmarked word stays a plain text node with no marks', () => {
  const words: DraftWord[] = [{ text: 'Hello' }, { text: 'world' }]
  const draft = { ...d1, paragraphs: [words] } as Draft
  const doc = draftToDoc(draft, [])
  expect(doc.content![0].content).toEqual([{ type: 'text', text: 'Hello world' }])
})
