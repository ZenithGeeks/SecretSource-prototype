/**
 * Writer role router: which writer screen is showing, rendered inside the shared
 * AppShell with the writer nav. `?screen=` deep-links one, mirroring ResearcherApp.
 * Replacing a citation (from either Draft check or Find a source) hands the new label
 * to Citation replaced for its toast.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Pen, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useWriterActions } from '../../lib/useWriter'
import { DEFAULT_FILTER_KINDS } from '../../lib/writer'
import { CitationReplaced } from './screens/CitationReplaced'
import { DraftCheck } from './screens/DraftCheck'
import { FindASource } from './screens/FindASource'
import { Home } from './screens/Home'

type NavKey = 'home' | 'library' | 'graph' | 'history'
// Settings is screen-only — opened from the profile menu, not the nav (as in Figma).
export type WriterScreen = 'home' | 'draft-check' | 'citation-replaced' | 'find-source' | 'graph' | 'history' | 'settings'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

// Draft check and Citation replaced are reached from Home's "Check a draft" action and
// count as the Home section in the nav, same as the old router's isActive did. Library's
// one screen is Find a source, so its nav key routes straight there. Settings lights nothing
// (the profile button carries its own active state).
const NAV_FOR: Record<WriterScreen, NavKey | null> = {
  home: 'home',
  'draft-check': 'home',
  'citation-replaced': 'home',
  'find-source': 'library',
  graph: 'graph',
  history: 'history',
  settings: null,
}

function screenForNav(key: NavKey): WriterScreen {
  return key === 'library' ? 'find-source' : key
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

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="font-serif text-2xl font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">Not built yet.</p>
    </div>
  )
}

export function WriterApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [screen, setScreen] = useState<WriterScreen>(initialScreen)
  const [replacedCitation, setReplacedCitation] = useState<string | null>(null)
  const actions = useWriterActions()

  useEffect(() => syncScreenParam(screen), [screen])

  const navigate = (next: WriterScreen) => setScreen(next)

  const replaceCitation = (citationLabel: string) => {
    setReplacedCitation(citationLabel)
    navigate('citation-replaced')
  }

  /** Opens Draft check, optionally deep-linked to a draft, a claim to jump to, or a
   * verdict filter — read by the Draft check screen itself. */
  const openDraftCheck = (opts?: { draftId?: string; claimId?: string; filter?: string }) => {
    const params = new URLSearchParams(window.location.search)
    if (opts?.draftId) params.set('draft', opts.draftId)
    else params.delete('draft')
    if (opts?.claimId) params.set('claim', opts.claimId)
    else params.delete('claim')
    if (opts?.filter) params.set('filter', opts.filter)
    else params.delete('filter')
    params.set('screen', 'draft-check')
    window.history.replaceState(null, '', `?${params.toString()}`)
    setScreen('draft-check')
  }

  const newDraft = () => {
    const id = actions.createDraft()
    openDraftCheck({ draftId: id })
  }

  /** Draft check's "Replace citation" hands off to Find a source with the claim as context,
   * per the #4/#5 contract — Find a source applies the swap and returns here with `?claim=`. */
  const goToFindSource = (claimId: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set('claim', claimId)
    params.set('screen', 'find-source')
    window.history.replaceState(null, '', `?${params.toString()}`)
    setScreen('find-source')
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={(key) => navigate(screenForNav(key))}
      role="Writer"
      roleIcon={Pen}
      onChangeRole={onChangeRole}
      onOpenSettings={() => navigate('settings')}
      settingsActive={screen === 'settings'}
    >
      {screen === 'home' && (
        <Home
          onNewDraft={newDraft}
          onOpenFindSource={() => navigate('find-source')}
          onFixReferences={() => openDraftCheck({ filter: DEFAULT_FILTER_KINDS.join(',') })}
          onOpenClaim={(claimId) => openDraftCheck({ claimId })}
        />
      )}
      {screen === 'draft-check' && <DraftCheck onGoToFindSource={goToFindSource} />}
      {screen === 'citation-replaced' && (
        <CitationReplaced newCitationLabel={replacedCitation} onBackToDraft={() => navigate('draft-check')} />
      )}
      {screen === 'find-source' && <FindASource onCiteBestMatch={replaceCitation} />}
      {screen === 'graph' && <Placeholder title="Graph" />}
      {screen === 'history' && <Placeholder title="History" />}
      {screen === 'settings' && <Placeholder title="Settings" />}
    </AppShell>
  )
}
