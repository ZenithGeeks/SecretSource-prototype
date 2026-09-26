import assert from 'node:assert/strict'
import test from 'node:test'

import { pickMatching } from '../src/lib/utils.ts'

const defaults = { theme: 'Match system', weeklyDigest: true, digestDay: 'Monday' }

test('pickMatching keeps only keys the defaults have, with a matching type', () => {
  assert.deepEqual(pickMatching(defaults, { theme: 'Dark', weeklyDigest: true }), {
    theme: 'Dark',
    weeklyDigest: true,
  })
})

test('pickMatching drops keys with the wrong type instead of throwing', () => {
  assert.deepEqual(pickMatching(defaults, { theme: 42, digestDay: 'Friday' }), { digestDay: 'Friday' })
})

test('pickMatching drops keys the defaults do not have', () => {
  assert.deepEqual(pickMatching(defaults, { theme: 'Light', notAField: true }), { theme: 'Light' })
})

test('pickMatching returns nothing for non-object input', () => {
  assert.deepEqual(pickMatching(defaults, null), {})
  assert.deepEqual(pickMatching(defaults, ['not', 'an', 'object']), {})
  assert.deepEqual(pickMatching(defaults, 'nope'), {})
})
