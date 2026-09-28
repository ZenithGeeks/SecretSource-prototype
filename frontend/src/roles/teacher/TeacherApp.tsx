/** Teacher role route owner. Every destination is URL-backed so refresh keeps the current page. */

import { GraduationCap, History as HistoryIcon, Home as HomeIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import {
  parseTeacherRoute,
  serializeTeacherRoute,
  teacherNavForScreen,
  teacherRouteForNav,
  type TeacherNavKey,
  type TeacherRoute,
  type TeacherScreen,
} from '../../lib/teacherRoutes'
import { useImportTeacherClass, useRefreshTeacherClass } from '../../lib/useTeacher'
import { teacherApi, teacherRemoteEnabled } from '../../lib/teacher'
import { supabase } from '../../lib/supabase'
import { AssignmentDetail } from './screens/AssignmentDetail'
import { EssayCheckRoster } from './components/EssayCheckRoster'
import { TeacherHistoryList, TeacherHistoryPage } from './screens/History'
import { AddClass } from './screens/AddClass'
import { Classes } from './screens/Classes'
import { ClassWorkspace } from './screens/ClassWorkspace'
import { EssayCheck } from './screens/EssayCheck'
import { Home } from './screens/Home'
import { ReadingQuestions } from './screens/ReadingQuestions'

export type { TeacherRoute, TeacherScreen }

const TEACHER_NAV: NavEntry<TeacherNavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'classes', label: 'Classes', icon: GraduationCap },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

export function TeacherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [route, setRoute] = useState<TeacherRoute>(() => parseTeacherRoute(window.location.search))
  const [connectionError, setConnectionError] = useState('')
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const importClass = useImportTeacherClass()
  const refreshClass = useRefreshTeacherClass()

  useEffect(() => {
    const nextSearch = serializeTeacherRoute(route, window.location.search)
    window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`)
  }, [route])

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseTeacherRoute(window.location.search))
      setSettingsOpen(settingsRequested(window.location.search))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (next: TeacherRoute) => {
    const nextSearch = serializeTeacherRoute(next, window.location.search)
    window.history.pushState(null, '', `${window.location.pathname}${nextSearch}`)
    setRoute(next)
  }
  const navigateNav = (key: TeacherNavKey) => {
    if (key === 'settings') {
      setSettingsOpen(true)
      return
    }
    navigate(teacherRouteForNav(key))
  }
  const workspaceTab = route.screen === 'classwork' ? 'classwork' : route.screen === 'people' ? 'people' : 'overview'

  const refreshWorkspace = () => {
    if (route.courseId) refreshClass.mutate(route.courseId)
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
    <div className="teacher-app">
    <AppShell
      nav={TEACHER_NAV}
      active={settingsOpen ? 'settings' : teacherNavForScreen(route.screen)}
      onNavigate={navigateNav}
      role="Teacher"
      roleIcon={GraduationCap}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      sidebar={route.screen === 'history' && route.courseId && route.assignmentId && route.studentId ? (
        <TeacherHistoryList
          selected={route}
          onSelect={(entry) => navigate({ screen: 'history', courseId: entry.courseId, assignmentId: entry.assignmentId, studentId: entry.studentId })}
        />
      ) : route.screen === 'essay-check' ? (
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
        <Classes onOpenClass={(courseId) => navigate({ screen: 'class-overview', courseId })} onOpenHome={() => navigate({ screen: 'home' })} onAddClass={() => navigate({ screen: 'add-class-connect' })} onConnectGoogle={connectGoogle} connectionError={connectionError} />
      ) : route.screen === 'add-class-connect' ? (
        <AddClass step="connect" error={connectionError} onBack={() => navigate({ screen: 'classes' })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => void connectGoogle()} onSelectCourse={() => undefined} onImport={handleImport} />
      ) : route.screen === 'add-class-course' ? (
        <AddClass step="course" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-connect' })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} />
      ) : route.screen === 'add-class-review' ? (
        <AddClass step="review" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-course', courseId: route.courseId })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} />
      ) : route.screen === 'class-overview' || route.screen === 'classwork' || route.screen === 'people' ? (
        <ClassWorkspace courseId={route.courseId ?? ''} tab={workspaceTab} onNavigate={navigate} onRefresh={refreshWorkspace} refreshing={refreshClass.isPending} />
      ) : route.screen === 'assignment-detail' ? (
        <AssignmentDetail courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} onOpenEssay={(studentId) => navigate({ screen: 'essay-check', courseId: route.courseId, assignmentId: route.assignmentId, studentId })} onNavigate={navigate} onRefresh={refreshWorkspace} refreshing={refreshClass.isPending} />
      ) : route.screen === 'essay-check' ? (
        <EssayCheck courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} studentId={route.studentId ?? ''} onBack={() => navigate({ screen: 'assignment-detail', courseId: route.courseId, assignmentId: route.assignmentId })} onNavigate={navigate} onReconnectGoogle={() => void connectGoogle()} />
      ) : route.screen === 'history' ? (
        route.courseId && route.assignmentId && route.studentId ? (
          <EssayCheck courseId={route.courseId} assignmentId={route.assignmentId} studentId={route.studentId} onBack={() => navigate({ screen: 'history' })} onNavigate={navigate} onReconnectGoogle={() => void connectGoogle()} />
        ) : <TeacherHistoryPage onSelect={(entry) => navigate({ screen: 'history', courseId: entry.courseId, assignmentId: entry.assignmentId, studentId: entry.studentId })} />
      ) : route.screen === 'reading-questions' ? (
        <ReadingQuestions paperId={route.paperId} onNavigate={navigate} />
      ) : null}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="teacher"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
    </div>
  )
}
