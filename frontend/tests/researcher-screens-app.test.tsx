/** ResearcherApp wiring: which screen opens from the URL, how the nav, breadcrumb and Ask's
 * actions move between screens, and the Settings modal. Ask's agent and the Graph canvas are
 * stubbed; they have their own tests. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

// What useAsk was last called with, so a test can call the actions Ask's agent would.
type AskCall = {
  screen: string
  analysis: string | null
  analysisFile: string | null
  node: { id: string; label: string } | null
  actions: {
    screens: string[]
    openScreen: (screen: string) => void
    openPaper: (id: string) => void
    switchRole?: (role: string) => void
  }
}
const ask = vi.hoisted(() => ({ last: null as unknown, panel: 'ASK-PANEL' }))
const lastAsk = () => ask.last as AskCall

vi.mock('../src/components/Ask', () => ({
  useAsk: (options: unknown) => {
    ask.last = options
    return { button: <span>ask-button</span>, panel: <aside>{ask.panel}</aside>, viewer: <span>ask-viewer</span> }
  },
}))

vi.mock('../src/roles/researcher/screens/Graph', () => ({
  Graph: (props: {
    initialTab: string
    hideTabs?: boolean
    askPanel: unknown
    onSelectNode: (node: { id: string; label: string } | null) => void
    onOpenAnalysis: (id: string) => void
  }) => (
    <div data-testid="graph" data-tab={props.initialTab} data-hide-tabs={String(!!props.hideTabs)}>
      {props.askPanel as never}
      <button onClick={() => props.onSelectNode({ id: 'n1', label: 'Node one' })}>select node</button>
      <button onClick={() => props.onOpenAnalysis('a1')}>open from graph</button>
    </div>
  ),
}))

const ANALYSES = [{ id: 'a1', paper: 'p.pdf', file: 'p.pdf', title: 'p.pdf', status: 'done', claims: [], stages: [] }]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^\/api/, '')
      if (path === '/analyses') return Response.json(ANALYSES)
      if (path.startsWith('/analyses/')) return Response.json(ANALYSES[0])
      if (path === '/researcher/projects') return Response.json([])
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderApp(search: string, props: Parameters<typeof ResearcherApp>[0] = {}) {
  window.history.replaceState(null, '', search)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ResearcherApp {...props} />
    </QueryClientProvider>,
  )
}

const breadcrumb = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }))
const param = (name: string) => new URLSearchParams(window.location.search).get(name)

describe('first screen', () => {
  it('opens Home with no screen in the URL', () => {
    renderApp('?role=researcher')
    expect(param('screen')).toBe('home')
    expect(within(breadcrumb()).getByText('Home')).toBeInTheDocument()
  })

  it('opens Home for a screen name it does not know', () => {
    renderApp('?role=researcher&screen=nope')
    expect(param('screen')).toBe('home')
  })

  it('opens Analyses when only an analysis is named, and keeps it in the URL', () => {
    renderApp('?role=researcher&analysis=a1')
    expect(param('screen')).toBe('analyses')
    expect(param('analysis')).toBe('a1')
  })

  it('opens the Settings modal over Home for the old ?screen=settings link', () => {
    renderApp('?role=researcher&screen=settings')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(param('screen')).toBe('home')
  })
})

describe('Graph and Ask the field', () => {
  it('Graph opens the graph tab, lights the Graph nav item and hands the Ask panel to the graph', () => {
    renderApp('?role=researcher&screen=graph')
    expect(screen.getByTestId('graph')).toHaveAttribute('data-tab', 'graph')
    expect(mainNav().getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByTestId('graph')).getByText('ASK-PANEL')).toBeInTheDocument()
    expect(screen.getAllByText('ASK-PANEL')).toHaveLength(1)
  })

  it('Ask the field has its own nav item and opens the Consensus tab without the Graph switch', () => {
    renderApp('?role=researcher&screen=field-consensus')
    expect(screen.getByTestId('graph')).toHaveAttribute('data-tab', 'consensus')
    expect(screen.getByTestId('graph')).toHaveAttribute('data-hide-tabs', 'true')
    expect(mainNav().getByRole('button', { name: 'Ask the field' })).toHaveAttribute('aria-current', 'page')
    expect(mainNav().getByRole('button', { name: 'Graph' })).not.toHaveAttribute('aria-current')
    expect(within(breadcrumb()).getByText('Ask the field')).toBeInTheDocument()
    expect(param('screen')).toBe('field-consensus')
  })

  it('moves between Graph and Ask the field from the nav, on the right tab each time', () => {
    renderApp('?role=researcher&screen=graph')
    fireEvent.click(mainNav().getByRole('button', { name: 'Ask the field' }))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-tab', 'consensus')
    fireEvent.click(mainNav().getByRole('button', { name: 'Graph' }))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-tab', 'graph')
  })

  it('a node selected on the graph is what Ask is about, and only while on the graph', () => {
    renderApp('?role=researcher&screen=graph')
    expect(lastAsk().node).toBeNull()
    fireEvent.click(screen.getByText('select node'))
    expect(lastAsk().node).toEqual({ id: 'n1', label: 'Node one' })
    fireEvent.click(mainNav().getByRole('button', { name: 'Home' }))
    expect(lastAsk().node).toBeNull()
  })

  it('Back and Forward move between the screens the reader visited', async () => {
    renderApp('?role=researcher&screen=graph')
    fireEvent.click(mainNav().getByRole('button', { name: 'Library' }))
    expect(param('screen')).toBe('library')
    act(() => {
      window.history.back()
    })
    await waitFor(() => expect(screen.getByTestId('graph')).toBeInTheDocument())
    expect(param('screen')).toBe('graph')
    act(() => {
      window.history.forward()
    })
    await waitFor(() => expect(within(breadcrumb()).getByText('Library')).toBeInTheDocument())
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument()
  })

  it('Back to an analysis entry reopens that analysis', async () => {
    renderApp('?role=researcher&screen=graph')
    window.history.pushState(null, '', '?role=researcher&screen=analyses&analysis=a1')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(lastAsk().analysis).toBe('a1'))
    expect(param('screen')).toBe('analyses')
  })

  it('opening a paper from the graph shows it on Analyses', async () => {
    renderApp('?role=researcher&screen=graph')
    fireEvent.click(screen.getByText('open from graph'))
    expect(param('screen')).toBe('analyses')
    expect(param('analysis')).toBe('a1')
    await waitFor(() => expect(lastAsk().analysisFile).toBe('p.pdf'))
  })
})

describe('Ask actions', () => {
  it('can open any nav screen and a paper', async () => {
    renderApp('?role=researcher&screen=home')
    expect(lastAsk().actions.screens).toEqual(['home', 'analyses', 'library', 'graph', 'field-consensus'])

    act(() => lastAsk().actions.openScreen('library'))
    expect(param('screen')).toBe('library')
    expect(lastAsk().analysis).toBeNull()

    act(() => lastAsk().actions.openPaper('a1'))
    expect(param('screen')).toBe('analyses')
    expect(lastAsk().analysis).toBe('a1')
    await waitFor(() =>
      expect(within(breadcrumb()).getByText('p.pdf')).toBeInTheDocument(),
    )
  })

  it('can switch role only when the app was given a way to', () => {
    const onSwitchRole = vi.fn()
    renderApp('?role=researcher', { onSwitchRole })
    lastAsk().actions.switchRole!('author')
    expect(onSwitchRole).toHaveBeenCalledWith('author')
  })
})

describe('shell', () => {
  it('the Library hands Analyze a new paper to Analyses', async () => {
    renderApp('?role=researcher&screen=library')
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze a new paper' }))
    expect(param('screen')).toBe('analyses')
    expect(within(breadcrumb()).getByText('Analyses')).toBeInTheDocument()
  })

  it('the gear opens Settings, whose Switch role does nothing without a role switcher', () => {
    renderApp('?role=researcher&screen=home')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Role and home' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch role' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Settings closes again', async () => {
    renderApp('?role=researcher&screen=settings')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Switch role in Settings calls the role changer the app was given', () => {
    const onChangeRole = vi.fn()
    renderApp('?role=researcher&screen=home', { onChangeRole })
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Role and home' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch role' }))
    expect(onChangeRole).toHaveBeenCalled()
  })
})
