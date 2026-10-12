/**
 * Researcher role router: which researcher screen is showing, rendered inside the shared
 * AppShell with the researcher nav. `?screen=` deep-links one and `?analysis=` opens that
 * analysis on Analyses (formerly History: `?screen=history` still opens it, and the URL is
 * rewritten to `analyses`). field-consensus now lives inside the Graph tab as a Consensus toggle, so
 * it lights the Graph nav and the `field-consensus` screen opens the Graph with that tab active.
 *
 * Analyses is where a paper gets analyzed (Figma row "Analyze a paper"): the form and the
 * results in main. The recent analyses list sits under the nav on every screen. Home's "Analyze a paper" action and
 * Library's "Add paper" both land there.
 */

import { Home as HomeIcon, Library as LibraryIcon, ListChecks, Microscope, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { Graph } from './screens/Graph'
import { Home } from './screens/Home'
import { Library } from './screens/Library'

type NavKey = 'home' | 'analyses' | 'library' | 'graph'
// field-consensus is screen-only — reachable and deep-linkable, but with no nav entry of its
// own. Settings is a modal (Figma 22), opened from the profile menu, not a screen.
export type ResearcherScreen = NavKey | 'field-consensus'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'analyses', label: 'Analyses', icon: ListChecks },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
]

// Which nav item lights for each screen; null means none (field-consensus now lives in the Graph
// tab as a Consensus toggle, so it lights Graph; Settings lights nothing — the profile button
// carries its own active state instead).
const NAV_FOR: Record<ResearcherScreen, NavKey | null> = {
  home: 'home',
  library: 'library',
  'field-consensus': 'graph',
  graph: 'graph',
  analyses: 'analyses',
}

function initialScreen(): ResearcherScreen {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen')
  // Old links say `history`; the screen is called Analyses now.
  if (s === 'history') return 'analyses'
  if (s && s in NAV_FOR) return s as ResearcherScreen
  return params.get('analysis') ? 'analyses' : 'home'
}

/** Keeps `?screen=`/`?analysis=` in sync with what's showing, so a refresh reopens the same
 * screen and, on Analyses, the same analysis (#132) instead of the params only ever being
 * read at mount. Reads the URL fresh each time so Root's own `?role=` param is untouched. */
function syncScreenParams(screen: ResearcherScreen, selected: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', screen)
  if (screen === 'analyses' && selected) params.set('analysis', selected)
  else params.delete('analysis')
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function ResearcherApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [screen, setScreen] = useState<ResearcherScreen>(initialScreen)
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  // Analyses (the form, the results, the page viewer, the sidebar list and its table of
  // contents) is shared with the Author role through this hook. Picking a recent analysis or
  // "+ New" in the sidebar brings the Analyses screen up from wherever the reader is.
  const history = useHistoryWorkspace({ onPicked: () => setScreen('analyses') })

  useEffect(() => syncScreenParams(screen, history.selected), [screen, history.selected])

  const navigate = (next: ResearcherScreen) => {
    setScreen(next)
    history.closePage()
  }
  /** Open one analysis on Analyses, from anywhere a paper or claim is listed. */
  const openAnalysis = (id: string) => {
    history.open(id)
    navigate('analyses')
  }

  const breadcrumb =
    screen === 'analyses'
      ? history.selectedName
        ? ['Analyses', history.selectedName]
        : ['Analyses']
      : [NAV.find((n) => n.key === NAV_FOR[screen])?.label ?? 'Home']

  return (
    <div className="researcher-app">
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={navigate}
      role="Researcher"
      roleIcon={Microscope}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      // Graph is a whole-screen canvas, so give it the wide shell too (Analyses uses it for the
      // page viewer).
      wide={(screen === 'analyses' && history.wide) || screen === 'graph' || screen === 'field-consensus'}
      sidebar={history.sidebar}
      breadcrumb={breadcrumb}
    >
      {screen === 'home' && <Home onOpen={navigate} onOpenAnalysis={openAnalysis} />}
      {screen === 'library' && (
        <Library onAddPaper={() => navigate('analyses')} onOpenAnalysis={openAnalysis} />
      )}
      {(screen === 'graph' || screen === 'field-consensus') && (
        <Graph onOpenAnalysis={openAnalysis} initialTab={screen === 'field-consensus' ? 'consensus' : 'graph'} />
      )}
      {screen === 'analyses' && history.main}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="researcher"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
    </div>
  )
}
