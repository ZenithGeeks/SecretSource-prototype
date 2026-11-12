import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeacherClass, TeacherClassImportPreview, TeacherImportableClass } from '../src/lib/teacher'

const mockImportableClasses = {
  data: [] as TeacherImportableClass[] | undefined,
  isPending: false,
  isError: false,
}

const mockClassImportPreview = {
  data: undefined as TeacherClassImportPreview | undefined,
  isPending: false,
  isError: false,
}

const mockTeacherClasses = {
  data: [] as TeacherClass[] | undefined,
  isPending: false,
  isError: false,
}

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherImportableClasses: () => mockImportableClasses,
  useTeacherClassImportPreview: () => mockClassImportPreview,
  useTeacherClasses: () => mockTeacherClasses,
}))

import { AddClass } from '../src/roles/teacher/screens/AddClass'

describe('AddClass step components and branch behaviors', () => {
  beforeEach(() => {
    mockImportableClasses.data = []
    mockImportableClasses.isPending = false
    mockImportableClasses.isError = false
    mockClassImportPreview.data = undefined
    mockClassImportPreview.isPending = false
    mockClassImportPreview.isError = false
    mockTeacherClasses.data = []
    mockTeacherClasses.isPending = false
    mockTeacherClasses.isError = false
  })

  it('renders StepBar with correct step progress states', () => {
    const { rerender } = render(
      <AddClass
        step="connect"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    // In step connect, step 1 is current
    const step1 = screen.getByText('1')
    expect(step1).toHaveAttribute('aria-current', 'step')

    // In step course, step 1 is complete and step 2 is current
    rerender(
      <AddClass
        step="course"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )
    const step2 = screen.getByText('2')
    expect(step2).toHaveAttribute('aria-current', 'step')
  })

  it('shows error state and offers reconnect button on course step when courses fail to load', () => {
    mockImportableClasses.isError = true
    const onReconnectGoogle = vi.fn()

    render(
      <AddClass
        step="course"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
        onReconnectGoogle={onReconnectGoogle}
      />,
    )

    expect(screen.getByText('Classes could not load')).toBeInTheDocument()
    const reconnectBtn = screen.getByRole('button', { name: 'Reconnect Google Classroom' })
    fireEvent.click(reconnectBtn)
    expect(onReconnectGoogle).toHaveBeenCalledOnce()
  })

  it('filters importable courses by query on course step', () => {
    mockImportableClasses.data = [
      {
        id: 'c1',
        name: 'Calculus I',
        section: '1A',
        subject: 'Math',
        status: 'active',
        studentCount: 30,
        assignmentCount: 4,
        topicCount: 2,
        teacherName: 'Prof Gauss',
      },
      {
        id: 'c2',
        name: 'Literature',
        section: '2B',
        subject: 'English',
        status: 'active',
        studentCount: 20,
        assignmentCount: 2,
        topicCount: 1,
        teacherName: 'Prof Poe',
      },
    ]

    render(
      <AddClass
        step="course"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    expect(screen.getByText(/Calculus I/)).toBeInTheDocument()
    expect(screen.getByText(/Literature/)).toBeInTheDocument()

    const searchInput = screen.getByRole('textbox', { name: 'Search course name or section' })
    fireEvent.change(searchInput, { target: { value: 'Calculus' } })

    expect(screen.getByText(/Calculus I/)).toBeInTheDocument()
    expect(screen.queryByText(/Literature/)).not.toBeInTheDocument()
  })

  it('disables import button on review step if course is already imported', () => {
    mockClassImportPreview.data = {
      courseId: 'c1',
      resources: [
        { key: 'course', label: 'Course details', count: 1, detail: 'Basic info' },
      ],
    }
    mockTeacherClasses.data = [
      {
        id: 'c1',
        name: 'Calculus I',
        section: '1A',
        subject: 'Math',
        status: 'active',
        studentCount: 30,
        assignmentCount: 4,
        topicCount: 2,
        announcementCount: 0,
        linkedFileCount: 0,
        teacherName: 'Prof Gauss',
        lastSyncedAt: 'Today',
      },
    ]

    render(
      <AddClass
        step="review"
        selectedCourseId="c1"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    const importBtn = screen.getByRole('button', { name: /Already imported/ })
    expect(importBtn).toBeDisabled()
  })

  it('displays import error message on review step when importError is provided', () => {
    mockClassImportPreview.data = {
      courseId: 'c1',
      resources: [
        { key: 'course', label: 'Course details', count: 1, detail: 'Basic info' },
      ],
    }

    render(
      <AddClass
        step="review"
        selectedCourseId="c1"
        importError="Course already exists in your workspace"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Course already exists in your workspace')
  })
})
