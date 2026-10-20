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
 *
 * Ask (in every screen's toolbar) opens the assistant panel. Its chat lives here, so it stays
 * through screen changes; on Graph the panel is a tab of the graph's own right panel.
 */

import { Home as HomeIcon, Library as LibraryIcon, ListChecks, Microscope, Sparkles, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import type { AskAbout } from '../../components/AssistantPanel'
import { AssistantPanel } from '../../components/AssistantPanel'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { PageViewer, type Target } from '../../components/PageViewer'
import { SettingsModal } from '../../components/SettingsModal'
import { api, paperName } from '../../lib/api'
import type { AskContext } from '../../lib/assistant'
import { shortTitle, useAssistant } from '../../lib/assistant'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { useAnalyses } from '../../lib/useAnalysis'
import { cn } from '../../lib/utils'
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

  const assistant = useAssistant()
  const [askOpen, setAskOpen] = useState(false)
  const [graphNode, setGraphNode] = useState<{ id: string; label: string } | null>(null)
  // The paper or node whose chip the reader removed: questions about it go to the whole
  // library. Opening a different paper or node brings the chip back.
  const [cleared, setCleared] = useState<string | null>(null)
  const [source, setSource] = useState<Target | null>(null)
  const { data: analyses = [] } = useAnalyses()
  const titles = Object.fromEntries(
    analyses.flatMap((a) => (a.file && a.title ? [[paperName(a.file), shortTitle(a.title)]] : [])),
  )

  const onGraph = screen === 'graph' || screen === 'field-consensus'
  // What is on screen to ask about: the open analysis, or the selected graph node.
  const analysis = screen === 'analyses' && history.selected !== cleared ? history.selected : null
  const node = onGraph && graphNode && graphNode.id !== cleared ? graphNode : null
  const context: AskContext = { screen, analysis: analysis ?? undefined, node: node?.id }
  const about: AskAbout = analysis
    ? { kind: 'paper', label: titles[paperName(history.selectedName ?? '')] || history.selectedName || 'this paper' }
    : node
      ? { kind: 'node', label: node.label }
      : { kind: 'library', label: 'your library' }

  /** Opens a statement's page with its quote marked, when the quote can be found on it. */
  async function showSource(target: Target) {
    const found = target.quote ? await api.findInPaper(target.paper, target.quote, target.page).catch(() => null) : null
    setSource({ ...target, source: found?.page ? (found as Target['source']) : null })
  }

  const askPanel = askOpen && (
    <AssistantPanel
      assistant={assistant}
      context={context}
      about={about}
      titles={titles}
      onClearAbout={() => setCleared(analysis ?? node?.id ?? null)}
      onClose={() => setAskOpen(false)}
      onShowSource={(target) => void showSource(target)}
    />
  )

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
      toolbarLead={
        <button
          type="button"
          onClick={() => setAskOpen(!askOpen)}
          aria-pressed={askOpen}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium lg:min-h-8',
            askOpen ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-ink hover:bg-accent-soft',
          )}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {/* Icon only on a phone, where the toolbar also holds the breadcrumb and the screen's own actions. */}
          <span className="sr-only sm:not-sr-only">Ask</span>
        </button>
      }
      panel={onGraph ? undefined : askPanel}
    >
      {screen === 'home' && <Home onOpen={navigate} onOpenAnalysis={openAnalysis} />}
      {screen === 'library' && (
        <Library onAddPaper={() => navigate('analyses')} onOpenAnalysis={openAnalysis} />
      )}
      {(screen === 'graph' || screen === 'field-consensus') && (
        <Graph
          onOpenAnalysis={openAnalysis}
          initialTab={screen === 'field-consensus' ? 'consensus' : 'graph'}
          askPanel={askPanel || undefined}
          onSelectNode={setGraphNode}
        />
      )}
      {screen === 'analyses' && history.main}
      {source && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-4" role="dialog" aria-modal="true" aria-label={source.label}>
          <PageViewer target={source} onClose={() => setSource(null)} className="h-[90vh] w-full max-w-4xl" />
        </div>
      )}
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
