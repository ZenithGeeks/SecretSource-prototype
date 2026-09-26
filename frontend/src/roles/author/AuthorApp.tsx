/**
 * Author role router: which screen is showing, rendered inside the shared AppShell with the
 * Author nav (Home, Library, Find a source, History — Figma 558:3647 and on). `?screen=`
 * deep-links a screen, `?draft=` the draft Check a draft / the editor work on, `?file=` /
 * `?line=` where the editor puts the cursor, `?project=` a project in the Library, `?q=` the
 * Find a source query, `?replace=` the citation it should replace, and `?analysis=` the
 * analysis open on History — mirroring ResearcherApp's param scheme.
 *
 * Home is Check a draft. History is the Researcher's History (the same components, through
 * useHistoryWorkspace). Settings is a modal from the profile menu, not a screen of its own.
 */

import { History as HistoryIcon, Home as HomeIcon, Library as LibraryIcon, Pen, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useHistoryWorkspace } from '../../components/HistoryWorkspace'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import type { EditorTarget } from './editorTarget'
import { DraftCheck, type ReplacementRequest } from './screens/DraftCheck'
import { Editor } from './screens/Editor'
import { FindASource } from './screens/FindASource'
import { Library } from './screens/Library'

type NavKey = 'home' | 'library' | 'find-source' | 'history'
export type AuthorScreen = NavKey | 'editor'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
  { key: 'find-source', label: 'Find a source', icon: Search },
  { key: 'history', label: 'History', icon: HistoryIcon },
]

// The editor is reached from Check a draft and counts as the Home section in the nav.
const NAV_FOR: Record<AuthorScreen, NavKey> = {
  home: 'home',
  editor: 'home',
  library: 'library',
  'find-source': 'find-source',
  history: 'history',
}

type Params = {
  screen: AuthorScreen
  draftId: string | null
  target: EditorTarget | null
  projectId: string | null
  query: string
  replacement: ReplacementRequest | null
}

function readParams(): Params {
  const params = new URLSearchParams(window.location.search)
  const s = params.get('screen') as AuthorScreen | null
  const line = Number(params.get('line'))
  const draftId = params.get('draft')
  // ?replace=<checkId>:<citationId>, with ?draft= and ?q= carrying the rest.
  const replace = params.get('replace')?.split(':')
  const query = params.get('q') ?? ''
  const screen = s && s in NAV_FOR ? s : params.get('analysis') ? 'history' : 'home'
  return {
    screen,
    draftId,
    target: draftId ? { draftId, file: params.get('file') ?? undefined, line: Number.isFinite(line) && line > 0 ? line : undefined } : null,
    projectId: params.get('project'),
    query,
    replacement:
      replace && replace.length === 2 && draftId ? { draftId, checkId: replace[0], citationId: replace[1], claim: query } : null,
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
  set('q', state.screen === 'find-source' ? state.query : null)
  set('replace', state.screen === 'find-source' && state.replacement ? `${state.replacement.checkId}:${state.replacement.citationId}` : null)
  set('analysis', state.screen === 'history' ? analysis : null)
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function AuthorApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [initial] = useState(readParams)
  const [screen, setScreen] = useState<AuthorScreen>(initial.screen)
  const [draftId, setDraftId] = useState<string | null>(initial.draftId)
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(initial.screen === 'editor' ? initial.target : null)
  const [projectId, setProjectId] = useState<string | null>(initial.projectId)
  const [query, setQuery] = useState(initial.query)
  const [replacement, setReplacement] = useState<ReplacementRequest | null>(initial.replacement)
  const [wide, setWide] = useState(false) // a page viewer is open beside the cards
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const history = useHistoryWorkspace()

  useEffect(
    () => syncParams({ screen, draftId, target: editorTarget, projectId, query, replacement }, history.selected),
    [screen, draftId, editorTarget, projectId, query, replacement, history.selected],
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
  const findSource = (request?: ReplacementRequest) => {
    setReplacement(request ?? null)
    if (request) {
      setDraftId(request.draftId)
      setQuery(request.claim)
    }
    navigate('find-source')
  }

  // The editor is full-bleed with its own top bar, so it renders outside the sidebar shell.
  if (screen === 'editor' && draftId) {
    return (
      <Editor
        key={draftId}
        target={editorTarget ?? { draftId }}
        onFileChange={(file) => setEditorTarget({ draftId, file })}
        onNavigate={(next) => navigate(next)}
        onSearch={(q) => {
          setReplacement(null)
          setQuery(q)
          navigate('find-source')
        }}
        onFindReplacement={findSource}
      />
    )
  }

  return (
    <AppShell
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={(key) => {
        if (key === 'find-source') setReplacement(null)
        navigate(key)
      }}
      role="Author"
      roleIcon={Pen}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      wide={wide || (screen === 'history' && history.wide)}
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
          onFindSource={findSource}
          onTargetChange={setWide}
        />
      )}
      {screen === 'library' && (
        <Library
          projectId={projectId}
          onOpenProject={setProjectId}
          onOpenEditor={(id, file, line) => openEditor({ draftId: id, file, line })}
          onFindSource={findSource}
          onOpenDraft={openDraft}
        />
      )}
      {screen === 'find-source' && (
        <FindASource
          key={replacement ? `${replacement.checkId}:${replacement.citationId}` : 'free'}
          initialQuery={query}
          replacement={replacement ?? undefined}
          onQueryChange={setQuery}
          onReplaced={(id) => {
            setReplacement(null)
            openDraft(id)
          }}
          onTargetChange={setWide}
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
