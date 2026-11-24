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
    if (path.startsWith('/labeling/compare/')) return comparison
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

const comparison = {
  paper_id: 'paperA',
  title: 'Paper A',
  labelers: ['Chanya', 'Somchai'],
  pairs: [
    {
      claim_id: 'paperA#0',
      reference_id: 'refB',
      claim: 'Method Y improves recall.',
      reference_title: 'Ref B',
      agree: false,
      verdicts: [
        { labeler: 'Chanya', evidence: 3, confidence: 'high', rationale: '', claim_status: 'accepted' },
        { labeler: 'Somchai', evidence: 4, confidence: 'low', rationale: '', claim_status: 'accepted' },
      ],
      notes: [],
    },
  ],
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
    pool.blind = ['b1']
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

  it('lets a lead open the labels of a team-finished paper from a button beside the row, and label it from there', async () => {
    pool.lead = true
    pool.papers[0] = { ...paper('a1', 'Paper A'), team_judged: 1, labelers: ['Somchai'] }
    try {
      renderApp()
      // The lead's own work is unfinished, so the row keeps its own action and the labels sit beside it.
      expect(await screen.findByRole('button', { name: 'Paper A (Start)' }, { timeout: 5000 })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Paper A (View labels)' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'View labels for Paper A' }))
      expect(await screen.findByRole('heading', { name: 'Labelers disagree (1)' })).toBeInTheDocument()
      expect(new URLSearchParams(window.location.search).get('labels')).toBe('a1')

      fireEvent.click(screen.getByRole('button', { name: 'Back to papers' }))
      expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
      expect(window.location.search).toBe('')

      fireEvent.click(await screen.findByRole('button', { name: 'View labels for Paper A' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Label it yourself' }))
      expect(await screen.findByText('Method Y improves recall.')).toBeInTheDocument()
      const params = new URLSearchParams(window.location.search)
      expect([params.get('analysis'), params.get('labels')]).toEqual(['a1', null])
    } finally {
      pool.lead = false
      pool.papers[0] = paper('a1', 'Paper A')
    }
  })

  it("leaves a paper's labels from the sidebar", async () => {
    renderApp('?labels=a1')
    expect(await screen.findByRole('heading', { name: 'Paper A' })).toBeInTheDocument()
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Blind checks' }))
    expect(await screen.findByRole('heading', { name: 'Your blind checks (1)' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=blind')
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

  it('can open the next paper when labeling ends, then return to the papers list', async () => {
    pool.blind = []
    renderApp('?analysis=a1')
    await screen.findByText('Method Y improves recall.')

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    expect(await screen.findByText('This paper is labeled')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next paper in your topic' }))
    expect(await screen.findByRole('heading', { name: 'Claim 1 of 1' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('b1')

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    expect(await screen.findByText('This paper is labeled')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to papers' }))
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
  it('drops Ask AI from the toolbar while a blind check is open, and brings it back after', async () => {
    const before = { ...session }
    Object.assign(session, { blind: true })
    try {
      renderApp('?analysis=a1')
      await screen.findByRole('heading', { name: 'Paper A' })
      await waitFor(() => expect(screen.queryByRole('button', { name: /^Ask AI/ })).not.toBeInTheDocument())
      fireEvent.click(within(sidebar()).getByRole('button', { name: 'Papers to label' }))
      expect(await screen.findAllByRole('button', { name: /^Ask AI/ })).not.toHaveLength(0)
    } finally {
      Object.assign(session, before)
      delete (session as { blind?: boolean }).blind
    }
  })

  it('closes an Ask panel left open on the list while a blind check is open', async () => {
    const before = { ...session }
    Object.assign(session, { blind: true })
    try {
      renderApp()
      fireEvent.click((await screen.findAllByRole('button', { name: /^Ask AI/ }))[0])
      expect(await screen.findByRole('button', { name: 'New chat' })).toBeInTheDocument()
      act(() => gateway.actions!.openPaper('a1'))
      await screen.findByRole('heading', { name: 'Paper A' })
      await waitFor(() => expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument())
    } finally {
      Object.assign(session, before)
      delete (session as { blind?: boolean }).blind
    }
  })

  describe('the breadcrumb', () => {
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' }))

    it('ends with the title of the open paper; the list is named as text, and the sidebar goes back to it', async () => {
      renderApp('?analysis=a1')
      await screen.findByText('Method Y improves recall.')
      await waitFor(() => expect(crumbs().getByText('Paper A')).toBeInTheDocument())
      // One Tab stop to the list, the sidebar's: the crumb would only repeat it.
      expect(crumbs().getByText('Papers to label')).toBeInTheDocument()
      expect(crumbs().queryByRole('button')).not.toBeInTheDocument()
      fireEvent.click(within(sidebar()).getByRole('button', { name: 'Papers to label' }))
      expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
      expect(window.location.search).toBe('')
      expect(crumbs().queryByText('Paper A')).not.toBeInTheDocument()
    })

    it('asks before leaving through the sidebar when labels are unsaved', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderApp('?analysis=a1')
      await screen.findByText('Method Y improves recall.')
      fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
      fireEvent.click(within(sidebar()).getByRole('button', { name: 'Papers to label' }))
      expect(confirm).toHaveBeenCalledWith('You have unsaved labels. Leave without saving?')
      expect(screen.getByText('Method Y improves recall.')).toBeInTheDocument()
    })

    it('names the Blind checks screen for an open blind check', async () => {
      renderApp('?tab=blind&analysis=b1')
      await waitFor(() => expect(crumbs().getByText('Blind paper')).toBeInTheDocument())
      expect(crumbs().getByText('Blind checks')).toBeInTheDocument()
    })

    it('is only the screen name on the list', async () => {
      renderApp()
      await screen.findByRole('heading', { name: 'Label data' })
      expect(crumbs().getByText('Papers to label')).toBeInTheDocument()
      expect(crumbs().queryByRole('button')).not.toBeInTheDocument()
    })
  })
})

describe('Back and Forward in the Labeler', () => {
  beforeEach(() => {
    window.localStorage.clear()
    pool.blind = ['b1']
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  /** What the browser does on Back or Forward: the address changes, then popstate fires. */
  const goTo = (search: string, state: unknown = null) =>
    act(() => {
      window.history.replaceState(state, '', `/${search}`)
      window.dispatchEvent(new PopStateEvent('popstate', { state }))
    })

  it('adds a history entry for another page, and replaces it on the first sync', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    renderApp('?q=Paper')
    await screen.findByRole('button', { name: 'Paper A (Start)' }, { timeout: 5000 })
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Paper A (Start)' }))
    await screen.findByText('Method Y improves recall.')
    expect(push).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?q=Paper&analysis=a1')
  })

  it('keeps the list scroll in its entry and puts it back on Back', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => {
      run(0)
      return 0
    })
    renderApp('?q=Paper')
    window.scrollY = 300
    fireEvent.click(await screen.findByRole('button', { name: 'Paper A (Start)' }, { timeout: 5000 }))
    await screen.findByText('Method Y improves recall.')
    await goTo('?q=Paper', { labelerScroll: 300 })
    expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('Paper')
    expect(scrollTo).toHaveBeenCalledWith(0, 300)
    window.scrollY = 0
  })

  it('shows the page the address names on Back and Forward', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Label data' }, { timeout: 5000 })
    await goTo('?tab=blind')
    expect(await screen.findByRole('heading', { name: 'Your blind checks (1)' })).toBeInTheDocument()
    await goTo('?analysis=a1')
    expect(await screen.findByText('Method Y improves recall.')).toBeInTheDocument()
    await goTo('')
    expect(await screen.findByRole('heading', { name: 'Label data' })).toBeInTheDocument()
  })

  it('keeps a paper with unsaved labels open on Back, puts its entry back, and says why', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderApp('?analysis=a1')
    await screen.findByText('Method Y improves recall.')
    fireEvent.click(screen.getByRole('radio', { name: /Keep/ }))
    const push = vi.spyOn(window.history, 'pushState')

    await goTo('')
    expect(screen.getByText('Method Y improves recall.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This paper has unsaved labels.')
    expect(push).toHaveBeenCalledWith(null, '', '?analysis=a1')
    expect(confirm).not.toHaveBeenCalled()
  })
})
