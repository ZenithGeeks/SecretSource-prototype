import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TeacherWorkspace } from '../src/lib/teacher'
import { ClassWorkspaceHeader } from '../src/roles/teacher/components/ClassWorkspaceHeader'

describe('ClassWorkspaceHeader', () => {
  const baseWorkspace: TeacherWorkspace = {
    course: {
      id: 'course-1',
      name: 'Advanced Writing',
      section: 'Sec 1',
      subject: 'English Literature',
      studentCount: 24,
      assignmentCount: 5,
      topicCount: 2,
      announcementCount: 0,
      linkedFileCount: 6,
      status: 'active',
      teacherName: 'Prof. Miller',
      lastSyncedAt: 'Today, 10:00 AM',
    },
    assignments: [],
    submissions: [],
    people: [],
    stats: {
      enrolled: 24,
      submitted: 18,
      reviewed: 12,
    },
  }

  it('renders course information and "synced today" when lastSyncedAt contains "today"', () => {
    const onTabChange = vi.fn()
    render(
      <ClassWorkspaceHeader
        workspace={baseWorkspace}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    )

    expect(screen.getByText(/English Literature · Section Sec 1/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Advanced Writing · Sec 1' })).toBeInTheDocument()
    expect(screen.getByText(/24 students · 5 assignments · synced today from Google Classroom/)).toBeInTheDocument()
  })

  it('renders "synced recently" when lastSyncedAt does not contain "today"', () => {
    const workspace: TeacherWorkspace = {
      ...baseWorkspace,
      course: {
        ...baseWorkspace.course,
        lastSyncedAt: '3 days ago',
      },
    }

    render(
      <ClassWorkspaceHeader
        workspace={workspace}
        activeTab="overview"
        onTabChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/synced recently from Google Classroom/)).toBeInTheDocument()
  })

  it('invokes onTabChange when a workspace tab is clicked', () => {
    const onTabChange = vi.fn()
    render(
      <ClassWorkspaceHeader
        workspace={baseWorkspace}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    )

    const classworkTab = screen.getByRole('tab', { name: 'Classwork' })
    fireEvent.click(classworkTab)
    expect(onTabChange).toHaveBeenCalledWith('classwork')
  })
})
