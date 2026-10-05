/**
 * Researcher role router: which researcher screen is showing, rendered inside the shared
 * AppShell with the researcher nav. `?screen=` deep-links one and `?analysis=` opens that
 * analysis on History. field-consensus now lives inside the Graph tab as a Consensus toggle, so
 * it lights the Graph nav and the `field-consensus` screen opens the Graph with that tab active.
 *
 * History is where a paper gets analyzed (Figma row "Analyze a paper"): the form and the
 * results in main, past analyses under the nav. Home's "Analyze a paper" action and
 * Library's "Add paper" both land there.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Microscope, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { Graph } from './screens/Graph'
import { Home } from './screens/Home'
import { Library } from './screens/Library'

type NavKey = 'home' | 'library' | 'graph' | 'history'
// field-consensus is screen-only — reachable and deep-linkable, but with no nav entry of its
// own. Settings is a modal (Figma 22), opened from the profile menu, not a screen.
export type ResearcherScreen = NavKey | 'field-consensus'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

// Which nav item lights for each screen; null means none (field-consensus now lives in the Graph
// tab as a Consensus toggle, so it lights Graph; Settings lights nothing — the profile button
// carries its own active state instead).
const NAV_FOR: Record<ResearcherScreen, NavKey | null> = {
  home: 'home',
  library: 'library',
  'field-consensus': 'graph',
  graph: 'graph',
  history: 'history',
}

function initialScreen(): ResearcherScreen {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen') as ResearcherScreen | null
  if (s && s in NAV_FOR) return s
  return params.get('analysis') ? 'history' : 'home'
}

/** Keeps `?screen=`/`?analysis=` in sync with what's showing, so a refresh reopens the same
 * screen and, on History, the same analysis (#132) instead of the params only ever being
 * read at mount. Reads the URL fresh each time so Root's own `?role=` param is untouched. */
function syncScreenParams(screen: ResearcherScreen, selected: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', screen)
  if (screen === 'history' && selected) params.set('analysis', selected)
  else params.delete('analysis')
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function ResearcherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [screen, setScreen] = useState<ResearcherScreen>(initialScreen)
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  // History (the form, the results, the page viewer, the sidebar list and its table of
  // contents) is shared with the Author role through this hook.
  const history = useHistoryWorkspace()

  useEffect(() => syncScreenParams(screen, history.selected), [screen, history.selected])

  const navigate = (next: ResearcherScreen) => {
    setScreen(next)
    history.closePage()
  }
  /** Open one analysis in History, from anywhere a paper or claim is listed. */
  const openAnalysis = (id: string) => {
    history.open(id)
    navigate('history')
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={navigate}
      role="Researcher"
      roleIcon={Microscope}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      // Graph is a whole-screen canvas, so give it the wide shell too (History uses it for the
      // page viewer).
      wide={(screen === 'history' && history.wide) || screen === 'graph' || screen === 'field-consensus'}
      sidebar={screen === 'history' ? history.sidebar : undefined}
    >
      {screen === 'home' && <Home onOpen={navigate} onOpenAnalysis={openAnalysis} />}
      {screen === 'library' && (
        <Library onAddPaper={() => navigate('history')} onOpenAnalysis={openAnalysis} />
      )}
      {(screen === 'graph' || screen === 'field-consensus') && (
        <Graph onOpenAnalysis={openAnalysis} initialTab={screen === 'field-consensus' ? 'consensus' : 'graph'} />
      )}
      {screen === 'history' && history.main}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="researcher"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
  )
}
