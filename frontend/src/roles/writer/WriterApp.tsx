/**
 * Writer role router: which writer screen is showing, rendered inside the writer's own
 * shell (Sidebar — a plain-CSS shell for now; AppShell/Tailwind adoption is a follow-up).
 * `?screen=` deep-links one, mirroring ResearcherApp. Replacing a citation (from either
 * Draft check or Find a source) hands the new label to Citation replaced for its toast.
 */

import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/Sidebar'
import { Sidebar } from '../../components/Sidebar'
import '../../styles/global.css'
import { CitationReplaced } from './screens/CitationReplaced'
import { DraftCheck } from './screens/DraftCheck'
import { FindASource } from './screens/FindASource'
import { Home } from './screens/Home'

type NavKey = 'home' | 'library' | 'graph' | 'history' | 'settings'
export type WriterScreen = 'home' | 'draft-check' | 'citation-replaced' | 'find-source'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: '/icons/icon-home.svg', activeIcon: '/icons/icon-home-active.svg' },
  { key: 'library', label: 'Library', icon: '/icons/icon-library.svg', activeIcon: '/icons/icon-library-active.svg' },
  { key: 'graph', label: 'Graph', icon: '/icons/icon-graph.svg', activeIcon: '/icons/icon-graph.svg', disabled: true },
  { key: 'history', label: 'History', icon: '/icons/icon-history.svg', activeIcon: '/icons/icon-history.svg', disabled: true },
  { key: 'settings', label: 'Settings', icon: '/icons/icon-settings.svg', activeIcon: '/icons/icon-settings.svg', disabled: true },
]

// Draft check and Citation replaced are reached from Home's "Check a draft" action and
// count as the Home section in the nav, same as the old router's isActive did.
const NAV_FOR: Record<WriterScreen, NavKey> = {
  home: 'home',
  'draft-check': 'home',
  'citation-replaced': 'home',
  'find-source': 'library',
}

// The writer has one screen per nav key that goes anywhere (Library's is Find a source);
// Graph/History/Settings have no screen yet, so their nav entries are disabled instead.
const SCREEN_FOR_NAV: Record<NavKey, WriterScreen> = {
  home: 'home',
  library: 'find-source',
  graph: 'home',
  history: 'home',
  settings: 'home',
}

function initialScreen(): WriterScreen {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen') as WriterScreen | null
  if (s && s in NAV_FOR) return s
  return 'home'
}

/** Keeps `?screen=` in sync with what's showing, so a refresh reopens the same screen.
 * Reads the URL fresh each time so Root's own `?role=` param is untouched. */
function syncScreenParam(screen: WriterScreen) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', screen)
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function WriterApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [screen, setScreen] = useState<WriterScreen>(initialScreen)
  const [replacedCitation, setReplacedCitation] = useState<string | null>(null)

  useEffect(() => syncScreenParam(screen), [screen])

  const navigate = (next: WriterScreen) => setScreen(next)

  const replaceCitation = (citationLabel: string) => {
    setReplacedCitation(citationLabel)
    navigate('citation-replaced')
  }

  return (
    <div className="app" data-page={screen}>
      <Sidebar
        nav={NAV}
        active={NAV_FOR[screen]}
        onNavigate={(key) => navigate(SCREEN_FOR_NAV[key])}
        roleChange
        onChangeRole={onChangeRole}
      />

      <main className="main">
        {screen === 'home' && (
          <Home onOpenDraftCheck={() => navigate('draft-check')} onOpenFindSource={() => navigate('find-source')} />
        )}
        {screen === 'draft-check' && <DraftCheck onReplaceCitation={replaceCitation} />}
        {screen === 'citation-replaced' && (
          <CitationReplaced newCitationLabel={replacedCitation} onBackToDraft={() => navigate('draft-check')} />
        )}
        {screen === 'find-source' && <FindASource onCiteBestMatch={replaceCitation} />}
      </main>
    </div>
  )
}
