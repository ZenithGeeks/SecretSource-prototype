/** Teacher role route owner. Every destination is URL-backed so refresh keeps the current page. */

import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, GraduationCap, Home as HomeIcon, Settings as SettingsIcon, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { teacherWorkspaceKey } from '../../lib/teacher'
import {
  parseTeacherRoute,
  serializeTeacherRoute,
  teacherNavForScreen,
  teacherRouteForNav,
  type TeacherNavKey,
  type TeacherRoute,
  type TeacherScreen,
} from '../../lib/teacherRoutes'
import { useImportTeacherClass } from '../../lib/useTeacher'
import { teacherApi, teacherRemoteEnabled } from '../../lib/teacher'
import { supabase } from '../../lib/supabase'
import { AssignmentDetail } from './screens/AssignmentDetail'
import { EssayCheckRoster } from './components/EssayCheckRoster'
import { AddClass } from './screens/AddClass'
import { Classes } from './screens/Classes'
import { ClassWorkspace } from './screens/ClassWorkspace'
import { EssayCheck } from './screens/EssayCheck'
import { Home } from './screens/Home'
import { ReadingQuestions } from './screens/ReadingQuestions'
import { Settings } from './screens/Settings'

export type { TeacherRoute, TeacherScreen }

const TEACHER_NAV: NavEntry<TeacherNavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'classes', label: 'Classes', icon: GraduationCap },
  { key: 'library', label: 'Library', icon: BookOpen },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
]

function placeholderTitle(screen: TeacherScreen): string {
  return screen === 'graph' ? 'Graph' : 'Teacher page'
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
      <p className="font-serif text-2xl font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">This teacher destination is outside the updated frontend scope.</p>
    </div>
  )
}

export function TeacherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const queryClient = useQueryClient()
  const [route, setRoute] = useState<TeacherRoute>(() => parseTeacherRoute(window.location.search))
  const [connectionError, setConnectionError] = useState('')
  const importClass = useImportTeacherClass()

  useEffect(() => {
    const nextSearch = serializeTeacherRoute(route, window.location.search)
    window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`)
  }, [route])

  const navigate = (next: TeacherRoute) => setRoute(next)
  const navigateNav = (key: TeacherNavKey) => navigate(teacherRouteForNav(key))
  const workspaceTab = route.screen === 'classwork' ? 'classwork' : route.screen === 'people' ? 'people' : 'overview'

  const refreshWorkspace = () => {
    if (route.courseId) void queryClient.invalidateQueries({ queryKey: teacherWorkspaceKey(route.courseId) })
  }

  const handleImport = (courseId: string) => {
    importClass.mutate(courseId, { onSuccess: () => navigate({ screen: 'class-overview', courseId }) })
  }
  const connectGoogle = async () => {
    setConnectionError('')
    try {
      if (!teacherRemoteEnabled) return navigate({ screen: 'add-class-course' })
      const { data } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const { authorizationUrl } = await teacherApi.startGoogleConnection(data.session?.user.email)
      window.location.assign(authorizationUrl)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Google connection could not start. Try again.')
    }
  }

  return (
    <AppShell
      nav={TEACHER_NAV}
      active={teacherNavForScreen(route.screen)}
      onNavigate={navigateNav}
      role="Teacher"
      roleIcon={GraduationCap}
      onChangeRole={onChangeRole}
      onOpenSettings={() => navigate({ screen: 'settings' })}
      settingsActive={route.screen === 'settings'}
      sidebar={route.screen === 'essay-check' ? (
        <EssayCheckRoster
          courseId={route.courseId ?? ''}
          assignmentId={route.assignmentId ?? ''}
          selectedStudentId={route.studentId ?? ''}
          onSelect={(studentId) => navigate({ ...route, studentId })}
        />
      ) : undefined}
      wide
    >
      {route.screen === 'home' ? (
        <Home onOpen={navigate} />
      ) : route.screen === 'classes' ? (
        <Classes onOpenClass={(courseId) => navigate({ screen: 'class-overview', courseId })} onAddClass={() => navigate({ screen: 'add-class-connect' })} />
      ) : route.screen === 'add-class-connect' ? (
        <AddClass step="connect" error={connectionError} onBack={() => navigate({ screen: 'classes' })} onContinue={() => void connectGoogle()} onSelectCourse={() => undefined} onImport={handleImport} />
      ) : route.screen === 'add-class-course' ? (
        <AddClass step="course" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-connect' })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} />
      ) : route.screen === 'add-class-review' ? (
        <AddClass step="review" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-course', courseId: route.courseId })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} />
      ) : route.screen === 'class-overview' || route.screen === 'classwork' || route.screen === 'people' ? (
        <ClassWorkspace courseId={route.courseId ?? ''} tab={workspaceTab} onNavigate={navigate} onRefresh={refreshWorkspace} />
      ) : route.screen === 'assignment-detail' ? (
        <AssignmentDetail courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} onOpenEssay={(studentId) => navigate({ screen: 'essay-check', courseId: route.courseId, assignmentId: route.assignmentId, studentId })} />
      ) : route.screen === 'essay-check' ? (
        <EssayCheck courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} studentId={route.studentId ?? ''} onNavigate={(studentId) => navigate({ ...route, studentId })} onBack={() => navigate({ screen: 'assignment-detail', courseId: route.courseId, assignmentId: route.assignmentId })} />
      ) : route.screen === 'reading-questions' ? (
        <ReadingQuestions paperId={route.paperId} />
      ) : route.screen === 'settings' ? (
        <Settings />
      ) : (
        <Placeholder title={placeholderTitle(route.screen)} />
      )}
    </AppShell>
  )
}
