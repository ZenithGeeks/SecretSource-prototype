/**
 * Author role router: which screen is showing, rendered inside the shared AppShell with the
 * Author nav (Home, Library, Graph, History — Figma 558:3647 and on). `?screen=` deep-links
 * a screen, `?draft=` the draft Check a draft / the editor work on, `?file=` / `?line=` where
 * the editor puts the cursor, `?project=` a project in the Library, and `?analysis=` the
 * analysis open on History — mirroring ResearcherApp's param scheme.
 *
 * Home is Check a draft. Graph and History are the Researcher's screens (the same Graph
 * component, and History through useHistoryWorkspace), not copies: the Graph's papers open
 * on History here as they do there. Settings is a modal from the profile menu, not a screen
 * of its own.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Pen, Waypoints } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { Graph } from '../researcher/screens/Graph'
import type { EditorTarget } from './editorTarget'
import { DraftCheck } from './screens/DraftCheck'
import { Editor } from './screens/Editor'
import { Library } from './screens/Library'

type NavKey = 'home' | 'library' | 'graph' | 'history'
export type AuthorScreen = NavKey | 'editor'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'graph', label: 'Graph', icon: Waypoints },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

// The editor is reached from Check a draft and counts as the Home section in the nav.
const NAV_FOR: Record<AuthorScreen, NavKey> = {
  home: 'home',
  editor: 'home',
  library: 'library',
  graph: 'graph',
  history: 'history',
}

type Params = {
  screen: AuthorScreen
  draftId: string | null
  target: EditorTarget | null
  projectId: string | null
}

function readParams(): Params {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen') as AuthorScreen | null
  const line = Number(params.get('line'))
  const draftId = params.get('draft')
  const screen = s && s in NAV_FOR ? s : params.get('analysis') ? 'history' : 'home'
  return {
    screen,
    draftId,
    target: draftId ? { draftId, file: params.get('file') ?? undefined, line: Number.isFinite(line) && line > 0 ? line : undefined } : null,
    projectId: params.get('project'),
  }
}

/** Keeps the URL in step with what's showing, so a refresh reopens the same place. Reads the
 * URL fresh each time so Root's own `?role=` is untouched. */
function syncParams(state: Params, analysis: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', state.screen)
  const set = (key: string, value: string | null | undefined) => (value ? params.set(key, value) : params.delete(key))
  set('draft', state.draftId)
  set('file', state.screen === 'editor' ? state.target?.file : null)
  set('line', state.screen === 'editor' && state.target?.line ? String(state.target.line) : null)
  set('project', state.screen === 'library' ? state.projectId : null)
  set('analysis', state.screen === 'history' ? analysis : null)
  // The Find a source screen is gone; its bookmarked params go with it.
  params.delete('q')
  params.delete('replace')
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function AuthorApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [initial] = useState(readParams)
  const [screen, setScreen] = useState<AuthorScreen>(initial.screen)
  const [draftId, setDraftId] = useState<string | null>(initial.draftId)
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(initial.screen === 'editor' ? initial.target : null)
  const [projectId, setProjectId] = useState<string | null>(initial.projectId)
  const [wide, setWide] = useState(false) // a page viewer is open beside the cards
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const history = useHistoryWorkspace()

  useEffect(
    () => syncParams({ screen, draftId, target: editorTarget, projectId }, history.selected),
    [screen, draftId, editorTarget, projectId, history.selected],
  )

  const navigate = useCallback(
    (next: AuthorScreen) => {
      setScreen(next)
      setWide(false)
      history.closePage()
    },
    // closePage is a stable setter call
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const openEditor = (target: EditorTarget) => {
    setDraftId(target.draftId)
    setEditorTarget(target)
    navigate('editor')
  }
  const openDraft = useCallback(
    (id: string) => {
      setDraftId(id)
      navigate('home')
    },
    [navigate],
  )
  /** A paper picked on the Graph opens on History, as in ResearcherApp. */
  const openAnalysis = (id: string) => {
    history.open(id)
    navigate('history')
  }

  // The editor is full-bleed with its own top bar, so it renders outside the sidebar shell.
  if (screen === 'editor' && draftId) {
    return (
      <Editor
        key={draftId}
        target={editorTarget ?? { draftId }}
        onFileChange={(file) => setEditorTarget({ draftId, file })}
        onNavigate={(next) => navigate(next)}
      />
    )
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={navigate}
      role="Author"
      roleIcon={Pen}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      // The Graph is a whole-screen canvas, so it gets the wide shell (History uses it for the
      // page viewer).
      wide={wide || (screen === 'history' && history.wide) || screen === 'graph'}
      sidebar={screen === 'history' ? history.sidebar : undefined}
    >
      {screen === 'home' && (
        <DraftCheck
          key={draftId ?? 'none'}
          draftId={draftId}
          onSelectDraft={setDraftId}
          onOpenEditor={openEditor}
          onOpenHistory={(draft) => {
            setProjectId(draft.projectId ?? 'unsorted')
            navigate('library')
          }}
          onTargetChange={setWide}
        />
      )}
      {screen === 'library' && (
        <Library
          projectId={projectId}
          draftId={draftId}
          onOpenProject={setProjectId}
          onOpenEditor={(id, file, line) => openEditor({ draftId: id, file, line })}
          onOpenDraft={openDraft}
        />
      )}
      {screen === 'graph' && (
        <Graph
          onOpenAnalysis={openAnalysis}
          emptyMessage={{
            title: 'Nothing to graph yet',
            hint: 'The graph is built from analysed papers. Analyse one on History and it appears here with the claims it makes and the works it cites.',
          }}
        />
      )}
      {screen === 'history' && history.main}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="writer"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
  )
}
