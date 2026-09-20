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
  assert.equal(getTeacherPreferences().sendReportsAs, 'Wittawat S.')
})

test('teacher preferences reset to local defaults', () => {
  updateTeacherPreferences({ defaultClassId: 'class-modern-writing-1a', studentReportVisibility: false })
  resetTeacherPreferences()
  const preferences = getTeacherPreferences()
  assert.equal(preferences.defaultClassId, 'class-literary-2b')
  assert.equal(preferences.studentReportVisibility, true)
})
