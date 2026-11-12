import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeacherClass, TeacherHistoryEntry } from '../src/lib/teacher'

const mockClassesState = {
  data: [] as TeacherClass[] | undefined,
  isPending: false,
  isError: false,
}

const mockHistoryState = {
  data: [] as TeacherHistoryEntry[] | undefined,
  isPending: false,
  isError: false,
}

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherClasses: () => mockClassesState,
  useTeacherHistory: () => mockHistoryState,
}))

import { TeacherSidebar } from '../src/roles/teacher/components/TeacherSidebar'

describe('TeacherSidebar', () => {
  beforeEach(() => {
    mockClassesState.data = []
    mockClassesState.isPending = false
    mockClassesState.isError = false
    mockHistoryState.data = []
    mockHistoryState.isPending = false
    mockHistoryState.isError = false
  })

  it('shows loading state for classes and history', () => {
    mockClassesState.isPending = true
    mockHistoryState.isPending = true

    render(<TeacherSidebar onOpen={vi.fn()} />)

    expect(screen.getByText('Loading classes…')).toBeInTheDocument()
    expect(screen.getByText('Loading recent work…')).toBeInTheDocument()
  })

  it('shows empty state when no classes or recent work exist', () => {
    mockClassesState.data = []
    mockHistoryState.data = []

    render(<TeacherSidebar onOpen={vi.fn()} />)

    expect(screen.getByText('No classes yet')).toBeInTheDocument()
    expect(screen.getByText('No recent work yet')).toBeInTheDocument()
  })

  it('shows error state when recent work fails to load', () => {
    mockHistoryState.isError = true

    render(<TeacherSidebar onOpen={vi.fn()} />)

    expect(screen.getByText('Recent work is unavailable')).toBeInTheDocument()
  })

  it('renders classes list and navigates on click', () => {
    mockClassesState.data = [
      {
        id: 'c1',
        name: 'Literature 101',
        section: 'Sec A',
        studentCount: 28,
        subject: 'English',
        status: 'active',
        teacherName: 'Alex',
        assignmentCount: 3,
        topicCount: 2,
        announcementCount: 1,
        linkedFileCount: 4,
        lastSyncedAt: 'Today',
      },
    ]

    const onOpen = vi.fn()
    render(<TeacherSidebar onOpen={onOpen} />)

    const classBtn = screen.getByRole('button', { name: /Literature 101/ })
    expect(classBtn).toHaveTextContent('28')
    fireEvent.click(classBtn)

    expect(onOpen).toHaveBeenCalledWith({ screen: 'class-overview', courseId: 'c1' })
  })

  it('renders history entries and handles "View all recently checked"', () => {
    const fakeHistory: TeacherHistoryEntry[] = [
      {
        id: 'h1',
        courseId: 'c1',
        courseName: 'Lit 101',
        assignmentId: 'a1',
        assignmentTitle: 'Essay 1',
        studentId: 's1',
        studentName: 'Alice',
        submissionId: 'sub1',
        fileName: 'essay.docx',
        activity: ['analysis'],
        checkedAt: new Date().toISOString(),
      },
      {
        id: 'h2',
        courseId: 'c1',
        courseName: 'Lit 101',
        assignmentId: 'a1',
        assignmentTitle: 'Essay 1',
        studentId: 's2',
        studentName: 'Bob',
        submissionId: 'sub2',
        fileName: 'bob.docx',
        activity: ['feedback'],
        checkedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'h3',
        courseId: 'c1',
        courseName: 'Lit 101',
        assignmentId: 'a2',
        assignmentTitle: 'Essay 2',
        studentId: 's3',
        studentName: 'Charlie',
        submissionId: 'sub3',
        fileName: 'charlie.docx',
        activity: ['professor-review'],
        checkedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      },
      {
        id: 'h4',
        courseId: 'c1',
        courseName: 'Lit 101',
        assignmentId: 'a2',
        assignmentTitle: 'Essay 2',
        studentId: 's4',
        studentName: 'Diana',
        submissionId: 'sub4',
        fileName: 'diana.docx',
        activity: ['analysis'],
        checkedAt: 'invalid-date',
      },
    ]

    mockHistoryState.data = fakeHistory

    const onOpen = vi.fn()
    render(<TeacherSidebar onOpen={onOpen} />)

    // Only first 3 entries should be rendered in the preview list
    expect(screen.getByRole('button', { name: /Alice/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Charlie/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Diana/ })).not.toBeInTheDocument()

    // Clicking an entry opens essay-check
    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))
    expect(onOpen).toHaveBeenCalledWith({
      screen: 'essay-check',
      courseId: 'c1',
      assignmentId: 'a1',
      studentId: 's1',
    })

    // "View all recently checked" appears because length > 3
    const viewAllBtn = screen.getByRole('button', { name: 'View all recently checked' })
    fireEvent.click(viewAllBtn)
    expect(onOpen).toHaveBeenCalledWith({ screen: 'history' })
  })
})
