/** Settings → Your data → What the assistant remembers (SCRUM-404): the researcher sees every fact
 * the assistant keeps and can forget one or all of them. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsModal } from '../src/components/SettingsModal'
import { resetSettings } from '../src/lib/settings'
import { resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { resetTeacherStore } from '../src/lib/teacherStore'

// Signed-out, no Supabase: request() sends without a token, whatever a local .env says.
vi.mock('../src/lib/supabase', () => ({ authEnabled: true, supabase: null, sessionStorageKey: '' }))

const FACTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'paper',
    subject: 'ColBERTv2',
    summary: 'Read it to check late interaction claims.',
    analysis_id: 'a1',
    session_id: 's1',
    created_at: '2026-10-20T08:00:00+00:00',
    updated_at: '2026-10-21T08:00:00+00:00',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'concept',
    subject: 'Late interaction',
    summary: 'Studying multi-vector retrieval.',
    analysis_id: null,
    session_id: 's1',
    created_at: '2026-10-20T08:00:00+00:00',
    updated_at: '2026-10-20T09:00:00+00:00',
  },
]

/** A gateway that keeps the facts: GET lists them, DELETE removes one or all. `refuse` makes a
 * DELETE of one fact fail; `hold` keeps that DELETE waiting until the test releases it. */
function memoryGateway(options: { refuse?: boolean; hold?: boolean } = {}) {
  const state = { facts: [...FACTS], gets: 0, deletes: [] as string[], release: () => {} }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.slice(url.indexOf('/api') + 4)
      if (path === '/memories' && !init?.method) {
        state.gets += 1
        return new Response(JSON.stringify(state.facts), { status: 200 })
      }
      if (path.startsWith('/memories') && init?.method === 'DELETE') {
        state.deletes.push(path)
        if (options.hold) await new Promise<void>((resolve) => (state.release = resolve))
        if (options.refuse && path !== '/memories') return new Response('no', { status: 500 })
        const id = path.split('/')[2]
        state.facts = id ? state.facts.filter((fact) => fact.id !== id) : []
        return new Response(JSON.stringify({ deleted: 1 }), { status: 200 })
      }
      if (path.startsWith('/user/data')) return new Response(JSON.stringify({ deleted: 0, skipped: 0 }), { status: 200 })
      return new Response('{}', { status: 200 })
    }),
  )
  return state
}

function renderModal(currentRole: 'writer' | 'researcher' | 'teacher') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsModal open onClose={vi.fn()} currentRole={currentRole} onSwitchRole={vi.fn()} />
    </QueryClientProvider>,
  )
}

const openYourData = () => fireEvent.click(screen.getByRole('tab', { name: 'Your data' }))

describe('What the assistant remembers', () => {
  beforeEach(() => {
    resetSettings()
    resetTeacherPreferences()
    resetTeacherStore()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists each fact with its kind, subject, summary and date', async () => {
    memoryGateway()
    renderModal('researcher')
    openYourData()

    expect(await screen.findByText('ColBERTv2')).toBeInTheDocument()
    expect(screen.getByText('Read it to check late interaction claims.')).toBeInTheDocument()
    expect(screen.getByText('Paper')).toBeInTheDocument()
    expect(screen.getByText('Concept')).toBeInTheDocument()
    expect(screen.getAllByText(/^Updated /)).toHaveLength(2)
  })

  it('says so when there is nothing to show', async () => {
    const gateway = memoryGateway()
    gateway.facts = []
    renderModal('researcher')
    openYourData()

    expect(await screen.findByText(/has not remembered anything about you yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forget everything' })).toBeDisabled()
  })

  it('removes a fact at once, and it stays gone after a reload', async () => {
    const gateway = memoryGateway({ hold: true })
    const { unmount } = renderModal('researcher')
    openYourData()
    fireEvent.click(await screen.findByRole('button', { name: 'Forget ColBERTv2' }))

    // The gateway has not answered yet, and the row is already gone.
    await waitFor(() => expect(screen.queryByText('ColBERTv2')).not.toBeInTheDocument())
    expect(screen.getByText('Late interaction')).toBeInTheDocument()
    gateway.release()
    await waitFor(() => expect(gateway.deletes).toEqual([`/memories/${FACTS[0].id}`]))

    unmount()
    renderModal('researcher')
    openYourData()
    expect(await screen.findByText('Late interaction')).toBeInTheDocument()
    expect(screen.queryByText('ColBERTv2')).not.toBeInTheDocument()
  })

  it('puts the fact back and says so when the gateway refuses', async () => {
    memoryGateway({ refuse: true })
    renderModal('researcher')
    openYourData()
    fireEvent.click(await screen.findByRole('button', { name: 'Forget ColBERTv2' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('still remembered')
    expect(await screen.findByText('ColBERTv2')).toBeInTheDocument()
  })

  it('forgets everything only after a confirm', async () => {
    const gateway = memoryGateway()
    renderModal('researcher')
    openYourData()
    await screen.findByText('ColBERTv2')

    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }))
    expect(gateway.deletes).toEqual([])
    expect(screen.getByText('ColBERTv2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' }))
    expect(await screen.findByText(/has not remembered anything about you yet/)).toBeInTheDocument()
    expect(gateway.deletes).toEqual(['/memories'])
    expect(screen.getByRole('alert')).toHaveTextContent('Everything was forgotten.')
  })

  it('shows the list again after "Delete all" forgot the facts too', async () => {
    const gateway = memoryGateway()
    renderModal('researcher')
    openYourData()
    await screen.findByText('ColBERTv2')
    const before = gateway.gets
    gateway.facts = []

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))

    await waitFor(() => expect(gateway.gets).toBeGreaterThan(before))
    expect(await screen.findByText(/has not remembered anything about you yet/)).toBeInTheDocument()
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/what the assistant remembers/)
  })

  it('cannot change anything while an Author previews the Researcher tabs', async () => {
    const gateway = memoryGateway()
    renderModal('writer')
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Roles' })).getByRole('tab', { name: 'Researcher' }))
    openYourData()

    expect(await screen.findByRole('button', { name: 'Forget ColBERTv2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forget everything' })).toBeDisabled()
    expect(gateway.deletes).toEqual([])
  })

  it.each(['writer', 'teacher'] as const)('is not on the %s Your data tab', async (role) => {
    const gateway = memoryGateway()
    renderModal(role)
    openYourData()

    expect(screen.queryByText('What the assistant remembers')).not.toBeInTheDocument()
    expect(gateway.gets).toBe(0)
  })
})
