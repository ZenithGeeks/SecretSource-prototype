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

import type { SectionJump } from '../../components/AnalysisView'
import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { HistoryList } from '../../components/HistoryList'
import { SettingsModal } from '../../components/SettingsModal'
import { AnalysisContents } from '../../components/TableOfContents'
import type { ContentsRow } from '../../lib/outline'
import { useAnalyses } from '../../lib/useAnalysis'
import { Graph } from './screens/Graph'
import { History } from './screens/History'
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

function initialAnalysis(): string | null {
  return new URLSearchParams(window.location.search).get('analysis')
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
  const [selected, setSelected] = useState<string | null>(initialAnalysis)
  const [wide, setWide] = useState(false) // History has a page open beside the claims
  // The table of contents in the sidebar and the claims in main share these (#153).
  const [section, setSection] = useState<string | null>(null) // claims narrowed to one section
  const [current, setCurrent] = useState<string | null>(null) // section open in the page viewer
  const [jump, setJump] = useState<SectionJump | null>(null) // section page to open
  const [settingsOpen, setSettingsOpen] = useState(false)
  const analyses = useAnalyses()

  useEffect(() => syncScreenParams(screen, selected), [screen, selected])

  const navigate = (next: ResearcherScreen) => {
    setScreen(next)
    setWide(false)
  }
  const select = (id: string | null) => {
    setSelected(id)
    setWide(false)
    setSection(null)
    setCurrent(null)
    setJump(null)
  }
  const pickSection = (row: ContentsRow) => {
    setSection(row.n)
    setCurrent(row.n)
    setJump({ n: row.n, title: row.title, page: row.page, at: Date.now() })
    setWide(true)
  }
  /** Open one analysis in History, from anywhere a paper or claim is listed. */
  const openAnalysis = (id: string) => {
    select(id)
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
      wide={wide || screen === 'graph' || screen === 'field-consensus'}
      sidebar={
        screen === 'history' ? (
          <HistoryList
            analyses={analyses.data ?? []}
            selected={selected}
            onSelect={select}
            contents={selected ? <AnalysisContents id={selected} current={current} onPick={pickSection} /> : undefined}
          />
        ) : undefined
      }
    >
      {screen === 'home' && <Home onOpen={navigate} onOpenAnalysis={openAnalysis} />}
      {screen === 'library' && (
        <Library onAddPaper={() => navigate('history')} onOpenAnalysis={openAnalysis} />
      )}
      {(screen === 'graph' || screen === 'field-consensus') && (
        <Graph onOpenAnalysis={openAnalysis} initialTab={screen === 'field-consensus' ? 'consensus' : 'graph'} />
      )}
      {screen === 'history' && (
        <History
          selected={selected}
          onSelect={select}
          onTargetChange={setWide}
          section={section}
          onClearSection={() => setSection(null)}
          jump={jump}
          onCurrentSection={setCurrent}
        />
      )}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="researcher"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
  )
}
