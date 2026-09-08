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
import { Home } from './screens/Home'
import { ReadingQuestions } from './screens/ReadingQuestions'

type NavKey = 'home' | 'classes' | 'library' | 'graph' | 'settings'
export type TeacherScreen = NavKey | 'essay-check' | 'reading-questions' | 'class-library' | 'class-note'

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
}

function initialScreen(): TeacherScreen {
  const screen = new URLSearchParams(window.location.search).get('screen') as TeacherScreen | null
  if (screen && screen in NAV_FOR) return screen
  return 'home'
}

/** Keep refreshes on the same teacher destination without replacing Root's `?role=` param. */
function syncScreenParam(screen: TeacherScreen) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', screen)
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

function screenForNav(key: NavKey): TeacherScreen {
  // Classes owns the delivered essay-review destination. The remaining nav entries keep
  // their own placeholder until those teacher pages are implemented.
  return key === 'classes' ? 'essay-check' : key
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
  const [screen, setScreen] = useState<TeacherScreen>(initialScreen)

  useEffect(() => syncScreenParam(screen), [screen])

  const navigate = (next: TeacherScreen) => setScreen(next)

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={(key) => navigate(screenForNav(key))}
      role="Teacher"
      roleIcon={GraduationCap}
      onChangeRole={onChangeRole}
      // The prototype teacher screens use the full available width of the role shell.
      wide
    >
      {screen === 'home' ? (
        <Home onOpen={navigate} />
      ) : screen === 'essay-check' ? (
        <EssayCheck />
      ) : screen === 'reading-questions' ? (
        <ReadingQuestions />
      ) : (
        <Placeholder title={PLACEHOLDER_TITLES[screen]} />
      )}
    </AppShell>
  )
}
