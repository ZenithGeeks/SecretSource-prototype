import assert from 'node:assert/strict'
import test from 'node:test'

import { ALL_VERDICTS, VERDICTS, VERDICT_ORDER, isOpenIssue, statusLabel, summarize } from '../src/lib/verdict.ts'
import type { Verdict } from '../src/types/draftCheck.ts'

test('every verdict has words and colours, and the bar order covers every checked verdict', () => {
  for (const verdict of ALL_VERDICTS) {
    const meta = VERDICTS[verdict]
    assert.ok(meta.badge && meta.legend && meta.text && meta.fill && meta.soft, verdict)
  }
  assert.deepEqual([...VERDICT_ORDER, 'unchecked'].sort(), [...ALL_VERDICTS].sort())
  assert.equal(VERDICTS.unavailable.badge, VERDICTS.unchecked.badge)
})

test('isOpenIssue: needs-work verdicts are open until resolved; supports and unchecked never are', () => {
  const at = new Date().toISOString()
  assert.equal(isOpenIssue({ verdict: 'refutes' }), true)
  assert.equal(isOpenIssue({ verdict: 'insufficient' }), true)
  assert.equal(isOpenIssue({ verdict: 'unavailable' }), true)
  assert.equal(isOpenIssue({ verdict: 'supports' }), false)
  assert.equal(isOpenIssue({ verdict: 'unchecked' }), false)
  assert.equal(isOpenIssue({ verdict: 'refutes', resolution: { kind: 'overridden', at } }), false)
})

test('summarize counts each verdict once and statusLabel says it in the drafts list words', () => {
  const verdicts: Verdict[] = ['supports', 'supports', 'refutes', 'insufficient', 'unavailable', 'unchecked']
  const status = summarize(verdicts.map((verdict) => ({ verdict })))
  assert.equal(status.checked, 5)
  assert.equal(status.open, 3)
  assert.deepEqual(status.counts, { supports: 2, insufficient: 1, refutes: 1, unavailable: 1, unchecked: 1 })
  assert.equal(statusLabel(status), '3 issues')
  assert.equal(statusLabel(summarize([{ verdict: 'supports' }])), 'all supported')
  assert.equal(statusLabel(summarize([{ verdict: 'refutes' }])), '1 issue')
  assert.equal(statusLabel(summarize([{ verdict: 'unchecked' }])), 'not checked')
  assert.equal(statusLabel(summarize([])), 'not checked')
})
