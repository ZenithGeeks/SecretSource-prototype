/**
 * Researcher role router: which researcher screen is showing, rendered inside the shared
 * AppShell with the researcher nav. `?screen=` deep-links one. field-consensus is reached
 * from Home's "What does the field say" action and lights the Library nav (as in Figma).
 */

import { History, Home as HomeIcon, Library as LibraryIcon, Microscope, Settings, Waypoints } from 'lucide-react'
import { useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { FieldConsensus } from './screens/FieldConsensus'
import { Home } from './screens/Home'
import { Library } from './screens/Library'

type NavKey = 'home' | 'library' | 'graph' | 'history' | 'settings'
export type ResearcherScreen = NavKey | 'field-consensus'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: History },
  { key: 'settings', label: 'Settings', icon: Settings },
]

// field-consensus sits under the Library section in the nav.
const NAV_FOR: Record<ResearcherScreen, NavKey> = {
  home: 'home',
  library: 'library',
  'field-consensus': 'library',
  graph: 'graph',
  history: 'history',
  settings: 'settings',
}

function initialScreen(): ResearcherScreen {
  const s = new URLSearchParams(window.location.search).get('screen') as ResearcherScreen | null
  return s && s in NAV_FOR ? s : 'home'
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="font-serif text-2xl font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">Not built yet.</p>
    </div>
  )
}

export function ResearcherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [screen, setScreen] = useState<ResearcherScreen>(initialScreen)

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={setScreen}
      role="Researcher"
      roleIcon={Microscope}
      onChangeRole={onChangeRole}
    >
      {screen === 'home' && <Home onOpen={setScreen} />}
      {screen === 'library' && <Library />}
      {screen === 'field-consensus' && <FieldConsensus />}
      {screen === 'graph' && <Placeholder title="Graph" />}
      {screen === 'history' && <Placeholder title="History" />}
      {screen === 'settings' && <Placeholder title="Settings" />}
    </AppShell>
  )
}
