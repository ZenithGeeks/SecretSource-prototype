/**
 * Teacher role router.
 *
 * The shared AppShell owns the sidebar. This role router owns only teacher destinations and
 * keeps the unbuilt destinations explicit, so adding another teacher page does not require
 * changing the essay-check screen.
 */

import { GraduationCap, Home as HomeIcon, Library as LibraryIcon, Settings, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { EssayCheck } from './screens/EssayCheck'
import { AssignmentDetail } from './screens/AssignmentDetail'
import { Classes } from './screens/Classes'
import { Classwork } from './screens/Classwork'
import { Home } from './screens/Home'
import { ReadingQuestions } from './screens/ReadingQuestions'

type NavKey = 'home' | 'classes' | 'library' | 'graph' | 'settings'
export type TeacherScreen =
  | NavKey
  | 'essay-check'
  | 'reading-questions'
  | 'class-library'
  | 'class-note'
  | 'classwork'
  | 'assignment-detail'

type TeacherRoute = {
  screen: TeacherScreen
  courseId?: string
  courseWorkId?: string
  studentId?: string
}

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'classes', label: 'Classes', icon: GraduationCap },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'settings', label: 'Settings', icon: Settings },
]

// Essay check is a detail screen reached from Classes, so Classes remains highlighted.
const NAV_FOR: Record<TeacherScreen, NavKey> = {
  home: 'home',
  classes: 'classes',
  library: 'library',
  graph: 'graph',
  settings: 'settings',
  'essay-check': 'classes',
  'reading-questions': 'library',
  'class-library': 'library',
  'class-note': 'classes',
  classwork: 'classes',
  'assignment-detail': 'classes',
}

const PLACEHOLDER_TITLES: Record<Exclude<TeacherScreen, 'home'>, string> = {
  classes: 'Classes',
  library: 'Library',
  graph: 'Graph',
  settings: 'Settings',
  'essay-check': 'Check student essays',
  'reading-questions': 'Make reading questions',
  'class-library': 'Class library',
  'class-note': 'Class note',
  classwork: 'Classwork',
  'assignment-detail': 'Assignment details',
}

function initialRoute(): TeacherRoute {
  const params = new URLSearchParams(window.location.search)
  const screen = params.get('screen') as TeacherScreen | null
  if (!screen || !(screen in NAV_FOR)) return { screen: 'home' }
  return {
    screen,
    courseId: params.get('courseId') ?? undefined,
    courseWorkId: params.get('courseWorkId') ?? undefined,
    studentId: params.get('studentId') ?? undefined,
  }
}

/** Keep refreshes on the same teacher destination without replacing Root's `?role=` param. */
function syncRoute(route: TeacherRoute) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', route.screen)
  for (const key of ['courseId', 'courseWorkId', 'studentId'] as const) {
    if (route[key]) params.set(key, route[key]!)
    else params.delete(key)
  }
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

function screenForNav(key: NavKey): TeacherScreen {
  return key
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="font-serif text-2xl font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">Not built yet.</p>
    </div>
  )
}

export function TeacherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [route, setRoute] = useState<TeacherRoute>(initialRoute)

  useEffect(() => syncRoute(route), [route])

  const navigate = (next: TeacherScreen, context: Omit<TeacherRoute, 'screen'> = {}) =>
    setRoute({ screen: next, ...context })

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[route.screen]}
      onNavigate={(key) => navigate(screenForNav(key))}
      role="Teacher"
      roleIcon={GraduationCap}
      onChangeRole={onChangeRole}
      // The prototype teacher screens use the full available width of the role shell.
      wide
    >
      {route.screen === 'home' ? (
        <Home onOpen={navigate} />
      ) : route.screen === 'classes' ? (
        <Classes onOpenCourse={(course) => navigate('classwork', { courseId: course.id })} />
      ) : route.screen === 'classwork' ? (
        <Classwork
          courseId={route.courseId ?? ''}
          onBack={() => navigate('classes')}
          onOpenAssignment={(courseWorkId) => navigate('assignment-detail', { courseId: route.courseId, courseWorkId })}
        />
      ) : route.screen === 'assignment-detail' ? (
        <AssignmentDetail
          courseId={route.courseId ?? ''}
          courseWorkId={route.courseWorkId ?? ''}
          onBack={() => navigate('classwork', { courseId: route.courseId })}
          onOpenEssay={(studentId) => navigate('essay-check', {
            courseId: route.courseId,
            courseWorkId: route.courseWorkId,
            studentId,
          })}
        />
      ) : route.screen === 'essay-check' ? (
        <EssayCheck
          studentId={route.studentId}
          courseId={route.courseId}
          courseWorkId={route.courseWorkId}
          onNavigate={(student) => setRoute((current) => ({ ...current, studentId: student.id }))}
          onBack={() => navigate('assignment-detail', { courseId: route.courseId, courseWorkId: route.courseWorkId })}
        />
      ) : route.screen === 'reading-questions' ? (
        <ReadingQuestions />
      ) : (
        <Placeholder title={PLACEHOLDER_TITLES[route.screen]} />
      )}
    </AppShell>
  )
}
