/**
 * Researcher role router: which researcher screen is showing, rendered inside the shared
 * AppShell with the researcher nav. `?screen=` deep-links one and `?analysis=` opens that
 * analysis on History. field-consensus is reached from Home's "What does the field say"
 * action and lights the Library nav (as in Figma).
 *
 * History is where a paper gets analyzed (Figma row "Analyze a paper"): the form and the
 * results in main, past analyses under the nav. Home's "Analyze a paper" action and
 * Library's "Add paper" both land there.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Microscope, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { HistoryList } from '../../components/HistoryList'
import { useAnalyses } from '../../lib/useAnalysis'
import { useProjects } from '../../lib/useResearcher'
import { FieldConsensus } from './screens/FieldConsensus'
import { Graph } from './screens/Graph'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { PaperDetail } from './screens/PaperDetail'
import { Settings as SettingsScreen } from './screens/Settings'

type NavKey = 'home' | 'library' | 'graph' | 'history' | 'settings'
export type ResearcherScreen = NavKey | 'field-consensus'

// Settings is intentionally not in the nav — it lives in the profile menu (AppShell footer).
const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: HistoryIcon },
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
  const [paper, setPaper] = useState<{ projectId: string; id: string } | null>(() => {
    const p = new URLSearchParams(window.location.search)
    const pid = p.get('project')
    const paperId = p.get('paper')
    return pid && paperId ? { projectId: pid, id: paperId } : null
  })
  const [wide, setWide] = useState(false) // History has a page open beside the claims
  const analyses = useAnalyses()
  const projects = useProjects().data ?? []

  useEffect(() => syncScreenParams(screen, selected), [screen, selected])

  const navigate = (next: ResearcherScreen) => {
    setScreen(next)
    setPaper(null)
    setWide(false)
  }
  const select = (id: string | null) => {
    setSelected(id)
    setWide(false)
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={navigate}
      role="Researcher"
      roleIcon={Microscope}
      onChangeRole={onChangeRole}
      onOpenSettings={() => navigate('settings')}
      wide={wide}
      sidebar={
        screen === 'history' ? (
          <HistoryList analyses={analyses.data ?? []} selected={selected} onSelect={select} />
        ) : undefined
      }
    >
      {paper && (
        <PaperDetail
          projectId={paper.projectId}
          paperId={paper.id}
          projectName={projects.find((p) => p.id === paper.projectId)?.name ?? 'Library'}
          onBack={() => setPaper(null)}
        />
      )}
      {!paper && screen === 'home' && <Home onOpen={navigate} />}
      {!paper && screen === 'library' && (
        <Library
          onAddPaper={() => navigate('history')}
          onOpenPaper={(projectId, id) => setPaper({ projectId, id })}
        />
      )}
      {screen === 'field-consensus' && <FieldConsensus />}
      {screen === 'graph' && <Graph />}
      {screen === 'history' && (
        <History selected={selected} onSelect={select} onTargetChange={setWide} />
      )}
      {screen === 'settings' && <SettingsScreen onChangeRole={onChangeRole} />}
    </AppShell>
  )
}
