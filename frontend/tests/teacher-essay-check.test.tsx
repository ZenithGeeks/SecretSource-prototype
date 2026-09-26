import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }))

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherEssayCheck: () => ({
    isPending: false,
    isError: false,
    data: {
      assignment: { assignmentId: 'work-1', courseId: 'course-1', course: 'Course', name: 'Essay' },
      student: { id: 'student-1', name: 'Student', fileName: 'essay.pdf' },
      citationSummary: { total: 0, contradicted: 0, silent: 0, backed: 0 },
      reviews: [],
      feedback: { body: '', preview: '', citedPages: [], citationIds: [] },
      navigation: {},
      analysis: { id: null, status: 'missing', error: null },
    },
  }),
  useTeacherGoogleConnection: () => ({ data: { connected: false, email: null, scopes: [] }, isPending: false, isError: false }),
  useAnalyzeTeacherSubmission: () => ({ mutate: mocks.analyze, isPending: false, isError: false }),
  useUpdateProfessorReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveTeacherFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendTeacherFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => <div /> }))
vi.mock('../src/lib/useAnalysis', () => ({ useAnalysis: () => ({ data: undefined, isPending: false, isError: false }) }))

import { EssayCheck } from '../src/roles/teacher/screens/EssayCheck'

describe('Teacher essay check', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts an analysis for the current Classroom submission', () => {
    render(
      <EssayCheck
        courseId="course-1"
        assignmentId="work-1"
        studentId="student-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check essay' }))

    expect(mocks.analyze).toHaveBeenCalledWith({
      courseId: 'course-1',
      assignmentId: 'work-1',
      studentId: 'student-1',
    })
  })
})
