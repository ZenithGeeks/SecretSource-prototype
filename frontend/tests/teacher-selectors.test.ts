import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assignmentCanBeChecked,
  filterTeacherClasses,
  filterTeacherPeople,
  feedbackPreview,
  getTeacherAssignmentSummary,
  getTeacherWorkspaceTab,
  homeRouteForAction,
  toggleFeedbackReview,
  filterReadingQuestions,
  classResultsCsv,
  worksheetText,
  workspaceStats,
} from '../src/lib/teacherSelectors.ts'
import { MOCK_TEACHER_CLASSES, MOCK_TEACHER_HOME, MOCK_TEACHER_WORKSPACE } from '../src/mocks/teacher.ts'

test('class selector matches course title, section, and room', () => {
  assert.equal(filterTeacherClasses(MOCK_TEACHER_CLASSES, 'literary').length, 1)
  assert.equal(filterTeacherClasses(MOCK_TEACHER_CLASSES, '2b')[0]?.id, 'class-literary-2b')
  assert.equal(filterTeacherClasses(MOCK_TEACHER_CLASSES, '').length, MOCK_TEACHER_CLASSES.length)
})

test('workspace selector returns the requested tab and assignment summary', () => {
  assert.equal(getTeacherWorkspaceTab(MOCK_TEACHER_WORKSPACE, 'people').title, 'People')

  const summary = getTeacherAssignmentSummary(MOCK_TEACHER_WORKSPACE.assignments[0])
  assert.deepEqual(summary, { submitted: 19, missing: 6, total: 25 })
})

test('workspace stats reflect the four classwork cards in the reference state', () => {
  assert.deepEqual(workspaceStats(MOCK_TEACHER_WORKSPACE), { classworkCount: 4, submissions: 66, returned: 8 })
  assert.equal(assignmentCanBeChecked(MOCK_TEACHER_WORKSPACE.assignments[0]!), true)
  assert.equal(filterTeacherPeople(MOCK_TEACHER_WORKSPACE.people, 'student').length, 5)
})

test('home actions open scoped teacher routes', () => {
  assert.deepEqual(homeRouteForAction('check-essays', MOCK_TEACHER_HOME), {
    screen: 'assignment-detail',
    courseId: 'class-literary-2b',
    assignmentId: 'assignment-essay',
  })
  assert.deepEqual(homeRouteForAction('reading-questions', MOCK_TEACHER_HOME), {
    screen: 'reading-questions',
    paperId: 'paper-colbert',
  })
})

test('feedback helpers keep citation selection unique and summarize the draft', () => {
  assert.deepEqual(toggleFeedbackReview(['review-colbert'], 'review-dpr'), ['review-colbert', 'review-dpr'])
  assert.deepEqual(toggleFeedbackReview(['review-colbert', 'review-dpr'], 'review-colbert'), ['review-dpr'])
  assert.equal(feedbackPreview('First line.\nSecond line.', ['p.7', 'p.6']), '“First line.” — 2 lines, cites p.7, p.6')
})

test('reading-question filters are derived without changing the source collection', () => {
  const page = { paper: { id: 'paper-colbert', title: 'ColBERT', citation: '2020', fileName: 'colbert.pdf', verifiedClaims: 1, paperUrl: 'https://example.com' }, questions: [] }
  const questions = [
    { id: 'a', paperId: 'paper-colbert', level: 'undergrad' as const, type: 'comprehension' as const, prompt: 'undergrad', anchor: 'p.1', page: 1, excerpt: null, answer: 'answer' },
    { id: 'b', paperId: 'paper-colbert', level: 'graduate' as const, type: 'critique' as const, prompt: 'graduate', anchor: 'p.2', page: 2, excerpt: null, answer: 'answer' },
  ]
  assert.equal(filterReadingQuestions(questions, 'undergrad', ['comprehension']).length, 1)
  assert.equal(questions.length, 2)
  assert.match(worksheetText({ ...page, questions }, false), /undergrad/)
  assert.doesNotMatch(worksheetText({ ...page, questions }, false), /answer/)
})

test('class results export is escaped CSV', () => {
  const csv = classResultsCsv({
    ...MOCK_TEACHER_WORKSPACE,
    people: [{ id: 'student-quoted', name: 'A, Student', initials: 'AS', role: 'Student', isCourseOwner: false }],
  })
  assert.match(csv, /"A, Student","Student"/)
})
