import assert from 'node:assert/strict'
import test from 'node:test'

import { settingsRequested } from '../src/lib/settingsDeepLink.ts'

test('a legacy ?screen=settings link asks for the Settings modal', () => {
  assert.equal(settingsRequested('?screen=settings'), true)
  assert.equal(settingsRequested('?role=researcher&screen=settings'), true)
  assert.equal(settingsRequested('screen=settings'), true)
})

test('anything else does not', () => {
  assert.equal(settingsRequested(''), false)
  assert.equal(settingsRequested('?screen=home'), false)
  assert.equal(settingsRequested('?screen=settings-x'), false)
  assert.equal(settingsRequested('?analysis=abc'), false)
})
