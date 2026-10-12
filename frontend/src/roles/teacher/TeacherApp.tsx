/** Teacher role route owner. Every destination is URL-backed so refresh keeps the current page. */

import { GraduationCap, Home as HomeIcon, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell, ToolbarActions } from '../../components/AppShell'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { markTeacherGoogleReturn } from '../../lib/teacherGoogleReturn'
import {
  parseTeacherRoute,
  serializeTeacherRoute,
  teacherNavForScreen,
  teacherRouteForNav,
  type TeacherNavKey,
  type TeacherRoute,
  type TeacherScreen,
} from '../../lib/teacherRoutes'
import { useImportTeacherClass, useRefreshTeacherClass, useTeacherGoogleConnection } from '../../lib/useTeacher'
import { teacherApi, teacherRemoteEnabled } from '../../lib/teacher'
import { supabase } from '../../lib/supabase'
import { AssignmentDetail } from './screens/AssignmentDetail'
import { TeacherSidebar } from './components/TeacherSidebar'
import { TeacherHistoryPage } from './screens/History'
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
]

export function TeacherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [route, setRoute] = useState<TeacherRoute>(() => parseTeacherRoute(window.location.search))
  const [connectionError, setConnectionError] = useState('')
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const importClass = useImportTeacherClass()
  const refreshClass = useRefreshTeacherClass()
  const googleConnection = useTeacherGoogleConnection()

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

  const navigate = useCallback((next: TeacherRoute) => {
    const destination = next.screen === 'add-class-connect' && googleConnection.data?.connected
      ? { screen: 'add-class-course' } satisfies TeacherRoute
      : next
    const nextSearch = serializeTeacherRoute(destination, window.location.search)
    window.history.pushState(null, '', `${window.location.pathname}${nextSearch}`)
    setRoute(destination)
  }, [googleConnection.data?.connected])
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
  const startGoogleAuthorization = async () => {
    setConnectionError('')
    try {
      if (!teacherRemoteEnabled) return navigate({ screen: 'add-class-course' })
      const { data } = await supabase?.auth.getSession() ?? { data: { session: null } }
      const { authorizationUrl } = await teacherApi.startGoogleConnection(data.session?.user.email)
      markTeacherGoogleReturn()
      window.location.assign(authorizationUrl)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Google connection could not start. Try again.')
    }
  }
  const connectGoogle = async () => {
    setConnectionError('')
    if (!teacherRemoteEnabled) return navigate({ screen: 'add-class-course' })
    try {
      const connection = await teacherApi.getGoogleConnection()
      if (connection.connected) return navigate({ screen: 'add-class-course' })
    } catch {
      // If connection status is temporarily unavailable, let OAuth provide a fresh connection.
    }
    await startGoogleAuthorization()
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
      sidebar={
        <>
          <TeacherClassSearch onOpenClasses={() => navigate({ screen: 'classes' })} />
          <TeacherSidebar onOpen={navigate} />
        </>
      }
      breadcrumb={breadcrumbFor(route)}
      wide
    >
      {route.screen === 'classes' && (
        <ToolbarActions>
          <ButtonAddClass onClick={() => navigate({ screen: 'add-class-connect' })} />
        </ToolbarActions>
      )}
      {route.screen === 'home' ? (
        <Home onOpen={navigate} />
      ) : route.screen === 'classes' ? (
        <Classes onOpenClass={(courseId) => navigate({ screen: 'class-overview', courseId })} onOpenHome={() => navigate({ screen: 'home' })} onConnectGoogle={connectGoogle} connectionError={connectionError} />
      ) : route.screen === 'add-class-connect' ? (
        <AddClass step="connect" error={connectionError} onBack={() => navigate({ screen: 'classes' })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => void connectGoogle()} onSelectCourse={() => undefined} onImport={handleImport} />
      ) : route.screen === 'add-class-course' ? (
        <AddClass step="course" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-connect' })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} onReconnectGoogle={() => void startGoogleAuthorization()} />
      ) : route.screen === 'add-class-review' ? (
        <AddClass step="review" selectedCourseId={route.courseId} onBack={() => navigate({ screen: 'add-class-course', courseId: route.courseId })} onClasses={() => navigate({ screen: 'classes' })} onContinue={() => navigate({ screen: 'add-class-review', courseId: route.courseId })} onSelectCourse={(courseId) => navigate({ screen: 'add-class-course', courseId })} onImport={handleImport} importing={importClass.isPending} importError={importClass.variables === route.courseId && importClass.error ? importClass.error instanceof Error ? importClass.error.message : 'Class import failed. Please try again.' : undefined} />
      ) : route.screen === 'class-overview' || route.screen === 'classwork' || route.screen === 'people' ? (
        <ClassWorkspace courseId={route.courseId ?? ''} tab={workspaceTab} onNavigate={navigate} onRefresh={refreshWorkspace} refreshing={refreshClass.isPending} />
      ) : route.screen === 'assignment-detail' ? (
        <AssignmentDetail courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} onOpenEssay={(studentId) => navigate({ screen: 'essay-check', courseId: route.courseId, assignmentId: route.assignmentId, studentId })} onNavigate={navigate} />
      ) : route.screen === 'essay-check' ? (
        <EssayCheck courseId={route.courseId ?? ''} assignmentId={route.assignmentId ?? ''} studentId={route.studentId ?? ''} onBack={() => navigate({ screen: 'assignment-detail', courseId: route.courseId, assignmentId: route.assignmentId })} onReconnectGoogle={() => void connectGoogle()} />
      ) : route.screen === 'history' ? (
        route.courseId && route.assignmentId && route.studentId ? (
          <EssayCheck courseId={route.courseId} assignmentId={route.assignmentId} studentId={route.studentId} onBack={() => navigate({ screen: 'history' })} onReconnectGoogle={() => void connectGoogle()} />
        ) : <TeacherHistoryPage onSelect={(entry) => navigate({ screen: 'history', courseId: entry.courseId, assignmentId: entry.assignmentId, studentId: entry.studentId })} />
      ) : route.screen === 'reading-questions' ? (
        <ReadingQuestions paperId={route.paperId} />
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

function TeacherClassSearch({ onOpenClasses }: { onOpenClasses: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenClasses}
      aria-label="Search classes"
      className="flex h-[36px] w-full items-center gap-2 rounded-[8px] border border-border-subtle bg-canvas px-2.5 text-left text-[11px] text-ink-muted hover:border-accent"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1">Search classes</span>
      <kbd className="text-[10px]">⌘K</kbd>
    </button>
  )
}

const SCREEN_LABELS: Record<TeacherScreen, string> = {
  home: 'Home',
  classes: 'Classes',
  history: 'Recently viewed',
  'add-class-connect': 'Add class',
  'add-class-course': 'Add class',
  'add-class-review': 'Add class',
  'class-overview': 'Class overview',
  classwork: 'Classwork',
  people: 'People',
  'assignment-detail': 'Assignment',
  'essay-check': 'Essay review',
  'reading-questions': 'Reading questions',
}

/** The toolbar trail: Classes, then the screen (Home and Recently viewed stand alone). */
function breadcrumbFor(route: TeacherRoute): string[] {
  const label = SCREEN_LABELS[route.screen]
  return route.screen === 'home' || route.screen === 'history' || route.screen === 'classes' ? [label] : ['Classes', label]
}

function ButtonAddClass({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[11px] font-medium text-white hover:opacity-90"><Plus className="size-3.5" />Add class</button>
}
