import assert from 'node:assert/strict'
import test from 'node:test'

import { ALL_VERDICTS, VERDICTS, VERDICT_ORDER, isLowConfidence, isOpenIssue, labelRepeatsCounts, projectStatus, settledHint, statusLabel, statusTone, summarize } from '../src/lib/verdict.ts'
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

test('statusLabel follows the counts: "all supported" only when every checked citation is (#727)', () => {
  const kept = { kind: 'overridden' as const, note: 'kept as written', at: new Date().toISOString() }
  const label = (citations: { verdict: Verdict; resolution?: typeof kept }[]) => statusLabel(summarize(citations))
  assert.equal(label([{ verdict: 'supports' }, { verdict: 'supports' }]), 'all supported')
  assert.equal(label([{ verdict: 'unavailable' }, { verdict: 'unavailable' }]), '2 unavailable')
  assert.equal(label([{ verdict: 'refutes' }, { verdict: 'insufficient' }]), '2 issues')
  assert.equal(label([{ verdict: 'refutes', resolution: kept }]), 'no open issues')
  assert.equal(label([{ verdict: 'supports' }, { verdict: 'unavailable' }]), '1 unavailable')
  assert.equal(label([{ verdict: 'supports' }, { verdict: 'refutes', resolution: kept }, { verdict: 'unavailable' }]), '1 unavailable')
  assert.equal(label([{ verdict: 'supports' }, { verdict: 'refutes' }, { verdict: 'unavailable' }]), '1 issue')
  assert.equal(label([{ verdict: 'supports' }, { verdict: 'refutes', resolution: kept }]), 'no open issues')
})

test('settledHint says what the counts say when nothing needs work (#727)', () => {
  const kept = { kind: 'overridden' as const, note: 'kept as written', at: new Date().toISOString() }
  assert.equal(settledHint(summarize([{ verdict: 'supports' }])), 'Every checked citation holds up.')
  assert.equal(settledHint(summarize([{ verdict: 'unavailable' }, { verdict: 'unavailable' }])), '2 citations could not be checked.')
  assert.equal(settledHint(summarize([{ verdict: 'supports' }, { verdict: 'unavailable' }])), '1 citation could not be checked.')
  assert.equal(settledHint(summarize([{ verdict: 'refutes', resolution: kept }])), 'Every citation that needed work is resolved.')
  assert.equal(settledHint(summarize([])), 'Re-check to verify every \\cite against its source.')
  assert.equal(labelRepeatsCounts(summarize([{ verdict: 'supports' }, { verdict: 'unavailable' }])), true)
  assert.equal(labelRepeatsCounts(summarize([{ verdict: 'refutes' }, { verdict: 'unavailable' }])), false)
  assert.equal(labelRepeatsCounts(summarize([{ verdict: 'supports' }])), false)
})

test('statusTone colours the label by the same counts: green only when all are supported (#727)', () => {
  const kept = { kind: 'overridden' as const, note: 'kept as written', at: new Date().toISOString() }
  assert.equal(statusTone(summarize([{ verdict: 'supports' }])), 'text-supports')
  assert.equal(statusTone(summarize([{ verdict: 'unavailable' }])), 'text-ink-muted')
  assert.equal(statusTone(summarize([{ verdict: 'supports' }, { verdict: 'unavailable' }])), 'text-ink-muted')
  assert.equal(statusTone(summarize([{ verdict: 'refutes', resolution: kept }])), 'text-ink-muted')
  assert.equal(statusTone(summarize([{ verdict: 'refutes' }])), 'text-refutes')
  assert.equal(statusTone(summarize([])), 'text-ink-muted')
})

test('projectStatus reads a project card as one draft status', () => {
  const tally = { supports: 3, refutes: 0, insufficient: 0, unavailable: 2, unchecked: 1 }
  assert.deepEqual(projectStatus({ tally, needWork: 0 }), { checked: 5, counts: tally, open: 0 })
  assert.equal(statusLabel(projectStatus({ tally, needWork: 0 })), '2 unavailable')
})
