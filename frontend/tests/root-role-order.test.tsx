import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

let session: unknown = null

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null }))
vi.mock('../src/lib/useAuth', () => ({ useAuth: () => ({ session, loading: false }) }))
vi.mock('../src/screens/Onboarding', () => ({ Onboarding: () => <p>role picker</p> }))
vi.mock('../src/roles/labeler/LabelerApp', () => ({ LabelerApp: () => <p>labeler home</p> }))
vi.mock('../src/roles/researcher/ResearcherApp', () => ({ ResearcherApp: () => <p>researcher home</p> }))

import { Root } from '../src/Root'

function signedInAs(role?: string) {
  session = { user: { id: 'u1', app_metadata: role ? { role } : {} } }
}

beforeEach(() => {
  session = null
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('Root role order', () => {
  test('the account role opens when nothing else picks one', async () => {
    signedInAs('labeler')
    render(<Root />)
    expect(await screen.findByText('labeler home')).toBeInTheDocument()
  })

  test('the browser last role wins over the account role', async () => {
    localStorage.setItem('secretsource.lastRole', 'researcher')
    signedInAs('labeler')
    render(<Root />)
    expect(await screen.findByText('researcher home')).toBeInTheDocument()
  })

  test('?role= wins over the last role and the account role', async () => {
    localStorage.setItem('secretsource.lastRole', 'labeler')
    window.history.replaceState(null, '', '/?role=researcher')
    signedInAs('labeler')
    render(<Root />)
    expect(await screen.findByText('researcher home')).toBeInTheDocument()
  })

  test('the picker shows without any role, or with one that is not a role', async () => {
    signedInAs('admin')
    render(<Root />)
    expect(await screen.findByText('role picker')).toBeInTheDocument()
  })
})
