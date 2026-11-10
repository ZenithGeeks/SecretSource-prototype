import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Analysis } from '../src/lib/api'
import type { EssayCheck as EssayCheckData } from '../src/lib/teacher'

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  analyzePending: false,
  analyzeError: null as Error | null,
  updateReview: vi.fn(),
  refreshClassroom: vi.fn(),
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
  useTeacherAssignmentDetail: () => ({ data: undefined, isPending: false, isError: false }),
  useTeacherWorkspace: () => ({ data: undefined, isPending: false, isError: false }),
  useTeacherGoogleConnection: () => ({ data: { connected: false, email: null, scopes: [] }, isPending: false, isError: false }),
  useAnalyzeTeacherSubmission: () => ({ mutate: mocks.analyze, isPending: mocks.analyzePending, isError: Boolean(mocks.analyzeError), error: mocks.analyzeError }),
  useUpdateProfessorReview: () => ({ mutate: mocks.updateReview, isPending: false }),
  useSaveTeacherFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefreshTeacherClass: () => ({ mutate: mocks.refreshClassroom, isPending: false, isError: false, error: null }),
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
    mocks.analyzePending = false
    mocks.analyzeError = null
  })

  function completedEssay(status = 'done') {
    mocks.essayCheck = {
      assignment: { assignmentId: 'work-1', courseId: 'course-1', course: 'Course', name: 'Essay' },
      student: { id: 'student-1', name: 'Student', fileName: 'essay.pdf' },
      citationSummary: { total: 0, contradicted: 0, silent: 0, backed: 0 },
      reviews: [], feedback: { body: '', preview: '', citedPages: [], citationIds: [] }, navigation: {},
      analysis: { id: 'analysis-1', status, error: null },
    }
    mocks.analysis = { id: 'analysis-1', paper: 'essay.pdf', status: 'done', claims: [], stages: [] }
    render(<EssayCheck courseId="course-1" assignmentId="work-1" studentId="student-1" onBack={vi.fn()} onNavigate={vi.fn()} />)
  }

  it('requires confirmation before rechecking and lets the teacher cancel', () => {
    completedEssay()
    fireEvent.click(screen.getByRole('button', { name: 'Recheck essay' }))
    expect(screen.getByRole('dialog', { name: 'Recheck this essay?' })).toBeInTheDocument()
    expect(screen.getByText(/cleared only if the submitted file has changed/i)).toBeInTheDocument()
    expect(mocks.analyze).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.analyze).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Recheck essay' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recheck', exact: true }))
    expect(mocks.analyze).toHaveBeenCalledWith({ courseId: 'course-1', assignmentId: 'work-1', studentId: 'student-1', force: true })
  })

  it('disables recheck while the current analysis is running', () => {
    completedEssay('running')
    expect(screen.getByRole('button', { name: 'Recheck essay' })).toBeDisabled()
    expect(screen.getByText(/Analysis is running/)).toBeInTheDocument()
  })

  it('disables recheck while its API request is pending', () => {
    mocks.analyzePending = true
    completedEssay()
    expect(screen.getByRole('button', { name: 'Starting analysis...' })).toBeDisabled()
  })

  it('shows an API failure and allows another attempt', () => {
    mocks.analyzeError = new Error('API connection failed. Try again.')
    completedEssay()
    expect(screen.getByRole('alert')).toHaveTextContent('API connection failed. Try again.')
    expect(screen.getByRole('button', { name: 'Recheck essay' })).toBeEnabled()
  })

  it('starts an analysis for the current Classroom submission', () => {
    const onBack = vi.fn()
    const onNavigate = vi.fn()
    render(
      <EssayCheck
        courseId="course-1"
        assignmentId="work-1"
        studentId="student-1"
        onBack={onBack}
        onNavigate={onNavigate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check essay' }))

    expect(mocks.analyze).toHaveBeenCalledWith({
      courseId: 'course-1',
      assignmentId: 'work-1',
      studentId: 'student-1',
    })
  })

  it('keeps citation decisions and student feedback in the PDF review flow', () => {
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

    const onBack = vi.fn()
    const onNavigate = vi.fn()
    render(
      <EssayCheck
        courseId="course-1"
        assignmentId="work-1"
        studentId="student-1"
        onBack={onBack}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Copy all' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Human final decision for Source paper' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Human final decision for Source paper' }), { target: { value: 'contradicts' } })
    expect(mocks.updateReview).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'contradicts', reviewId: 'claim-0:10.1234/source:0' }))
    expect(screen.getByRole('textbox', { name: 'Email message to the student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to feedback' })).toBeInTheDocument()
  })

  it('offers a Classroom sync when the student email is missing', () => {
    render(<EssayCheck courseId="course-1" assignmentId="work-1" studentId="student-1" onBack={vi.fn()} onNavigate={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email message to the student' }), { target: { value: 'Please revise your thesis.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to student' }))

    fireEvent.click(screen.getByRole('button', { name: 'Sync Classroom now' }))

    expect(mocks.refreshClassroom).toHaveBeenCalledWith('course-1')
  })
})
