/**
 * Author role router: which screen is showing, rendered inside the shared AppShell with the
 * Author sidebar of the Redesign (R/Sidebar, Role=Author): Home and Library, then Recent
 * projects. `?screen=` deep-links a screen, `?draft=` the draft Home and the editor work
 * on, `?file=` / `?line=` where the editor puts the cursor, and `?project=` a project in the
 * Library.
 *
 * The design's "Projects" item has no screen of its own (the projects are the Library's, and a
 * project's page lights Library), so it is left out. Home replaced the old Check a draft screen
 * (#717): an old link to it, like any screen this role does not know, opens Home. History and
 * Graph are the Researcher's screens and not part of this role
 * (#712): a bookmark to either, or to an analysis, opens the Library, where a draft's check
 * history lives. Settings is a modal from the profile menu, not a screen of its own. The editor
 * is full-bleed with its own top bar: the shell is bare there, but it is the same shell, so the
 * Ask panel beside it is not remounted and a Do it run goes on.
 */

import { Home as HomeIcon, Library as LibraryIcon, Pen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useAsk } from '../../components/Ask'
import { SettingsModal } from '../../components/SettingsModal'
import type { DraftReader } from '../../lib/agentTools'
import type { Role } from '../../lib/roles'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { NewProject } from './components/NewProject'
import { RecentProjects } from './components/RecentProjects'
import type { EditorTarget } from './editorTarget'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { UNSORTED } from './screens/ProjectDetail'
import { useProjectName } from '../../lib/useAuthor'

type NavKey = 'home' | 'library'
export type AuthorScreen = NavKey | 'editor'

const NAV: NavEntry<NavKey>[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'library', label: 'Library', icon: LibraryIcon },
]

// What Ask's Do it mode offers to try here: the Author's own work, not the Researcher's papers.
const DO_IT_EXAMPLES = ['What drafts do I have?', 'Open my library', 'Which citations in my latest draft aren’t supported?']
// On the editor, the draft on screen.
const EDITOR_EXAMPLES = ['What do lines 1–20 say?', 'Which keys are in my .bib?', 'Which citations in this draft aren’t supported?']

// The editor counts as the Home section in the nav, wherever it was opened from.
const NAV_FOR: Record<AuthorScreen, NavKey> = {
  home: 'home',
  editor: 'home',
  library: 'library',
}

/** Where a bookmark of a screen the Author role no longer has goes (#712). */
const MOVED: Record<string, AuthorScreen> = { history: 'library', graph: 'library' }
const MOVED_NOTICE = 'History and Graph are in the Researcher role now. A draft’s check history is on its project here.'

/** Where the editor was opened from, so its Back goes there: Home, or the Library itself or one
 * of its project pages (`projectId`, UNSORTED included). In the URL as `?from=library` with the
 * `?project=` it showed, so a refresh of the editor still goes back to the right place. */
type Origin = { screen: 'home' } | { screen: 'library'; projectId: string | null }

type Params = {
  screen: AuthorScreen
  /** The URL named a screen the Author role no longer has. */
  moved: boolean
  draftId: string | null
  target: EditorTarget | null
  projectId: string | null
  origin: Origin
}

function resolveScreen(params: URLSearchParams): { screen: AuthorScreen; moved: boolean } {
  const s = params.get('screen')
  if (s && Object.hasOwn(NAV_FOR, s)) return { screen: s as AuthorScreen, moved: false }
  if (s && Object.hasOwn(MOVED, s)) return { screen: MOVED[s], moved: true }
  // An analysis was open on the old History screen.
  if (params.get('analysis')) return { screen: 'library', moved: true }
  return { screen: 'home', moved: false }
}

function readParams(): Params {
  const params = new URLSearchParams(window.location.search)
  const line = Number(params.get('line'))
  const draftId = params.get('draft')
  const { screen, moved } = resolveScreen(params)
  return {
    screen,
    moved,
    draftId,
    target: draftId ? { draftId, file: params.get('file') ?? undefined, line: Number.isFinite(line) && line > 0 ? line : undefined } : null,
    projectId: params.get('project'),
    origin: screen === 'editor' && params.get('from') === 'library' ? { screen: 'library', projectId: params.get('project') } : { screen: 'home' },
  }
}

/** Keeps the URL in step with what's showing, so a refresh reopens the same place. Reads the
 * URL fresh each time so Root's own `?role=` is untouched. */
function syncParams(state: Omit<Params, 'moved'>) {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', state.screen)
  const set = (key: string, value: string | null | undefined) => (value ? params.set(key, value) : params.delete(key))
  set('draft', state.draftId)
  set('file', state.screen === 'editor' ? state.target?.file : null)
  set('line', state.screen === 'editor' && state.target?.line ? String(state.target.line) : null)
  const fromLibrary = state.screen === 'editor' && state.origin.screen === 'library'
  set('from', fromLibrary ? 'library' : null)
  set('project', state.screen === 'library' ? state.projectId : fromLibrary && state.origin.screen === 'library' ? state.origin.projectId : null)
  // What left the Author role's URLs: the old sources search, and History's open analysis.
  params.delete('q')
  params.delete('replace')
  params.delete('analysis')
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function AuthorApp({ onChangeRole, onSwitchRole }: { onChangeRole?: () => void; onSwitchRole?: (role: Role) => void }) {
  const [initial] = useState(readParams)
  const [screen, setScreen] = useState<AuthorScreen>(initial.screen)
  const [draftId, setDraftId] = useState<string | null>(initial.draftId)
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(initial.screen === 'editor' ? initial.target : null)
  // On the editor opened from a project page, ?project= is the origin's, not a Library page.
  const [projectId, setProjectId] = useState<string | null>(initial.screen === 'library' ? initial.projectId : null)
  const [origin, setOrigin] = useState<Origin>(initial.origin)
  const originProject = useProjectName(origin.screen === 'library' ? origin.projectId : null)
  const [wide, setWide] = useState(false) // a page viewer is open beside the cards
  const [creatingProject, setCreatingProject] = useState(false)
  // A bookmarked ?screen=settings (the old Settings screen) opens the modal over Home.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  // A bookmark of a screen this role no longer has says where it went. The id keeps a remount
  // (StrictMode, a role switch back) from stacking a second copy.
  useEffect(() => {
    if (initial.moved) toast.info(MOVED_NOTICE, { id: 'author-moved', duration: 10_000 })
  }, [initial.moved])
  // The open editor's reader for read_draft; set while the editor is mounted.
  const draftReader = useRef<DraftReader | null>(null)
  const onAgentApi = useCallback((api: DraftReader | null) => {
    draftReader.current = api
  }, [])

  useEffect(() => syncParams({ screen, draftId, target: editorTarget, projectId, origin }), [screen, draftId, editorTarget, projectId, origin])

  const navigate = useCallback((next: AuthorScreen) => {
    setScreen(next)
    setWide(false)
  }, [])
  /** The sidebar's Library opens the Library itself, not the last project opened in it. */
  const navigateFromSidebar = useCallback(
    (next: NavKey) => {
      if (next === 'library') setProjectId(null)
      navigate(next)
    },
    [navigate],
  )
  const openProject = useCallback(
    (id: string) => {
      setProjectId(id)
      navigate('library')
    },
    [navigate],
  )

  const openEditor = (target: EditorTarget) => {
    // Opened again from the editor itself (Ask's open_screen), it keeps where it came from.
    if (screen !== 'editor') setOrigin(screen === 'library' ? { screen: 'library', projectId } : { screen: 'home' })
    setDraftId(target.draftId)
    setEditorTarget(target)
    navigate('editor')
  }
  const back =
    origin.screen === 'home'
      ? { label: 'Home', onClick: () => navigate('home') }
      : {
          label:
            origin.projectId === null
              ? 'Library'
              : origin.projectId === UNSORTED
                ? 'Unsorted'
                : (originProject ?? 'the project'),
          onClick: () => {
            setProjectId(origin.projectId)
            navigate('library')
          },
        }
  // Do it for the Author's screen agent, so a role switch can land here and the chat can go on.
  const ask = useAsk({
    role: 'writer',
    screen,
    // On the editor, just "Ask AI": Answer still asks the library, Do it reads the draft.
    scope: screen === 'editor' ? '' : undefined,
    actions: {
      role: 'writer',
      screen,
      draftId: draftId ?? undefined,
      // The editor opens the draft Home has selected, so only once there is one.
      screens: draftId ? ['home', 'library', 'editor'] : ['home', 'library'],
      openScreen: (next) => {
        if (next === 'home' || next === 'library') navigateFromSidebar(next)
        else if (next === 'editor' && draftId) openEditor({ draftId })
      },
      // No openPaper: an MCP client's open_paper fails rather than switching roles past the
      // Switch approval and the unsaved-edit prompt.
      switchRole: onSwitchRole,
      examples: screen === 'editor' ? EDITOR_EXAMPLES : DO_IT_EXAMPLES,
      draftEditor: () => draftReader.current,
    },
  })

  return (
    <div className="redesign-app">
    <AppShell
      bare={screen === 'editor' && draftId !== null}
      nav={NAV}
      active={NAV_FOR[screen]}
      onNavigate={navigateFromSidebar}
      role="Author"
      roleIcon={Pen}
      onChangeRole={onChangeRole}
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      wide={wide}
      sidebar={<RecentProjects activeId={screen === 'library' ? projectId : null} onOpen={openProject} onNew={() => setCreatingProject(true)} />}
      // The toolbar is where Ask lives, so every framed Author screen has one; the bare editor
      // puts the Ask button in its own top bar.
      breadcrumb={[NAV.find((n) => n.key === NAV_FOR[screen])?.label ?? 'Home']}
      toolbarLead={ask.button}
      panel={ask.panel}
    >
      {screen === 'editor' && draftId !== null && (
        <Editor
          key={draftId}
          target={editorTarget ?? { draftId }}
          onFileChange={(file) => setEditorTarget({ draftId, file })}
          onNavigate={(next) => navigate(next)}
          // Outlives the editor: its last write can be refused after the author left it.
          onWriteFailed={(message) => toast.error(message, { duration: 10_000 })}
          onAgentApi={onAgentApi}
          askSlot={ask.button}
          back={back}
          onOpenProject={openProject}
          onAskToFix={ask.askToDo}
        />
      )}
      {screen === 'home' && (
        <Home
          draftId={draftId}
          onSelectDraft={setDraftId}
          onOpenEditor={openEditor}
          onOpenHistory={(draft) => {
            setProjectId(draft.projectId ?? 'unsorted')
            navigate('library')
          }}
          onNewProject={() => setCreatingProject(true)}
          onTargetChange={setWide}
        />
      )}
      {screen === 'library' && (
        <Library
          projectId={projectId}
          draftId={draftId}
          onOpenProject={setProjectId}
          onOpenEditor={(id, file, line) => openEditor({ draftId: id, file, line })}
          onDraftDeleted={(id) => setDraftId((current) => (current === id ? null : current))}
        />
      )}
      {ask.viewer}
      <NewProject open={creatingProject} onClose={() => setCreatingProject(false)} onCreated={openProject} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="writer"
        onSwitchRole={onChangeRole ?? (() => {})}
      />
    </AppShell>
    </div>
  )
}
