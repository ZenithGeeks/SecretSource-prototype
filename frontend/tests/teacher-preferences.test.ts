import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getTeacherPreferences,
  resetTeacherPreferences,
  updateTeacherPreferences,
} from '../src/lib/teacherPreferences.ts'

test('teacher preferences merge updates without dropping defaults', () => {
  resetTeacherPreferences()
  updateTeacherPreferences({ hideStudentNames: true })
  assert.equal(getTeacherPreferences().hideStudentNames, true)
  assert.equal(getTeacherPreferences().citationStyle, 'APA 7th')
})

test('teacher preferences reset to local defaults', () => {
  updateTeacherPreferences({ weeklyDigest: false, defaultClassId: 'class-modern-writing-1a' })
  resetTeacherPreferences()
  const preferences = getTeacherPreferences()
  assert.equal(preferences.weeklyDigest, true)
  assert.equal(preferences.defaultClassId, 'class-literary-2b')
  assert.equal(preferences.batchFinishedNotification, true)
})
