import assert from 'node:assert/strict'
import test from 'node:test'

import { store as teacherStore } from '../src/lib/teacherStore.ts'
import { MOCK_TEACHER_READING_QUESTIONS, createMockReadingQuestions } from '../src/mocks/teacher.ts'

test('generated IDs stay distinct when a type is removed from the request', () => {
  const allTypes = createMockReadingQuestions({
    paperId: 'paper-colbert',
    level: 'undergrad',
    types: ['comprehension', 'critique', 'discussion'],
  })
  const critiqueOnly = createMockReadingQuestions({
    paperId: 'paper-colbert',
    level: 'undergrad',
    types: ['critique'],
  })

  assert.equal(new Set(allTypes.map((question) => question.id)).size, allTypes.length)
  assert.notEqual(allTypes[0]?.id, critiqueOnly[0]?.id)
  assert.match(critiqueOnly[0]?.id ?? '', /critique/)
})

test('graduate generation returns graduate-level wording and records', () => {
  const undergrad = createMockReadingQuestions({
    paperId: 'paper-colbert',
    level: 'undergrad',
    types: ['comprehension', 'critique', 'discussion'],
  })
  const graduate = createMockReadingQuestions({
    paperId: 'paper-colbert',
    level: 'graduate',
    types: ['comprehension', 'critique', 'discussion'],
  })

  assert.equal(graduate.length, 5)
  assert.ok(graduate.every((question) => question.level === 'graduate'))
  assert.notEqual(graduate[0]?.prompt, undergrad[0]?.prompt)
  assert.ok(graduate.every((question) => question.prompt.includes('ColBERT')))
})

test('the fixture gives every question a passage and an answer-key page check', () => {
  assert.equal(MOCK_TEACHER_READING_QUESTIONS.questions.length, 5)
  assert.ok(MOCK_TEACHER_READING_QUESTIONS.questions.every((question) => question.excerpt))
  assert.ok(MOCK_TEACHER_READING_QUESTIONS.questions.every((question) => question.answer))
})

test('teacher store returns a clone of the reading-question page', () => {
  const page = teacherStore.getReadingQuestions()
  const originalPrompt = page.questions[0]?.prompt
  if (!page.questions[0] || !originalPrompt) throw new Error('Fixture must include a first question.')

  page.questions[0].prompt = 'caller mutation'

  assert.equal(teacherStore.getReadingQuestions().questions[0]?.prompt, originalPrompt)
})
