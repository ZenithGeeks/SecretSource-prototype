/**
 * Author role router (the folder still says "writer" until the rename PR): which screen is
 * showing, rendered inside the shared AppShell with the Author nav. `?screen=` deep-links a
 * screen, `?draft=` the draft Check a draft / the editor work on, and `?file=` / `?line=`
 * where the editor puts the cursor — mirroring ResearcherApp's param scheme.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Pen, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import type { EditorTarget } from '../author/editorTarget'
import { DraftCheck } from '../author/screens/DraftCheck'
import { FindASource } from './screens/FindASource'
import { Home } from './screens/Home'

type NavKey = 'home' | 'library' | 'graph' | 'history'
// Settings is screen-only — opened from the profile menu, not the nav (as in Figma).
export type WriterScreen = 'home' | 'draft-check' | 'editor' | 'find-source' | 'graph' | 'history' | 'settings'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

// Draft check and the editor are reached from Home's "Check a draft" action and count as
// the Home section in the nav. Library's one screen is Find a source, so its nav key routes
// straight there. Settings lights nothing (the profile button carries its own active state).
const NAV_FOR: Record<WriterScreen, NavKey | null> = {
  home: 'home',
  'draft-check': 'home',
  editor: 'home',
  'find-source': 'library',
  graph: 'graph',
  history: 'history',
  settings: null,
}

/** The draft Check a draft opens when the URL names none. */
const DEFAULT_DRAFT_ID = 'd1'

function screenForNav(key: NavKey): WriterScreen {
  return key === 'library' ? 'find-source' : key
}

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen') as WriterScreen | null
  const line = Number(params.get('line'))
  return {
    screen: s && s in NAV_FOR ? s : ('home' as WriterScreen),
    draftId: params.get('draft') ?? DEFAULT_DRAFT_ID,
    target: {
      draftId: params.get('draft') ?? DEFAULT_DRAFT_ID,
      file: params.get('file') ?? undefined,
      line: Number.isFinite(line) && line > 0 ? line : undefined,
    } satisfies EditorTarget,
  }
}

/** Keeps `?screen=`, `?draft=`, `?file=`, `?line=` in sync with what's showing, so a refresh
 * reopens the same place. Reads the URL fresh each time so Root's own `?role=` is untouched. */
function syncParams(screen: WriterScreen, draftId: string, target: EditorTarget | null) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', screen)
  params.set('draft', draftId)
  if (screen === 'editor' && target?.file) params.set('file', target.file)
  else params.delete('file')
  if (screen === 'editor' && target?.line) params.set('line', String(target.line))
  else params.delete('line')
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="font-serif text-2xl font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">{detail ?? 'Not built yet.'}</p>
    </div>
  )
}

export function WriterApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [initial] = useState(readParams)
  const [screen, setScreen] = useState<WriterScreen>(initial.screen)
  const [draftId, setDraftId] = useState(initial.draftId)
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(
    initial.screen === 'editor' ? initial.target : null,
  )

  useEffect(() => syncParams(screen, draftId, editorTarget), [screen, draftId, editorTarget])

  const navigate = (next: WriterScreen) => setScreen(next)

  const openEditor = (target: EditorTarget) => {
    setDraftId(target.draftId)
    setEditorTarget(target)
    navigate('editor')
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={(key) => navigate(screenForNav(key))}
      role="Author"
      roleIcon={Pen}
      onChangeRole={onChangeRole}
      onOpenSettings={() => navigate('settings')}
      settingsActive={screen === 'settings'}
    >
      {screen === 'home' && (
        <Home onOpenDraftCheck={() => navigate('draft-check')} onOpenFindSource={() => navigate('find-source')} />
      )}
      {screen === 'draft-check' && (
        <DraftCheck
          key={draftId}
          draftId={draftId}
          onSelectDraft={setDraftId}
          onOpenEditor={openEditor}
          onOpenHistory={() => navigate('history')}
        />
      )}
      {screen === 'editor' && (
        <Placeholder
          title="LaTeX editor"
          detail={`Arrives in the next PR. Draft ${draftId}${editorTarget?.file ? ` · ${editorTarget.file}` : ''}${
            editorTarget?.line ? ` L${editorTarget.line}` : ''
          }`}
        />
      )}
      {screen === 'find-source' && <FindASource onCiteBestMatch={() => navigate('draft-check')} />}
      {screen === 'graph' && <Placeholder title="Graph" />}
      {screen === 'history' && <Placeholder title="History" />}
      {screen === 'settings' && <Placeholder title="Settings" />}
    </AppShell>
  )
}
