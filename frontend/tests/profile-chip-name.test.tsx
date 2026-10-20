/** The profile chip in AppShell shows the display name set in Settings once it is changed, and
 * the signed-in Google name until then. */

import { render, screen } from '@testing-library/react'
import { Tags } from 'lucide-react'
import { afterEach, expect, test, vi } from 'vitest'

import { AppShell } from '../src/components/AppShell'
import { resetSettings, updateSettings } from '../src/lib/settings'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
const googleSession = { user: { email: 'somchai@kmutt.ac.th', user_metadata: { full_name: 'Somchai Google' } } }
let session: { user: { email: string; user_metadata: { full_name?: string } } } = googleSession
vi.mock('../src/lib/useAuth', () => ({ useAuth: () => ({ session }), signOut: vi.fn() }))

afterEach(() => {
  resetSettings()
  session = googleSession
})

const shell = () =>
  render(
    <AppShell nav={[{ key: 'papers', label: 'Papers', icon: Tags }]} active="papers" onNavigate={() => {}} role="Labeler" roleIcon={Tags}>
      <p>content</p>
    </AppShell>,
  )

test('shows the Google name while the display name is the default', () => {
  shell()
  expect(screen.getByText('Somchai Google')).toBeInTheDocument()
})

test('shows the address, not the shared default name, for an account with no name', () => {
  session = { user: { email: 'somchai@kmutt.ac.th', user_metadata: {} } }
  shell()
  expect(screen.getByText('somchai@kmutt.ac.th', { selector: 'button span' })).toBeInTheDocument()
  expect(screen.queryByText('Alex')).toBeNull()
})

test('shows the display name once it is changed in Settings', () => {
  updateSettings({ displayName: 'Chai' })
  shell()
  expect(screen.getByText('Chai')).toBeInTheDocument()
  expect(screen.queryByText('Somchai Google')).toBeNull()
})
