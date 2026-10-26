/**
 * App shell / temporary router. No routing library yet, so a small screen state stands in:
 * onboarding picks a role, which opens that role's home. `?role=` deep-links a screen, and
 * without it the role this browser opened last (lib/lastRole.ts) opens, so the picker shows
 * only on a first visit or from the role "change" link.
 *
 * Role teams: build your screens in src/roles/<role>/ (own folder — no collisions), export
 * a <Role>App component, then wire its case below. That one case is the only
 * shared-file edit a role needs.
 */

import { lazy, Suspense, useEffect, useState } from 'react'

import { LoadingScreen } from './components/ui'
import { authEnabled, supabase } from './lib/supabase'
import { clearLastRole, isRole, loadLastRole, saveLastRole } from './lib/lastRole'
import { clearDoItConversation } from './lib/doItConversation'
import { consumeTeacherGoogleReturn } from './lib/teacherGoogleReturn'
import { useAuth } from './lib/useAuth'
import { Auth } from './screens/auth/Auth'
import type { Role } from './lib/roles'

// Each role's screens load when that role opens, so a labeler does not download the
// researcher's graph or the author's editor.
// The picker too: a returning visitor opens their last role and never needs it.
const Onboarding = lazy(() => import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })))
const LabelerApp = lazy(() => import('./roles/labeler/LabelerApp').then((m) => ({ default: m.LabelerApp })))
const ResearcherApp = lazy(() => import('./roles/researcher/ResearcherApp').then((m) => ({ default: m.ResearcherApp })))
const TeacherApp = lazy(() => import('./roles/teacher/TeacherApp').then((m) => ({ default: m.TeacherApp })))
const AuthorApp = lazy(() => import('./roles/author/AuthorApp').then((m) => ({ default: m.AuthorApp })))

type Screen = 'onboarding' | Role

function initialScreen(): Screen {
  if (consumeTeacherGoogleReturn()) {
    const params = new URLSearchParams(window.location.search)
    params.set('role', 'teacher')
    params.set('screen', 'add-class-course')
    window.history.replaceState(null, '', `?${params.toString()}`)
    return 'teacher'
  }
  const role = new URLSearchParams(window.location.search).get('role')
  if (isRole(role)) return role
  return loadLastRole() ?? 'onboarding'
}

/** Keeps `?role=` in sync with the picked screen, so refreshing stays where you were
 * instead of falling back to onboarding (#132). Reads and writes the URL fresh each
 * time rather than replacing it outright, so a role screen's own params (History's
 * `?screen=`/`?analysis=`) survive a role change untouched. */
function syncRoleParam(screen: Screen) {
  const params = new URLSearchParams(window.location.search)
  if (screen === 'onboarding') params.delete('role')
  else params.set('role', screen)
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
}

export function Root() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const { session, loading } = useAuth()

  useEffect(() => {
    syncRoleParam(screen)
    if (screen !== 'onboarding') saveLastRole(screen)
  }, [screen])

  // On sign-out, forget the previous user's place: reset to onboarding and drop the deep-link
  // params (Root's ?role plus the role screens' ?screen/?analysis). Without this the next
  // account on this browser skips onboarding and lands on the previous user's analysis id.
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return
      setScreen('onboarding')
      clearLastRole()
      clearDoItConversation()
      const params = new URLSearchParams(window.location.search)
      for (const key of ['role', 'screen', 'analysis']) params.delete(key)
      const query = params.toString()
      window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Auth gate — only when Supabase is configured (VITE_SUPABASE_*). Without it the app runs
  // open, as before. `?auth=1` previews the auth screens regardless of config.
  if (new URLSearchParams(window.location.search).has('auth')) return <Auth />
  if (authEnabled && loading) return null
  if (authEnabled && !session) return <Auth />

  return (
    <Suspense fallback={<LoadingScreen />}>
      {screen === 'onboarding' ? (
        <Onboarding lastRole={loadLastRole()} onContinue={setScreen} />
      ) : (
        roleScreen(
          screen,
          () => {
            // The role menu starts over. A switch the agent made keeps the Do it conversation.
            clearDoItConversation()
            setScreen('onboarding')
          },
          (role) => setScreen(role),
        )
      )}
    </Suspense>
  )
}

function roleScreen(screen: Exclude<Screen, 'onboarding'>, onChangeRole: () => void, onSwitchRole: (role: Role) => void) {
  switch (screen) {
    case 'researcher':
      return <ResearcherApp onChangeRole={onChangeRole} onSwitchRole={onSwitchRole} />
    case 'writer':
      return <AuthorApp onChangeRole={onChangeRole} onSwitchRole={onSwitchRole} />
    case 'teacher':
      return <TeacherApp onChangeRole={onChangeRole} />
    case 'labeler':
      return <LabelerApp onChangeRole={onChangeRole} onSwitchRole={onSwitchRole} />
  }
}
