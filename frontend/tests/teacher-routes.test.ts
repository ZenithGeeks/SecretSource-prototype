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
  assert.deepEqual(teacherRouteForNav('classes'), { screen: 'classes' })
})

test('legacy coursework identifiers are translated by the route parser', () => {
  const route = parseTeacherRoute('essay-check/coursework-assignment-2/student-anan')

  assert.equal(route.screen, 'essay-check')
  assert.equal(route.assignmentId, 'coursework-assignment-2')
})

test('teacher navigation matches the Figma destinations without Library or Graph', () => {
  assert.deepEqual(TEACHER_NAV_KEYS, ['home', 'classes', 'history', 'settings'])
  assert.equal(teacherNavForScreen('essay-check'), 'classes')
  assert.equal(teacherNavForScreen('history'), 'history')
  assert.equal(teacherNavForScreen('reading-questions'), null)
  assert.deepEqual(parseTeacherRoute('?role=teacher&screen=graph'), { screen: 'home' })
})

test('teacher History keeps the selected class, assignment, and student in the URL', () => {
  const route: TeacherRoute = {
    screen: 'history',
    courseId: 'class-2b',
    assignmentId: 'essay',
    studentId: 'anan',
  }

  assert.equal(
    serializeTeacherRoute(route),
    '?role=teacher&screen=history&courseId=class-2b&assignmentId=essay&studentId=anan',
  )
  assert.deepEqual(
    parseTeacherRoute('?role=teacher&screen=history&courseId=class-2b&assignmentId=essay&studentId=anan'),
    route,
  )
})
