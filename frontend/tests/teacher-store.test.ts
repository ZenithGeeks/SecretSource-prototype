import assert from 'node:assert/strict'
import test from 'node:test'

import { resetTeacherStore, teacherStore } from '../src/lib/teacherStore.ts'

test('teacher store supports class import and assignment refresh', async () => {
  resetTeacherStore()

  const imported = await teacherStore.importClass('class-research-methods-3a')
  assert.equal(imported.id, 'class-research-methods-3a')

  const classes = await teacherStore.getClasses()
  assert.ok(classes.some((course) => course.id === 'class-research-methods-3a'))

  const assignments = await teacherStore.getAssignments('class-literary-2b')
  assert.ok(assignments.length > 0)
  assert.equal(assignments[0]?.courseId, 'class-literary-2b')
})

test('teacher store returns no preview and rejects an unknown import', async () => {
  resetTeacherStore()
  assert.equal(await teacherStore.getClassImportPreview('class-does-not-exist'), null)
  await assert.rejects(() => teacherStore.importClass('class-does-not-exist'), /could not be found/)
})

test('teacher store updates feedback and reading question drafts without leaking references', async () => {
  resetTeacherStore()

  const detail = await teacherStore.getEssayCheck('assignment-essay', 'student-anan')
  assert.ok(detail)
  if (!detail) return

  await teacherStore.saveFeedback('assignment-essay', 'student-anan', {
    body: 'Please revise the evidence.',
    citationIds: ['review-colbert'],
  })
  const updated = await teacherStore.getEssayCheck('assignment-essay', 'student-anan')
  assert.equal(updated?.feedback.body, 'Please revise the evidence.')

  const questions = await teacherStore.getReadingQuestions('paper-colbert')
  questions.questions[0]!.prompt = 'caller mutation'
  const fresh = await teacherStore.getReadingQuestions('paper-colbert')
  assert.notEqual(fresh.questions[0]?.prompt, 'caller mutation')
})

test('updating a professor result changes only the selected review', async () => {
  resetTeacherStore()
  const updated = await teacherStore.updateProfessorReview({
    assignmentId: 'assignment-essay',
    studentId: 'student-anan',
    reviewId: 'review-colbert',
    outcome: 'contradicts',
    note: 'Verified against page 7.',
  })
  assert.equal(updated.reviews.find((review) => review.id === 'review-colbert')?.professorReview.outcome, 'contradicts')
  assert.equal(updated.reviews.find((review) => review.id === 'review-dpr')?.professorReview.outcome, 'not-reviewed')
})

test('teacher history merges new activity into the existing submission', async () => {
  resetTeacherStore()
  const before = await teacherStore.getHistory()
  const ananBefore = before.find((entry) => entry.studentId === 'student-anan')
  assert.ok(ananBefore)

  await teacherStore.saveFeedback('assignment-essay', 'student-anan', {
    body: 'Please revise the evidence.',
    citationIds: ['review-colbert'],
  })

  const after = await teacherStore.getHistory()
  const ananAfter = after.filter((entry) => entry.studentId === 'student-anan')
  assert.equal(ananAfter.length, 1)
  assert.equal(ananAfter[0]?.submissionId, ananBefore?.submissionId)
  assert.deepEqual(ananAfter[0]?.activity, ['analysis', 'feedback'])
})

test('reading question mutations regenerate, edit, and remove local records', async () => {
  resetTeacherStore()
  const regenerated = await teacherStore.regenerateReadingQuestions({ paperId: 'paper-colbert', level: 'graduate', types: ['critique'] })
  assert.ok(regenerated.questions.length > 0)
  const first = regenerated.questions[0]!
  await teacherStore.updateReadingQuestion({ id: first.id, prompt: 'Edited prompt', answer: 'Edited answer' })
  assert.equal((await teacherStore.getReadingQuestions()).questions[0]?.prompt, 'Edited prompt')
  await teacherStore.deleteReadingQuestion(first.id)
  assert.equal((await teacherStore.getReadingQuestions()).questions.some((question) => question.id === first.id), false)
  resetTeacherStore()
})
