import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseTeacherRoute,
  serializeTeacherRoute,
  teacherNavForScreen,
  teacherRouteForNav,
  TEACHER_NAV_KEYS,
  type TeacherRoute,
} from '../src/lib/teacherRoutes.ts'

test('teacher routes use assignmentId at the screen boundary', () => {
  assert.deepEqual(parseTeacherRoute('?role=teacher&screen=assignment-detail&courseId=class-2b&assignmentId=essay&studentId=anan'), {
    screen: 'assignment-detail',
    courseId: 'class-2b',
    assignmentId: 'essay',
    studentId: 'anan',
  })
  assert.deepEqual(parseTeacherRoute('essay-check/assignment-2/student-anan'), {
    screen: 'essay-check',
    assignmentId: 'assignment-2',
    studentId: 'student-anan',
  })
  assert.deepEqual(parseTeacherRoute('classroom/course-cpe401/assignment/coursework-assignment-2'), {
    screen: 'assignment-detail',
    courseId: 'course-cpe401',
    assignmentId: 'coursework-assignment-2',
  })
})

test('teacher route serialization preserves explicit route state', () => {
  const route: TeacherRoute = {
    screen: 'reading-questions',
    paperId: 'paper-colbert',
  }

  assert.equal(serializeTeacherRoute(route), '?role=teacher&screen=reading-questions&paperId=paper-colbert')
  assert.equal(serializeTeacherRoute({ screen: 'home' }), '?role=teacher&screen=home')
})

test('serializing Home removes detail context but keeps the teacher role', () => {
  assert.equal(
    serializeTeacherRoute(
      { screen: 'home' },
      '?role=teacher&screen=essay-check&courseId=class-2b&assignmentId=essay&studentId=anan',
    ),
    '?role=teacher&screen=home',
  )
  assert.deepEqual(teacherRouteForNav('library'), { screen: 'reading-questions' })
})

test('legacy coursework identifiers are translated by the route parser', () => {
  const route = parseTeacherRoute('essay-check/coursework-assignment-2/student-anan')

  assert.equal(route.screen, 'essay-check')
  assert.equal(route.assignmentId, 'coursework-assignment-2')
})

test('teacher navigation includes the updated Figma destinations', () => {
  // Settings moved off the nav and into the shared Settings modal (Figma 22), opened from the
  // profile menu like every other role — teacher no longer has its own nav entry for it.
  assert.deepEqual(TEACHER_NAV_KEYS, ['home', 'classes', 'library', 'graph'])
  assert.equal(teacherNavForScreen('essay-check'), 'classes')
  assert.equal(teacherNavForScreen('reading-questions'), 'library')
})
