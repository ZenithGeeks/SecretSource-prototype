import assert from 'node:assert/strict'
import test from 'node:test'

import { ALL_VERDICTS, VERDICTS, VERDICT_ORDER, isLowConfidence, isOpenIssue, statusLabel, summarize } from '../src/lib/verdict.ts'
import type { Verdict } from '../src/types/draftCheck.ts'

test('every verdict has words and colours, and the bar order covers every checked verdict', () => {
  for (const verdict of ALL_VERDICTS) {
    const meta = VERDICTS[verdict]
    assert.ok(meta.badge && meta.legend && meta.text && meta.fill && meta.soft, verdict)
  }
  assert.deepEqual([...VERDICT_ORDER, 'unchecked'].sort(), [...ALL_VERDICTS].sort())
  assert.equal(VERDICTS.unavailable.badge, VERDICTS.unchecked.badge)
})

test('isOpenIssue: refutes and insufficient are open until resolved; the rest never are', () => {
  const at = new Date().toISOString()
  assert.equal(isOpenIssue({ verdict: 'refutes' }), true)
  assert.equal(isOpenIssue({ verdict: 'insufficient' }), true)
  // unavailable is "no answer": the Library's Needs attention lists it (Upload PDF), the same
  // rule the gateway's summary uses, so both sides count the same open issues
  assert.equal(isOpenIssue({ verdict: 'unavailable' }), false)
  assert.equal(isOpenIssue({ verdict: 'supports' }), false)
  assert.equal(isOpenIssue({ verdict: 'unchecked' }), false)
  assert.equal(isOpenIssue({ verdict: 'refutes', resolution: { kind: 'overridden', at } }), false)
})

test('isLowConfidence: silent, a verdict with no passage, or one the audit flagged', () => {
  assert.equal(isLowConfidence({ verdict: 'insufficient' }), true)
  assert.equal(isLowConfidence({ verdict: 'refutes', evidence: { passage: '', pdf: 'a.pdf', page: 1 } }), true)
  assert.equal(isLowConfidence({ verdict: 'supports', evidence: { passage: 'it says so', pdf: 'a.pdf', page: 1 } }), false)
  assert.equal(isLowConfidence({ verdict: 'unavailable' }), false)
  const passage = { passage: 'a sentence the paper never wrote', pdf: 'a.pdf', page: 1 }
  const audit = [{ check: 'quote-not-in-evidence', detail: 'quote is not in the passages' }]
  assert.equal(isLowConfidence({ verdict: 'supports', evidence: passage, audit }), true)
})

test('summarize counts each verdict once and statusLabel says it in the drafts list words', () => {
  const verdicts: Verdict[] = ['supports', 'supports', 'refutes', 'insufficient', 'unavailable', 'unchecked']
  const status = summarize(verdicts.map((verdict) => ({ verdict })))
  assert.equal(status.checked, 5)
  assert.equal(status.open, 2)
  assert.deepEqual(status.counts, { supports: 2, insufficient: 1, refutes: 1, unavailable: 1, unchecked: 1 })
  assert.equal(statusLabel(status), '2 issues')
  assert.equal(statusLabel(summarize([{ verdict: 'supports' }])), 'all supported')
  assert.equal(statusLabel(summarize([{ verdict: 'refutes' }])), '1 issue')
  assert.equal(statusLabel(summarize([{ verdict: 'unchecked' }])), 'not checked')
  assert.equal(statusLabel(summarize([])), 'not checked')
})
