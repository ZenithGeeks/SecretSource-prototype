import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeacherHome, TeacherHomeSubmission } from '../src/lib/teacher'
import { Home } from '../src/roles/teacher/screens/Home'

const mockHomeState = {
  data: undefined as TeacherHome | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}

const mockConnectionState = {
  data: { connected: true, email: 'teacher@example.edu', sync: { lastSyncedAt: '2026-11-10T08:00:00Z', error: null } },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}

vi.mock('../src/lib/useTeacher', () => ({
  useTeacherHome: () => mockHomeState,
  useTeacherGoogleConnection: () => mockConnectionState,
}))

vi.mock('../src/lib/useAuth', () => ({
  useAuth: () => ({ session: { user: { email: 'teacher@example.edu', user_metadata: { full_name: 'Prof. Alex' } } } }),
}))

vi.mock('../src/lib/settings', () => ({
  useSettings: () => ({ displayName: 'Prof. Alex' }),
}))

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('Home submission grouping, pagination, and helper behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHomeState.isPending = false
    mockHomeState.isError = false
    mockConnectionState.isPending = false
    mockConnectionState.isError = false
  })

  it('groups submissions by course and sorts them by due date', () => {
    const submissions: TeacherHomeSubmission[] = [
      {
        id: 'sub-2',
        studentId: 's2',
        studentName: 'Zoe',
        initial: 'Z',
        assignmentId: 'a2',
        courseId: 'course-b',
        courseName: 'Biology 101',
        state: 'submitted',
        reviewStatus: 'not-checked',
        dueAt: '2026-11-20T00:00:00Z',
      },
      {
        id: 'sub-1',
        studentId: 's1',
        studentName: 'Adam',
        initial: 'A',
        assignmentId: 'a1',
        courseId: 'course-a',
        courseName: 'Art History',
        state: 'submitted',
        reviewStatus: 'not-checked',
        dueAt: '2026-11-15T00:00:00Z',
      },
    ]

    mockHomeState.data = {
      courseId: 'course-a',
      course: 'Art History',
      assignmentId: 'a1',
      reviewQueueCount: 2,
      submissions,
      dueSoon: [],
      mostMisusedSources: [],
    }

    renderWithQuery(<Home onOpen={vi.fn()} />)

    // Course with earlier due date should be listed first
    const headings = screen.getAllByRole('heading', { level: 2 })
    const courseHeadings = headings.map((h) => h.textContent).filter((t) => t === 'Art History' || t === 'Biology 101')
    expect(courseHeadings).toEqual(['Art History', 'Biology 101'])
  })

  it('handles expansion and pagination when submissions in a course exceed 15', () => {
    const submissions: TeacherHomeSubmission[] = Array.from({ length: 20 }, (_, i) => ({
      id: `sub-${i}`,
      studentId: `s-${i}`,
      studentName: `Student ${String(i).padStart(2, '0')}`,
      initial: 'S',
      assignmentId: 'a1',
      courseId: 'course-1',
      courseName: 'Advanced Composition',
      state: 'submitted',
      reviewStatus: 'not-checked',
      dueAt: '2026-11-30T00:00:00Z',
    }))

    mockHomeState.data = {
      courseId: 'course-1',
      course: 'Advanced Composition',
      assignmentId: 'a1',
      reviewQueueCount: 20,
      submissions,
      dueSoon: [],
      mostMisusedSources: [],
    }

    renderWithQuery(<Home onOpen={vi.fn()} />)

    // Collapsed limit is 3
    const seeAllBtn = screen.getByRole('button', { name: 'See all 20' })
    expect(seeAllBtn).toBeInTheDocument()

    // Expand to show paginated view
    fireEvent.click(seeAllBtn)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()

    // Page navigation controls should exist (20 items -> 2 pages with 15 per page)
    expect(screen.getByText(/Showing 1–15 of 20 · 15 per page/)).toBeInTheDocument()
    const page2Btn = screen.getByRole('button', { name: 'Page 2' })
    fireEvent.click(page2Btn)
    expect(screen.getByText(/Showing 16–20 of 20 · 15 per page/)).toBeInTheDocument()

    const prevBtn = screen.getByRole('button', { name: 'Previous page' })
    fireEvent.click(prevBtn)
    expect(screen.getByText(/Showing 1–15 of 20 · 15 per page/)).toBeInTheDocument()
  })

  it('renders multiple most misused sources', () => {
    mockHomeState.data = {
      courseId: 'course-1',
      course: 'Lit',
      assignmentId: 'a1',
      reviewQueueCount: 0,
      submissions: [],
      dueSoon: [],
      mostMisusedSources: [
        { title: 'Wikipedia - Neural Networks', count: 5 },
        { title: 'Blog post on AI', count: 2 },
      ],
    }

    renderWithQuery(<Home onOpen={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 3, name: 'Wikipedia - Neural Networks' })).toBeInTheDocument()
    expect(screen.getByText('5 essays flagged')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Blog post on AI' })).toBeInTheDocument()
    expect(screen.getByText('2 essays flagged')).toBeInTheDocument()
  })
})
