import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { TeacherWorkspace } from '../src/lib/teacher'
import { People } from '../src/roles/teacher/screens/People'

describe('Teacher People screen', () => {
  const mockWorkspace: TeacherWorkspace = {
    course: {
      id: 'c1',
      name: 'Creative Writing',
      section: 'A',
      subject: 'Arts',
      studentCount: 7,
      assignmentCount: 2,
      topicCount: 1,
      announcementCount: 0,
      linkedFileCount: 2,
      status: 'active',
      teacherName: 'Dr. John',
      lastSyncedAt: 'Today',
    },
    assignments: [],
    submissions: [
      {
        id: 'sub-1',
        assignmentId: 'a1',
        studentId: 's1',
        studentName: 'Alice Young',
        studentEmail: 'alice@example.edu',
        state: 'submitted',
        submittedAt: 'Today',
        reviewStatus: 'analysis-ready',
        attachments: [],
      },
    ],
    people: [
      { id: 't1', name: 'Dr. John', initials: 'DJ', role: 'Teacher', isCourseOwner: true },
      { id: 's1', name: 'Alice Young', initials: 'AY', role: 'Student', isCourseOwner: false },
      { id: 's2', name: 'Bob Baker', initials: 'BB', role: 'Student', isCourseOwner: false },
      { id: 's3', name: 'Charlie Clark', initials: 'CC', role: 'Student', isCourseOwner: false },
      { id: 's4', name: 'David Davis', initials: 'DD', role: 'Student', isCourseOwner: false },
      { id: 's5', name: 'Emma Evans', initials: 'EE', role: 'Student', isCourseOwner: false },
      { id: 's6', name: 'Fiona Frank', initials: 'FF', role: 'Student', isCourseOwner: false },
      { id: 's7', name: 'George Green', initials: 'GG', role: 'Student', isCourseOwner: false },
    ],
    stats: { enrolled: 7, submitted: 1, reviewed: 1 },
  }

  it('renders teachers and students sections with counts and emails', () => {
    render(<People workspace={mockWorkspace} />)

    expect(screen.getByRole('region', { name: 'Teachers' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Students' })).toBeInTheDocument()
    expect(screen.getByText('Dr. John')).toBeInTheDocument()
    expect(screen.getByText('Alice Young')).toBeInTheDocument()
    expect(screen.getByText('alice@example.edu')).toBeInTheDocument()
  })

  it('shows first 5 students by default and allows expanding to show all', () => {
    render(<People workspace={mockWorkspace} />)

    // First 5 students are visible
    expect(screen.getByText('Alice Young')).toBeInTheDocument()
    expect(screen.getByText('Emma Evans')).toBeInTheDocument()
    // 6th and 7th are truncated initially
    expect(screen.queryByText('Fiona Frank')).not.toBeInTheDocument()
    expect(screen.queryByText('George Green')).not.toBeInTheDocument()

    // Expand to show all
    const toggleButton = screen.getByRole('button', { name: 'Show all 7 students' })
    fireEvent.click(toggleButton)

    expect(screen.getByText('Fiona Frank')).toBeInTheDocument()
    expect(screen.getByText('George Green')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer students' })).toBeInTheDocument()

    // Collapse back
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer students' }))
    expect(screen.queryByText('Fiona Frank')).not.toBeInTheDocument()
  })

  it('filters roster by query and shows empty state when nothing matches', () => {
    render(<People workspace={mockWorkspace} />)

    const searchInput = screen.getByRole('textbox', { name: 'Search people' })

    // Search for email
    fireEvent.change(searchInput, { target: { value: 'alice@example' } })
    expect(screen.getByText('Alice Young')).toBeInTheDocument()
    expect(screen.queryByText('Bob Baker')).not.toBeInTheDocument()
    expect(screen.getByText('No teachers match this search.')).toBeInTheDocument()

    // Search for something non-existent
    fireEvent.change(searchInput, { target: { value: 'Nonexistent person' } })
    expect(screen.getByText('No teachers match this search.')).toBeInTheDocument()
    expect(screen.getByText('No students match this search.')).toBeInTheDocument()
  })
})
