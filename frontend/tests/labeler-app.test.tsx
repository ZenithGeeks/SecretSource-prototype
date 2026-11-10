/** The Labeler shell: which screen shows, what the address bar keeps, and the unsaved-labels guard. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  actions: null as null | {
    screens: string[]
    openPaper: (id: string) => void
    openScreen: (screen: string) => void
    confirmLeave: () => boolean
  },
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string) => {
    if (path === '/labeling/status') return { annotator: 'Chanya', configured: true, scopus: false }
    if (path === '/labeling/pool') return pool
    if (path.startsWith('/labeling/sessions/')) return session
    throw new Error(`unexpected ${path}`)
  }),
  fetchFile: vi.fn(),
  api: { findInPaper: vi.fn(async () => ({ page: null, boxes: [] })) },
}))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => null }))
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/components/Ask', async (original) => {
  const real = await original<typeof import('../src/components/Ask')>()
  return {
    ...real,
    // Keep the actions the Labeler hands the screen agent, so a test can call them.
    useAsk: (options: Parameters<typeof real.useAsk>[0]) => {
      gateway.actions = options.actions as typeof gateway.actions
      return real.useAsk(options)
    },
  }
})

const paper = (id: string, title: string) => ({
  analysis_id: id,
  title,
  topic: 'CV',
  claims: 1,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: false,
  added_by: 'Somchai',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
})

const pool = {
  topics: ['CV'],
  me: 'Chanya',
  lead: false,
  people: [{ name: 'Chanya', topic: 'CV' }],
  papers: [paper('a1', 'Paper A'), paper('b1', 'Blind paper')],
  blind: ['b1'],
  blind_checks: [],
}

const session = {
  analysis_id: 'a1',
  paper_id: 'paperA',
  paper_file: 'paperA.pdf',
  title: 'Paper A',
  annotator: 'Chanya',
  claims: [{ claim_id: 'paperA#0', claim: 'Method Y improves recall.', sentence: '', section: '3', source: null, candidates: [] }],
  references: [],
  saved: { claims: [], candidates: [], labels: [] },
  others: {},
}

import { LabelerApp } from '../src/roles/labeler/LabelerApp'

function renderApp(search = '', props: Parameters<typeof LabelerApp>[0] = {}) {
  window.history.replaceState(null, '', `/${search}`)
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LabelerApp {...props} />
    </QueryClientProvider>,
  )
}

const sidebar = () => screen.getAllByRole('navigation', { name: 'Main' })[0]

describe('the Labeler shell', () => {
  beforeEach(() => {
    window.localStorage.clear() // drafts a test left unsaved
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('starts on the paper list, and opens the blind checks from the banner and back from the sidebar', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Open blind checks' }, { timeout: 5000 }))
    expect(await screen.findByRole('heading', { name: 'Your blind checks (1)' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=blind')

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Papers to label' }))
    expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('opens on the Blind checks tab when the address asks for it, and opens a paper from there', async () => {
    renderApp('?tab=blind')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Method Y improves recall.')).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('b1')
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('blind')
  })

  it('opens the paper named in the address and drops it from the address on leaving', async () => {
    renderApp('?analysis=a1')
    expect(await screen.findByText('Method Y improves recall.')).toBeInTheDocument()

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Papers to label' }))
    expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('asks before leaving a paper with unsaved labels, and stays when the person says no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp('?analysis=a1')
    await screen.findByText('Method Y improves recall.')
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Blind checks' }))
    expect(confirm).toHaveBeenCalledWith('You have unsaved labels. Leave without saving?')
    expect(screen.getByText('Method Y improves recall.')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Blind checks' }))
    expect(await screen.findByRole('heading', { name: 'Your blind checks (1)' })).toBeInTheDocument()
  })

  it('lets the screen agent go back to the list, but not to a screen that does not exist', async () => {
    renderApp('?analysis=a1')
    await screen.findByText('Method Y improves recall.')
    expect(gateway.actions?.screens).toEqual(['papers', 'workspace'])

    act(() => gateway.actions?.openPaper('a1'))
    expect(screen.getByText('Method Y improves recall.')).toBeInTheDocument()
    act(() => gateway.actions?.openScreen('workspace'))
    expect(screen.getByText('Method Y improves recall.')).toBeInTheDocument()

    act(() => gateway.actions?.openScreen('papers'))
    expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
    expect(gateway.actions?.screens).toEqual(['papers'])
  })

  it('lets the agent switch role only when no labels are unsaved or the person agrees', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp('?analysis=a1')
    await screen.findByText('Method Y improves recall.')
    expect(gateway.actions?.confirmLeave()).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    await waitFor(() => expect(gateway.actions?.confirmLeave()).toBe(false))
    confirm.mockReturnValue(true)
    expect(gateway.actions?.confirmLeave()).toBe(true)
  })

  it('opens Settings when the address asks for it, and changes role from there', async () => {
    const onChangeRole = vi.fn()
    renderApp('?screen=settings', { onChangeRole })
    const dialog = await screen.findByRole('dialog', { name: /Settings/ })

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Role and home' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Switch role/ }))
    expect(onChangeRole).toHaveBeenCalled()
  })

  it('does nothing when Settings is asked to switch role in a shell without that option', async () => {
    renderApp('?screen=settings')
    const dialog = await screen.findByRole('dialog', { name: /Settings/ })

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Role and home' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Switch role/ }))
    expect(dialog).toBeInTheDocument()
  })

  it('opens Settings from the toolbar and closes it again', async () => {
    renderApp()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Settings' }))[0])
    const dialog = await screen.findByRole('dialog', { name: /Settings/ })

    fireEvent.click(within(dialog).getByRole('button', { name: /Close/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Settings/ })).not.toBeInTheDocument())
  })
})
