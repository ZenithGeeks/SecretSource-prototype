import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Analysis } from '../src/lib/api'
import type { EssayCheck as EssayCheckData } from '../src/lib/teacher'

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  updateReview: vi.fn(),
  essayCheck: null as EssayCheckData | null,
  analysis: null as Analysis | null,
}))

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherEssayCheck: () => ({
    isPending: false,
    isError: false,
    data: mocks.essayCheck ?? {
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
  useUpdateProfessorReview: () => ({ mutate: mocks.updateReview, isPending: false }),
  useSaveTeacherFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendTeacherFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => <div /> }))
vi.mock('../src/lib/useAnalysis', () => ({ useAnalysis: () => ({ data: mocks.analysis, isPending: false, isError: false }) }))

import { EssayCheck } from '../src/roles/teacher/screens/EssayCheck'

describe('Teacher essay check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.essayCheck = null
    mocks.analysis = null
  })

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

  it('saves the human decision and note from a claim in the loaded analysis', () => {
    mocks.essayCheck = {
      assignment: { assignmentId: 'work-1', courseId: 'course-1', course: 'Course', name: 'Essay' },
      student: { id: 'student-1', name: 'Student', fileName: 'essay.pdf' },
      citationSummary: { total: 1, contradicted: 1, silent: 0, backed: 0 },
      reviews: [{
        id: 'claim-0:10.1234/source:0',
        standing: 'refutes',
        citation: 'Source paper',
        claim: 'The source conflicts with this statement.',
        sourceQuote: 'Conflicting evidence.',
        sourceLocation: 'p. 4',
        supportingUrls: [],
        professorReview: { outcome: 'not-reviewed', note: '' },
      }],
      feedback: { body: '', preview: '', citedPages: [], citationIds: [] },
      navigation: {},
      analysis: { id: 'analysis-1', status: 'done', error: null },
    }
    mocks.analysis = {
      id: 'analysis-1',
      paper: 'essay.pdf',
      file: 'essay.pdf',
      status: 'done',
      claims: [{
        claim: 'The source conflicts with this statement.',
        sentence: "This is the student's statement.",
        citations: [{ title: 'Source paper', authors: [], year: '2024', doi: '10.1234/source', arxiv: '', url: 'https://example.test/source' }],
        verdicts: [{ verdict: 'refutes', quote: 'Conflicting evidence.', reasoning: 'The source disagrees.', source: 'source.pdf', cited: '10.1234/source', evidence: [], pages: [] }],
        unchecked: [],
        source: null,
      }],
      stages: [],
    }

    render(
      <EssayCheck
        courseId="course-1"
        assignmentId="work-1"
        studentId="student-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    const decision = screen.getByRole('combobox', { name: 'Human final decision for Source paper' })
    fireEvent.change(decision, { target: { value: 'contradicts' } })
    expect(mocks.updateReview).toHaveBeenCalledWith({
      courseId: 'course-1',
      assignmentId: 'work-1',
      studentId: 'student-1',
      reviewId: 'claim-0:10.1234/source:0',
      outcome: 'contradicts',
      note: '',
    })

    const includeButton = screen.getByRole('button', { name: 'Add to feedback' })
    fireEvent.click(includeButton)
    expect(includeButton).toHaveAttribute('aria-pressed', 'true')

    mocks.essayCheck.reviews[0].professorReview.outcome = 'contradicts'
    const note = screen.getByRole('textbox', { name: 'Teacher note for Source paper' })
    fireEvent.change(note, { target: { value: 'Check the source context.' } })
    fireEvent.blur(note)
    expect(mocks.updateReview).toHaveBeenLastCalledWith({
      courseId: 'course-1',
      assignmentId: 'work-1',
      studentId: 'student-1',
      reviewId: 'claim-0:10.1234/source:0',
      outcome: 'contradicts',
      note: 'Check the source context.',
    })
  })
})
