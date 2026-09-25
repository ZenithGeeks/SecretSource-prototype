import { describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', () => ({ request }))
vi.mock('../src/lib/teacherStore', () => ({ store: {} }))

import { createRemoteTeacherApi, teacherEssayCheckKey } from '../src/lib/teacher'

describe('remote Teacher API', () => {
  it('uses the Classroom essay-check routes instead of the browser mock store', async () => {
    const api = createRemoteTeacherApi()
    const essay = { assignment: { assignmentId: 'work-1' }, student: { id: 'student-1' } }
    request.mockResolvedValue(essay)

    await api.getEssayCheck('work-1', 'student-1', 'course-1')
    await api.updateProfessorReview({
      courseId: 'course-1', assignmentId: 'work-1', studentId: 'student-1',
      reviewId: 'citation-1', outcome: 'supports', note: 'Checked.',
    })
    await api.saveFeedback({
      courseId: 'course-1', assignmentId: 'work-1', studentId: 'student-1',
      body: 'Good work.', citationIds: ['citation-1'],
    })
    await api.sendFeedback({
      courseId: 'course-1', assignmentId: 'work-1', studentId: 'student-1',
      body: 'Good work.', citationIds: ['citation-1'],
    })
    await api.analyzeSubmission({ courseId: 'course-1', assignmentId: 'work-1', studentId: 'student-1' })

    expect(request).toHaveBeenNthCalledWith(
      1, '/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check',
    )
    expect(request).toHaveBeenNthCalledWith(
      2, '/teacher/classes/course-1/assignments/work-1/essay-check/reviews/citation-1',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'student-1', outcome: 'supports', note: 'Checked.' }) },
    )
    expect(request).toHaveBeenNthCalledWith(
      3, '/teacher/classes/course-1/assignments/work-1/essay-check/feedback',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'student-1', body: 'Good work.', citationIds: ['citation-1'] }) },
    )
    expect(request).toHaveBeenNthCalledWith(
      4, '/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'student-1', body: 'Good work.', citationIds: ['citation-1'] }) },
    )
    expect(request).toHaveBeenNthCalledWith(
      5, '/teacher/classes/course-1/assignments/work-1/students/student-1/analyze', { method: 'POST' },
    )
  })

  it('keeps essay checks from different courses in separate cache entries', () => {
    expect(teacherEssayCheckKey('course-1', 'work-1', 'student-1')).not.toEqual(
      teacherEssayCheckKey('course-2', 'work-1', 'student-1'),
    )
  })
})
