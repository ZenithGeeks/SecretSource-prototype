import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeacherHistoryEntry } from '../src/lib/teacher'

const mockHistoryState = {
  data: [] as TeacherHistoryEntry[] | undefined,
  isPending: false,
  isError: false,
}

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherHistory: () => mockHistoryState,
}))

import { TeacherHistoryList, TeacherHistoryPage } from '../src/roles/teacher/screens/History'

describe('Teacher History screens', () => {
  beforeEach(() => {
    mockHistoryState.data = []
    mockHistoryState.isPending = false
    mockHistoryState.isError = false
  })

  describe('TeacherHistoryPage', () => {
    it('shows loading state while pending', () => {
      mockHistoryState.isPending = true
      render(<TeacherHistoryPage onSelect={vi.fn()} />)
      expect(screen.getByText('Loading checked work...')).toBeInTheDocument()
    })

    it('shows alert when history fails to load', () => {
      mockHistoryState.isError = true
      render(<TeacherHistoryPage onSelect={vi.fn()} />)
      expect(screen.getByRole('alert')).toHaveTextContent('Recent checked work could not be loaded.')
    })

    it('shows empty message when there is no checked work', () => {
      mockHistoryState.data = []
      render(<TeacherHistoryPage onSelect={vi.fn()} />)
      expect(screen.getByText('No checked work yet')).toBeInTheDocument()
    })

    it('displays history entries and invokes onSelect', () => {
      const entry: TeacherHistoryEntry = {
        id: 'hist-1',
        courseId: 'course-1',
        courseName: 'English 101',
        assignmentId: 'assign-1',
        assignmentTitle: 'Argumentative Essay',
        studentId: 'student-1',
        studentName: 'Maya Lin',
        submissionId: 'sub-1',
        fileName: 'maya_essay.pdf',
        activity: ['analysis', 'professor-review', 'feedback'],
        checkedAt: '2026-11-10T12:00:00Z',
      }
      mockHistoryState.data = [entry]

      const onSelect = vi.fn()
      render(<TeacherHistoryPage onSelect={onSelect} />)

      expect(screen.getByText('Maya Lin')).toBeInTheDocument()
      expect(screen.getByText(/Argumentative Essay · English 101/)).toBeInTheDocument()
      expect(screen.getByText(/Analysis · Teacher decision · Feedback/)).toBeInTheDocument()

      const itemButton = screen.getByRole('button', { name: /Maya Lin/ })
      fireEvent.click(itemButton)
      expect(onSelect).toHaveBeenCalledWith(entry)
    })

    it('displays 50 newest notice when count reaches 50', () => {
      const entries = Array.from({ length: 50 }, (_, i) => ({
        id: `hist-${i}`,
        courseId: 'course-1',
        courseName: 'English 101',
        assignmentId: 'assign-1',
        assignmentTitle: 'Essay',
        studentId: `student-${i}`,
        studentName: `Student ${i}`,
        submissionId: `sub-${i}`,
        fileName: 'essay.pdf',
        activity: ['analysis' as const],
        checkedAt: '2026-11-10T12:00:00Z',
      }))
      mockHistoryState.data = entries

      render(<TeacherHistoryPage onSelect={vi.fn()} />)
      expect(screen.getByText('Showing the newest 50 entries.')).toBeInTheDocument()
    })
  })

  describe('TeacherHistoryList', () => {
    it('shows loading, error, and empty states', () => {
      mockHistoryState.isPending = true
      const { rerender } = render(<TeacherHistoryList selected={{}} onSelect={vi.fn()} />)
      expect(screen.getByText('Loading checked work...')).toBeInTheDocument()

      mockHistoryState.isPending = false
      mockHistoryState.isError = true
      rerender(<TeacherHistoryList selected={{}} onSelect={vi.fn()} />)
      expect(screen.getByRole('alert')).toHaveTextContent('Recent checked work could not be loaded.')

      mockHistoryState.isError = false
      mockHistoryState.data = []
      rerender(<TeacherHistoryList selected={{}} onSelect={vi.fn()} />)
      expect(screen.getByText('No checked work yet.')).toBeInTheDocument()
    })

    it('highlights the selected entry with aria-current="page"', () => {
      const entry1: TeacherHistoryEntry = {
        id: 'hist-1',
        courseId: 'c1',
        courseName: 'Lit',
        assignmentId: 'a1',
        assignmentTitle: 'Essay 1',
        studentId: 's1',
        studentName: 'Student 1',
        submissionId: 'sub-1',
        fileName: 's1.pdf',
        activity: ['analysis'],
        checkedAt: '2026-11-10T12:00:00Z',
      }
      const entry2: TeacherHistoryEntry = {
        id: 'hist-2',
        courseId: 'c1',
        courseName: 'Lit',
        assignmentId: 'a1',
        assignmentTitle: 'Essay 1',
        studentId: 's2',
        studentName: 'Student 2',
        submissionId: 'sub-2',
        fileName: 's2.pdf',
        activity: ['feedback'],
        checkedAt: '2026-11-10T12:00:00Z',
      }
      mockHistoryState.data = [entry1, entry2]

      const onSelect = vi.fn()
      render(
        <TeacherHistoryList
          selected={{ courseId: 'c1', assignmentId: 'a1', studentId: 's1' }}
          onSelect={onSelect}
        />,
      )

      const btn1 = screen.getByRole('button', { name: /Student 1/ })
      const btn2 = screen.getByRole('button', { name: /Student 2/ })

      expect(btn1).toHaveAttribute('aria-current', 'page')
      expect(btn2).not.toHaveAttribute('aria-current')

      fireEvent.click(btn2)
      expect(onSelect).toHaveBeenCalledWith(entry2)
    })
  })
})
