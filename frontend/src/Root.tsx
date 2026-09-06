/**
 * App shell / temporary router. No routing library yet, so a small screen state stands in:
 * onboarding picks a role, which opens that role's home. `?role=` deep-links a screen.
 *
 * Role teams: build your screens in src/roles/<role>/ (own folder — no collisions), export
 * a <Role>App component, then replace your ComingSoon case below. That one line is the only
 * shared-file edit a role needs. `Skip` (or `?role=app`) opens the existing analysis app.
 */

import { useState } from 'react'

import App from './App'
import { ResearcherApp } from './roles/researcher/ResearcherApp'
import type { Role } from './screens/Onboarding'
import { Onboarding } from './screens/Onboarding'

type Screen = 'onboarding' | Role | 'app'

function initialScreen(): Screen {
  const role = new URLSearchParams(window.location.search).get('role')
  if (role === 'researcher' || role === 'writer' || role === 'teacher' || role === 'app') return role
  return 'onboarding'
}

function ComingSoon({ role, onBack }: { role: Role; onBack: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-serif text-2xl font-semibold capitalize text-ink">{role} home</p>
      <p className="text-sm text-ink-muted">Not built yet — add it in src/roles/{role}/.</p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Back to roles
      </button>
    </div>
  )
}

export function Root() {
  const [screen, setScreen] = useState<Screen>(initialScreen)

  switch (screen) {
    case 'onboarding':
      return <Onboarding onContinue={setScreen} onSkip={() => setScreen('app')} />
    case 'researcher':
      return <ResearcherApp onChangeRole={() => setScreen('onboarding')} />
    case 'writer':
    case 'teacher':
      return <ComingSoon role={screen} onBack={() => setScreen('onboarding')} />
    case 'app':
      return <App />
  }
}
