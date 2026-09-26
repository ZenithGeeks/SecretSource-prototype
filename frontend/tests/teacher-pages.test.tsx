import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => <div /> }))

import { AddClass } from '../src/roles/teacher/screens/AddClass'
import { AssignmentDetail } from '../src/roles/teacher/screens/AssignmentDetail'
import { Classes } from '../src/roles/teacher/screens/Classes'
import { Classwork } from '../src/roles/teacher/screens/Classwork'
import { ClassWorkspace } from '../src/roles/teacher/screens/ClassWorkspace'
import { EssayCheck } from '../src/roles/teacher/screens/EssayCheck'
import { FeedbackDialog } from '../src/roles/teacher/screens/FeedbackDialog'
import { Home } from '../src/roles/teacher/screens/Home'
import { People } from '../src/roles/teacher/screens/People'
import { ReadingQuestions } from '../src/roles/teacher/screens/ReadingQuestions'
import { Settings } from '../src/roles/teacher/screens/Settings'
import { TeacherApp } from '../src/roles/teacher/TeacherApp'
import { resetSettings } from '../src/lib/settings'
import { resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { resetTeacherStore } from '../src/lib/teacherStore'
import { MOCK_TEACHER_WORKSPACE } from '../src/mocks/teacher'
import { teacherApi } from '../src/lib/teacher'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  resetSettings()
  resetTeacherPreferences()
  resetTeacherStore()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Teacher home and class pages', () => {
  test('Home opens the essay and reading-question routes from quick actions', async () => {
    const onOpen = vi.fn()
    renderWithQuery(<Home onOpen={onOpen} />)

    expect(await screen.findByRole('heading', { name: 'Good morning, Vitawat' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Check student essays/ }))
    expect(onOpen).toHaveBeenCalledWith({
      screen: 'assignment-detail',
      courseId: 'class-literary-2b',
      assignmentId: 'assignment-essay',
    })

    fireEvent.click(screen.getByRole('button', { name: /Make reading questions/ }))
    expect(onOpen).toHaveBeenCalledWith({ screen: 'reading-questions', paperId: 'paper-colbert' })
  })

  test('Classes filters by course details and opens the selected class', async () => {
    const onOpenClass = vi.fn()
    renderWithQuery(<Classes onOpenClass={onOpenClass} onAddClass={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search classes' }), { target: { value: 'Modern' } })

    expect(screen.getByRole('heading', { name: 'Modern Writing' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Literary Analysis' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Open class/ }))
    expect(onOpenClass).toHaveBeenCalledWith('class-modern-writing-1a')
  })

  test('Add class progresses from the connection step to course selection', () => {
    const onContinue = vi.fn()
    renderWithQuery(
      <AddClass
        step="connect"
        onBack={vi.fn()}
        onContinue={onContinue}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  test('Add class displays a Google connection error', () => {
    renderWithQuery(
      <AddClass
        step="connect"
        error="Google is unavailable."
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Google is unavailable.')
  })

  test('Add class selects an importable course and confirms its local import', async () => {
    const onSelectCourse = vi.fn()
    renderWithQuery(
      <AddClass
        step="course"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={onSelectCourse}
        onImport={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Research Methods/ }))
    expect(onSelectCourse).toHaveBeenCalledWith('class-research-methods-3a')

    const onImport = vi.fn()
    renderWithQuery(
      <AddClass
        step="review"
        selectedCourseId="class-research-methods-3a"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onSelectCourse={vi.fn()}
        onImport={onImport}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Review Research Methods' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import class' }))
    expect(onImport).toHaveBeenCalledWith('class-research-methods-3a')
  })

  test('Class workspace changes tabs and opens a recent assignment', async () => {
    const onNavigate = vi.fn()
    const onRefresh = vi.fn()
    renderWithQuery(
      <ClassWorkspace
        courseId="class-literary-2b"
        tab="overview"
        onNavigate={onNavigate}
        onRefresh={onRefresh}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Literary Analysis' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Classwork and grades' }))
    expect(onNavigate).toHaveBeenCalledWith({ screen: 'classwork', courseId: 'class-literary-2b' })

    fireEvent.click(screen.getByRole('button', { name: /Assignment 2: Evidence-based essay/ }))
    expect(onNavigate).toHaveBeenCalledWith({
      screen: 'assignment-detail',
      courseId: 'class-literary-2b',
      assignmentId: 'assignment-essay',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  test('Classwork sends selected assignments to the Essay Check batch pipeline', async () => {
    const prepare = vi.spyOn(teacherApi, 'prepareEssayChecks').mockResolvedValue({
      prepared: [{ assignmentId: 'assignment-essay', submissionId: 'sub-1', studentId: 'student-anan', studentName: 'Anan P.', analysisId: 'analysis-1', status: 'running' }],
      skipped: [], failed: [],
    })
    const onCheckEssays = vi.fn()
    renderWithQuery(
      <Classwork
        workspace={MOCK_TEACHER_WORKSPACE}
        onOpenAssignment={vi.fn()}
        onCheckEssays={onCheckEssays}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Assignment 2: Evidence-based essay' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze selected (1)' }))
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({ courseId: MOCK_TEACHER_WORKSPACE.course.id, assignmentIds: ['assignment-essay'] }))
    expect(await screen.findByText('1 student submission sent to the analysis pipeline.')).toBeInTheDocument()
    prepare.mockRestore()

    fireEvent.click(screen.getByRole('button', { name: 'Check essays' }))
    expect(onCheckEssays).toHaveBeenCalledWith('assignment-essay')
  })

  test('People filters the read-only roster by name', () => {
    renderWithQuery(<People workspace={MOCK_TEACHER_WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search people' }), { target: { value: 'Anan' } })

    expect(screen.getByText('Anan P.')).toBeInTheDocument()
    expect(screen.queryByText('Bee S.')).not.toBeInTheDocument()
  })

  test('Assignment detail opens a submitted student in Essay Check', async () => {
    const onOpenEssay = vi.fn()
    renderWithQuery(
      <AssignmentDetail
        courseId="class-literary-2b"
        assignmentId="assignment-essay"
        onOpenEssay={onOpenEssay}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Assignment 2: Evidence-based essay' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Essay Check' }))
    expect(onOpenEssay).toHaveBeenCalledWith('student-anan')
  })
})

describe('Teacher review and worksheet pages', () => {
  test('Essay Check keeps the teacher feedback editor and confirmation in the review flow', async () => {
    renderWithQuery(
      <EssayCheck
        courseId="class-literary-2b"
        assignmentId="assignment-essay"
        studentId="student-anan"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Anan P.' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback to student' }), { target: { value: 'Please revisit the source evidence.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Send to student' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Send feedback to Anan P.?' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('Feedback dialog stays open and reports a delivery error', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('Delivery unavailable'))
    const onClose = vi.fn()
    renderWithQuery(
      <FeedbackDialog
        open
        studentName="Anan P."
        recipientEmail="anan@example.edu"
        senderEmail="teacher@example.edu"
        deliveryReady
        deliveryIssue=""
        preview="Feedback preview"
        onClose={onClose}
        onSend={onSend}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Delivery unavailable')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled()
  })

  test('Reading Questions opens the source and edits then removes a local question', async () => {
    const openPaper = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderWithQuery(<ReadingQuestions />)

    expect(await screen.findByRole('heading', { name: 'Reading questions' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Show in paper' })[0]!)
    expect(openPaper).toHaveBeenCalledWith(
      'https://arxiv.org/pdf/2004.12832#page=2',
      '_blank',
      'noopener,noreferrer',
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    const editDialog = await screen.findByRole('dialog')
    fireEvent.change(within(editDialog).getByRole('textbox', { name: 'Question' }), {
      target: { value: 'Edited reading question' },
    })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save question' }))
    expect(await screen.findByRole('heading', { name: 'Edited reading question' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!)
    const removeDialog = await screen.findByRole('dialog')
    fireEvent.click(within(removeDialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edited reading question' })).not.toBeInTheDocument())
  })

  test('Settings updates teacher preferences, exports results, and resets local data after confirmation', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderWithQuery(<Settings />)

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    const hideNames = screen.getByRole('checkbox', { name: 'Hide student names' })
    expect(hideNames).not.toBeChecked()
    fireEvent.click(hideNames)
    await waitFor(() => expect(hideNames).toBeChecked())

    fireEvent.click(screen.getByRole('button', { name: 'Export class results' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Class results exported locally.')

    fireEvent.click(screen.getByRole('button', { name: 'Delete local data' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset local data' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Local uploaded essay data was reset.')
  })
})

describe('Teacher application routing', () => {
  test('keeps the Essay Check roster and opens Settings from the profile menu', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=essay-check&courseId=class-literary-2b&assignmentId=assignment-essay&studentId=student-anan')
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('navigation', { name: 'Assignment students' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anan P\./ })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: /Wittawat/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('settings')
  })

  test('TeacherApp renders a deep-linked page and navigates through the shell', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=classes')
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))

    expect(await screen.findByRole('heading', { name: 'Reading questions' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('reading-questions')
  })
})
