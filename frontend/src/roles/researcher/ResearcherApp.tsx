/**
 * Researcher role router: which researcher screen is showing, rendered inside the shared
 * AppShell with the researcher nav. `?screen=` deep-links one and `?analysis=` opens that
 * analysis on Analyses (formerly History: `?screen=history` still opens it, and the URL is
 * rewritten to `analyses`). "Ask the field" (`?screen=field-consensus`) has its own nav item; it is
 * the Graph component on its Consensus tab, with the Graph | Ask the field switch left out.
 *
 * Analyses is where a paper gets analyzed (Figma row "Analyze a paper"): the form and the
 * results in main. The recent analyses list sits under the nav on every screen. Home's "Analyze a paper" action and
 * Library's "Add paper" both land there.
 *
 * Ask (in every screen's toolbar) opens the assistant panel. Its chat lives here, so it stays
 * through screen changes; on Graph the panel is a tab of the graph's own right panel.
 */

import { MotionConfig } from 'framer-motion'
import { Home as HomeIcon, Library as LibraryIcon, ListChecks, MessageSquareQuote, Microscope, Waypoints } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { type AskNode, useAsk } from '../../components/Ask'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { SettingsModal } from '../../components/SettingsModal'
import type { Role } from '../../lib/roles'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { Graph } from './screens/Graph'
import { Home } from './screens/Home'
import { Library } from './screens/Library'

// Settings is a modal (Figma 22), opened from the profile menu, not a screen.
type NavKey = 'home' | 'analyses' | 'library' | 'graph' | 'field-consensus'
export type ResearcherScreen = NavKey

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'analyses', label: 'Analyses', icon: ListChecks },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'field-consensus', label: 'Ask the field', icon: MessageSquareQuote },
]

const NAV_LABEL = Object.fromEntries(NAV.map((entry) => [entry.key, entry.label])) as Record<NavKey, string>

const SCREENS = new Set<string>(NAV.map((entry) => entry.key))

function initialScreen(): ResearcherScreen {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen')
  // Old links say `history`; the screen is called Analyses now.
  if (s === 'history') return 'analyses'
  if (s && SCREENS.has(s)) return s as ResearcherScreen
  return params.get('analysis') ? 'analyses' : 'home'
}

/** Keeps `?screen=`/`?analysis=` in sync with what's showing, so a refresh reopens the same
 * screen and, on Analyses, the same analysis (#132) instead of the params only ever being
 * read at mount. Reads the URL fresh each time so Root's own `?role=` param is untouched. */
function syncScreenParams(screen: ResearcherScreen, selected: string | null, keepHistory: boolean) {
  const params = new URLSearchParams(window.location.search)
  // A new screen is a new history entry, so Back returns to the screen before it. Opening a
  // different analysis on the same screen only rewrites the entry it is on.
  const newScreen = keepHistory && params.get('screen') !== screen
  params.set('screen', screen)
  if (screen === 'analyses' && selected) params.set('analysis', selected)
  else params.delete('analysis')
  if (newScreen) window.history.pushState(null, '', `?${params}`)
  else window.history.replaceState(null, '', `?${params}`)
}

const NOTHING_TO_GRAPH = {
  title: 'Nothing to graph yet',
  hint: 'Analyze a paper on Home. Its claims and the works they cite show up here.',
}

export function ResearcherApp({ onChangeRole, onSwitchRole }: { onChangeRole?: () => void; onSwitchRole?: (role: Role) => void }) {
  const [screen, setScreen] = useState<ResearcherScreen>(initialScreen)
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  // Analyses (the form, the results, the page viewer, the sidebar list and its table of
  // contents) is shared with the Author role through this hook. Picking a recent analysis or
  // "+ New" in the sidebar brings the Analyses screen up from wherever the reader is.
  const history = useHistoryWorkspace({ onPicked: () => setScreen('analyses') })

  // The first sync only normalises the URL it opened with; later ones follow the reader.
  const synced = useRef(false)
  useEffect(() => {
    syncScreenParams(screen, history.selected, synced.current)
    synced.current = true
  }, [screen, history.selected])
  // Back and Forward: show the screen (and analysis) the address now names.
  const openFromHistory = history.open
  useEffect(() => {
    const onPop = () => {
      setScreen(initialScreen())
      const analysis = new URLSearchParams(window.location.search).get('analysis')
      if (analysis) openFromHistory(analysis)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [openFromHistory])

  const [graphNode, setGraphNode] = useState<AskNode | null>(null)
  const onGraph = screen === 'graph' || screen === 'field-consensus'
  const navigate = (next: ResearcherScreen) => {
    setScreen(next)
    history.closePage()
  }
  /** Open one analysis on Analyses, from anywhere a paper or claim is listed. */
  const openAnalysis = (id: string) => {
    history.open(id)
    navigate('analyses')
  }

  // What is on screen to ask about: the open analysis, or the selected graph node.
  const ask = useAsk({
    role: 'researcher',
    screen,
    analysis: screen === 'analyses' ? history.selected : null,
    analysisFile: history.selectedName,
    node: onGraph ? graphNode : null,
    // What Ask's Do it mode may do here: the sidebar's screens, and opening a paper.
    actions: {
      role: 'researcher',
      screen,
      screens: NAV.map((entry) => entry.key),
      openScreen: (next) => navigate(next as ResearcherScreen),
      openPaper: openAnalysis,
      switchRole: onSwitchRole,
    },
  })

  const breadcrumb =
    screen === 'analyses'
      ? history.selectedName
        ? ['Analyses', history.selectedName]
        : ['Analyses']
      : [NAV_LABEL[screen]]

  return (
    // reducedMotion="user": every fade and slide on these screens stops for people who ask the OS for less motion.
    <MotionConfig reducedMotion="user">
    <div className="redesign-app">
    <AppShell
      nav={NAV}
      active={screen}
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
      toolbarLead={ask.button}
      // On Graph the panel is a tab of the graph's own right panel.
      panel={onGraph ? undefined : ask.panel}
    >
      {screen === 'home' && <Home onOpen={navigate} onOpenAnalysis={openAnalysis} />}
      {screen === 'library' && (
        <Library onAddPaper={() => navigate('analyses')} onOpenAnalysis={openAnalysis} />
      )}
      {(screen === 'graph' || screen === 'field-consensus') && (
        <Graph
          onOpenAnalysis={openAnalysis}
          // The two have their own nav items, so the Graph | Ask the field switch is left out.
          // key: moving between them in the nav remounts Graph on the right tab.
          key={screen}
          hideTabs
          initialTab={screen === 'field-consensus' ? 'consensus' : 'graph'}
          emptyMessage={NOTHING_TO_GRAPH}
          askPanel={ask.panel}
          onSelectNode={setGraphNode}
        />
      )}
      {screen === 'analyses' && history.main}
      {ask.viewer}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="researcher"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
    </div>
    </MotionConfig>
  )
}
