/**
 * App shell / temporary router. No routing library yet, so a small screen state stands in:
 * onboarding picks a role, which opens that role's home. `?role=` deep-links a screen.
 *
 * Role teams: build your screens in src/roles/<role>/ (own folder — no collisions), export
 * a <Role>App component, then wire its case below. That one case is the only
 * shared-file edit a role needs. `Skip` (or `?role=app`) opens the existing analysis app.
 */

import { useEffect, useState } from 'react'

import App from './App'
import { authEnabled } from './lib/supabase'
import { useAuth } from './lib/useAuth'
import { ResearcherApp } from './roles/researcher/ResearcherApp'
import { TeacherApp } from './roles/teacher/TeacherApp'
import { WriterApp } from './roles/writer/WriterApp'
import { Auth } from './screens/auth/Auth'
import type { Role } from './screens/Onboarding'
import { Onboarding } from './screens/Onboarding'

type Screen = 'onboarding' | Role | 'app'

function initialScreen(): Screen {
  const role = new URLSearchParams(window.location.search).get('role')
  if (role === 'researcher' || role === 'writer' || role === 'teacher' || role === 'app') return role
  return 'onboarding'
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

  useEffect(() => syncRoleParam(screen), [screen])

  // Auth gate — only when Supabase is configured (VITE_SUPABASE_*). Without it the app runs
  // open, as before. `?auth=1` previews the auth screens regardless of config.
  if (new URLSearchParams(window.location.search).has('auth')) return <Auth />
  if (authEnabled && loading) return null
  if (authEnabled && !session) return <Auth />

  switch (screen) {
    case 'onboarding':
      return <Onboarding onContinue={setScreen} onSkip={() => setScreen('app')} />
    case 'researcher':
      return <ResearcherApp onChangeRole={() => setScreen('onboarding')} />
    case 'writer':
      return <WriterApp onChangeRole={() => setScreen('onboarding')} />
    case 'teacher':
      return <TeacherApp onChangeRole={() => setScreen('onboarding')} />
    case 'app':
      return <App />
  }
}
