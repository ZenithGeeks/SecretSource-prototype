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
import { TeacherApp } from '../src/roles/teacher/TeacherApp'
import { SettingsModal } from '../src/components/SettingsModal'
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

    expect(await screen.findByRole('heading', { name: 'Good morning, Alex' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Check student essays/ }))
    expect(onOpen).toHaveBeenCalledWith({
      screen: 'assignment-detail',
      courseId: 'class-literary-2b',
      assignmentId: 'assignment-essay',
    })

    fireEvent.click(screen.getByRole('button', { name: /Make reading questions/ }))
    expect(onOpen).toHaveBeenCalledWith({ screen: 'reading-questions', paperId: 'paper-colbert' })
  })




  test('Home shows a Google Classroom connection card while disconnected', async () => {
    const onOpen = vi.fn()
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: false, email: null })
    renderWithQuery(<Home onOpen={onOpen} />)

    fireEvent.click(await screen.findByRole('button', { name: /Connect Google Classroom/ }))
    expect(onOpen).toHaveBeenCalledWith({ screen: 'classes' })
  })

  test('Home hides the connection card once Google Classroom is connected', async () => {
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: true, email: 'teacher@example.edu' })
    renderWithQuery(<Home onOpen={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Good morning, Alex' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect Google Classroom/ })).not.toBeInTheDocument()
  })

  test('Classes filters by course details and opens the selected class', async () => {
    const onOpenClass = vi.fn()
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: true, email: 'teacher@example.edu' })
    renderWithQuery(<Classes onOpenClass={onOpenClass} onAddClass={vi.fn()} onConnectGoogle={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search classes' }), { target: { value: 'Modern' } })

    expect(screen.getByRole('heading', { name: /Modern Writing/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Literary Analysis' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Modern Writing/ }))
    expect(onOpenClass).toHaveBeenCalledWith('class-modern-writing-1a')
  })

  test('Classes keeps imported courses visible when Google Classroom is disconnected', async () => {
    const onConnectGoogle = vi.fn()
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: false, email: null })
    renderWithQuery(<Classes onOpenClass={vi.fn()} onAddClass={vi.fn()} onConnectGoogle={onConnectGoogle} />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument()
    expect(onConnectGoogle).not.toHaveBeenCalled()
  })

  test('Classes shows Google connection start errors on the connection screen', async () => {
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: false, email: null })
    renderWithQuery(<Classes onOpenClass={vi.fn()} onAddClass={vi.fn()} onConnectGoogle={vi.fn()} connectionError="Google is unavailable." />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Google is unavailable.')
    expect(screen.getByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
  })

  test('Classes lets the teacher retry when connection status fails to load', async () => {
    const getGoogleConnection = vi.spyOn(teacherApi, 'getGoogleConnection')
      .mockRejectedValueOnce(new Error('Connection status unavailable'))
      .mockResolvedValue({ connected: false, email: null })
    renderWithQuery(<Classes onOpenClass={vi.fn()} onAddClass={vi.fn()} onConnectGoogle={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    expect(getGoogleConnection).toHaveBeenCalledTimes(2)
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

    expect(await screen.findByRole('heading', { name: 'Review class import' })).toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Check \d+ essays$/ }))
    expect(onNavigate).toHaveBeenCalledWith({ screen: 'essay-check', courseId: 'class-literary-2b', assignmentId: 'assignment-essay', studentId: 'student-anan' })
    fireEvent.click(screen.getByRole('tab', { name: 'Classwork' }))
    expect(onNavigate).toHaveBeenCalledWith({ screen: 'classwork', courseId: 'class-literary-2b' })

    fireEvent.click(screen.getByRole('button', { name: /Assignment 2: Evidence-based essay/ }))
    expect(onNavigate).toHaveBeenCalledWith({
      screen: 'assignment-detail',
      courseId: 'class-literary-2b',
      assignmentId: 'assignment-essay',
    })

  })

  test('Classwork sends selected assignments to the Essay Check batch pipeline', async () => {
    const prepare = vi.spyOn(teacherApi, 'prepareEssayChecks').mockResolvedValue({
      prepared: [{ assignmentId: 'assignment-essay', submissionId: 'sub-1', studentId: 'student-anan', studentName: 'Anan P.', analysisId: 'analysis-1', status: 'running' }],
      skipped: [], failed: [],
    })
    renderWithQuery(
      <Classwork
        workspace={MOCK_TEACHER_WORKSPACE}
        onOpenAssignment={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Assignment 2: Evidence-based essay' }))
    fireEvent.click(screen.getByRole('button', { name: /^Check \d+ essays$/ }))
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({ courseId: MOCK_TEACHER_WORKSPACE.course.id, assignmentIds: ['assignment-essay'] }))
    expect(await screen.findByText('1 essay added to review.')).toBeInTheDocument()
    prepare.mockRestore()

  })

  test('People filters the read-only roster by name', () => {
    renderWithQuery(<People workspace={MOCK_TEACHER_WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Search people' }), { target: { value: 'Anan' } })

    expect(screen.getByText('Anan P.')).toBeInTheDocument()
    expect(screen.queryByText('Bee S.')).not.toBeInTheDocument()
  })

  test('Assignment detail opens a submitted student in Essay Check', async () => {
    const onOpenEssay = vi.fn()
    const onNavigate = vi.fn()
    renderWithQuery(
      <AssignmentDetail
        courseId="class-literary-2b"
        assignmentId="assignment-essay"
        onOpenEssay={onOpenEssay}
        onNavigate={onNavigate}
        onRefresh={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Assignment 2: Evidence-based essay' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check the evidence' }))
    expect(onOpenEssay).toHaveBeenCalledWith('student-anan')
  })
})

describe('Teacher review and worksheet pages', () => {
  test('Essay Check keeps feedback available in the new review layout', async () => {
    const onNavigate = vi.fn()
    renderWithQuery(
      <EssayCheck
        courseId="class-literary-2b"
        assignmentId="assignment-essay"
        studentId="student-anan"
        onBack={vi.fn()}
        onNavigate={onNavigate}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Anan P.' })).toBeInTheDocument()
    expect(screen.getAllByText(/essay-2\.docx/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Check essay' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Feedback to student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to student' })).toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: /^Reading questions/ })).toBeInTheDocument()
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

  test('Settings modal updates teacher preferences, exports results, and resets local data after confirmation', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithQuery(<SettingsModal open onClose={vi.fn()} currentRole="teacher" onSwitchRole={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Class and marking' }))
    const hideNames = screen.getByRole('switch', { name: 'Hide student names' })
    expect(hideNames).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(hideNames)
    await waitFor(() => expect(hideNames).toHaveAttribute('aria-checked', 'true'))

    fireEvent.click(screen.getByRole('tab', { name: 'Your data' }))
    const exportButton = await screen.findByRole('button', { name: 'Export' })
    await waitFor(() => {
      fireEvent.click(exportButton)
      expect(screen.getByRole('status')).toHaveTextContent('Class results exported locally.')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Local uploaded essay data was reset.')
  })
})

describe('Teacher application routing', () => {
  test('syncs the connected Classroom course when the Course page opens', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=class-overview&courseId=class-literary-2b')
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: true, email: 'teacher@example.edu' })
    const refreshClass = vi.spyOn(teacherApi, 'refreshClass').mockResolvedValue(null)
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    await waitFor(() => expect(refreshClass).toHaveBeenCalledWith('class-literary-2b'))
    expect(refreshClass).toHaveBeenCalledTimes(1)
  })

  test('shows recent checked submissions in the History page before one is selected', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=history')
    renderWithQuery(<TeacherApp />)

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('navigation', { name: 'Recent checked work' })).toBeInTheDocument()
    const recentCheck = within(main).getByRole('button', { name: /Anan P\./ })
    expect(recentCheck).toBeInTheDocument()
    expect(within(main).queryByText('Choose checked work')).not.toBeInTheDocument()

    fireEvent.click(recentCheck)
    expect(await within(main).findByRole('heading', { name: 'Anan P.' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('studentId')).toBe('student-anan')
  })

  test('explains when History is showing its newest 50 entries', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=history')
    const entry = (await teacherApi.getHistory())[0]!
    vi.spyOn(teacherApi, 'getHistory').mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({ ...entry, id: `entry-${index}` })))
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByText('Showing the newest 50 entries.')).toBeInTheDocument()
  })

  test('The sidebar navigates between Classes, a course, and an assignment', async () => {
    vi.spyOn(teacherApi, 'getGoogleConnection').mockResolvedValue({ connected: true, email: 'teacher@example.edu' })
    window.history.replaceState(null, '', '/?role=teacher&screen=classes')
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'Class list' })
    fireEvent.click(within(list).getByRole('button', { name: /Literary Analysis/ }))
    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()

    const main = within(screen.getByRole('navigation', { name: 'Main' }))
    fireEvent.click(main.getByRole('button', { name: 'Classes' }))
    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('classes')

    fireEvent.click(within(screen.getByRole('region', { name: 'Class list' })).getByRole('button', { name: /Literary Analysis/ }))
    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Classwork' }))
    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /Assignment 2: Evidence-based essay/ }))
    expect(await screen.findByRole('heading', { name: /Evidence-based essay/ })).toBeInTheDocument()

    const yourClasses = within(screen.getByRole('navigation', { name: 'Your classes' }))
    fireEvent.click(yourClasses.getByRole('button', { name: /Literary Analysis/ }))
    expect(await screen.findByRole('heading', { name: /Literary Analysis/ })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('class-overview')

    window.history.back()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('screen')).toBe('assignment-detail'))
    expect(await screen.findByRole('heading', { name: /Evidence-based essay/ })).toBeInTheDocument()
  })

  test('keeps the Essay Check roster and opens Settings from the profile menu', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=essay-check&courseId=class-literary-2b&assignmentId=assignment-essay&studentId=student-anan')
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('navigation', { name: 'Assignment students' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Assignment students' })).getByRole('button', { name: /Anan P\./ })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Graph' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Alex/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alex/ })).toHaveClass('border-accent')
  })

  test('TeacherApp keeps Reading Questions available from Home without a Library tab', async () => {
    window.history.replaceState(null, '', '/?role=teacher&screen=classes')
    renderWithQuery(<TeacherApp />)

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('classes')
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    fireEvent.click(await screen.findByRole('button', { name: /Make reading questions/ }))

    expect(await screen.findByRole('heading', { name: /^Reading questions/ })).toBeInTheDocument()
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Answer key' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('reading-questions')
  })
})
