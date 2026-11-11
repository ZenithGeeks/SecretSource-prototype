/** Researcher Home and its Analyze card: the greeting, the empty and error states, and starting
 * an analysis from a reference, a chosen PDF or a dropped one. The gateway is a fetch stub. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Home } from '../src/roles/researcher/screens/Home'

const auth = vi.hoisted(() => ({ fullName: undefined as string | undefined }))

vi.mock('../src/lib/supabase', () => ({
  authEnabled: true,
  sessionStorageKey: '',
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 't', user: { user_metadata: { full_name: auth.fullName } } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

const EMPTY_HOME = {
  alert: 'Nothing new.',
  conflicts: [],
  queue: [],
  library: { papers: 0, claims: 0, verified: 0, tally: { backed: 0, silent: 0, contradicted: 0, unchecked: 0 } },
}

type Options = { home?: unknown; features?: Record<string, boolean>; startFails?: boolean }

function gateway({ home = EMPTY_HOME, features, startFails }: Options = {}) {
  const calls: { path: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^\/api/, '')
      calls.push({ path, init })
      if (path === '/researcher/home') return home === null ? Promise.reject(new Error('502: ')) : Response.json(home)
      if (path === '/health') return Response.json({ features })
      if (path === '/uploads') return Response.json({ url: null })
      if (init?.method === 'POST') {
        return startFails ? new Response('queue is full', { status: 503 }) : Response.json({ id: 'new-1' })
      }
      return Response.json([])
    }),
  )
  return calls
}

function renderHome() {
  const onOpen = vi.fn()
  const onOpenAnalysis = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Home onOpen={onOpen} onOpenAnalysis={onOpenAnalysis} />
    </QueryClientProvider>,
  )
  return { onOpen, onOpenAnalysis }
}

const card = () => screen.findByRole('region', { name: 'Analyze a paper' })
const pdf = () => new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })

beforeEach(() => {
  auth.fullName = undefined
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Home', () => {
  it('greets by the signed-in name before the Settings name', async () => {
    auth.fullName = '  Ada Lovelace '
    gateway()
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: /, Ada$/ })).toBeInTheDocument()
  })

  it('shows a loading screen, then the empty states for conflicts and the queue', async () => {
    gateway()
    renderHome()
    expect(screen.getByText('Loading your library…')).toBeInTheDocument()
    // An empty library says nothing is checked yet, not that everything is fine.
    expect(await screen.findByText(/Nothing is checked yet\. Analyze a paper above/)).toBeInTheDocument()
    expect(screen.queryByText('No claim in your papers is contradicted by its sources.')).not.toBeInTheDocument()
    expect(screen.getByText('Works that your papers cite more than once show up here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /in Library$/ })).not.toBeInTheDocument()
  })

  it('says no claim is contradicted only once there are papers to check', async () => {
    gateway({ home: { ...EMPTY_HOME, library: { ...EMPTY_HOME.library, papers: 3, claims: 12 } } })
    renderHome()
    expect(await screen.findByText('No claim in your papers is contradicted by its sources.')).toBeInTheDocument()
  })

  it('shows the gateway error and retries on request', async () => {
    gateway()
    // Only the first call for the home data fails; the Analyze card's own /health call must get through.
    const answer = vi.mocked(fetch).getMockImplementation()!
    let failed = false
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/researcher/home') && !failed) {
        failed = true
        throw new Error('gateway is down')
      }
      return answer(url, init)
    })
    renderHome()
    expect(await screen.findByText('gateway is down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Nothing new.')).toBeInTheDocument()
  })

  it('says the server did not answer when a proxy error carries no message', async () => {
    gateway({ home: null })
    renderHome()
    expect(await screen.findByText('the server did not answer (502)')).toBeInTheDocument()
  })

  it('opens the analysis behind a conflict, with or without a paper name', async () => {
    gateway({
      home: {
        ...EMPTY_HOME,
        conflicts: [
          { claim: 'First claim', for: [], against: ['X'], analysis: 'a1', claimIndex: 0 },
          { claim: 'Second claim', paper: 'Named paper', for: ['Y'], against: [], analysis: 'a2', claimIndex: 0 },
        ],
      },
    })
    const { onOpenAnalysis } = renderHome()
    fireEvent.click((await screen.findByText('Second claim')).closest('button')!)
    expect(onOpenAnalysis).toHaveBeenCalledWith('a2')
    expect(screen.getByText('Named paper')).toBeInTheDocument()
    fireEvent.click(screen.getByText('First claim').closest('button')!)
    expect(onOpenAnalysis).toHaveBeenLastCalledWith('a1')
  })

  it('opens the analysis that cites a queued paper', async () => {
    gateway({
      home: { ...EMPTY_HOME, queue: [{ paper: 'PLAID', note: 'Cited by 3', identifier: '10.1/plaid', analysis: 'a9' }] },
    })
    const { onOpenAnalysis } = renderHome()
    fireEvent.click(await screen.findByTitle('Open the analysis that cites it'))
    expect(onOpenAnalysis).toHaveBeenCalledWith('a9')
  })

  it('Open library goes to the Library screen', async () => {
    gateway()
    const { onOpen } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Open library' }))
    expect(onOpen).toHaveBeenCalledWith('library')
  })

  it('All N in Library goes to the Library screen when more conflicts exist than are listed', async () => {
    gateway({ home: { ...EMPTY_HOME, conflictsTotal: 5 } })
    const { onOpen } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'All 5 in Library' }))
    expect(onOpen).toHaveBeenCalledWith('library')
  })
})

describe('Analyze card', () => {
  it('starts an analysis from the typed reference, clears the box and tells Home', async () => {
    const calls = gateway()
    const { onOpenAnalysis } = renderHome()
    await card()
    const box = screen.getByLabelText('Paper to analyze')
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled()
    fireEvent.change(box, { target: { value: ' 10.1/x ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(onOpenAnalysis).toHaveBeenCalledWith('new-1'))
    const post = calls.find((c) => c.path === '/analyses')!
    expect(JSON.parse(String(post.init!.body))).toEqual({ paper: '10.1/x', verify: true })
    expect(box).toHaveValue('')
  })

  it('does not start from a blank reference', async () => {
    const calls = gateway()
    renderHome()
    await card()
    fireEvent.submit(screen.getByLabelText('Paper to analyze').closest('form')!)
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })

  it('the deep-check switch turns verify off for the run', async () => {
    const calls = gateway()
    renderHome()
    await card()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(screen.getByLabelText('Paper to analyze'), { target: { value: '10.1/y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses')).toBe(true))
    expect(JSON.parse(String(calls.find((c) => c.path === '/analyses')!.init!.body)).verify).toBe(false)
  })

  it('shows the gateway message when starting fails', async () => {
    gateway({ startFails: true })
    renderHome()
    await card()
    fireEvent.change(screen.getByLabelText('Paper to analyze'), { target: { value: '10.1/z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('queue is full')
  })

  it('Upload PDF opens the file picker, and a chosen PDF waits for Analyze', async () => {
    const calls = gateway()
    const { onOpenAnalysis } = renderHome()
    const region = await card()
    const input = region.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, 'click')
    fireEvent.click(within(region).getByRole('button', { name: 'Upload PDF' }))
    expect(click).toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [pdf()] } })
    // Held with its name; nothing is sent until Analyze.
    expect(within(region).getByText('paper.pdf')).toBeInTheDocument()
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
    fireEvent.click(within(region).getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(onOpenAnalysis).toHaveBeenCalledWith('new-1'))
    expect(calls.some((c) => c.path === '/analyses/upload?verify=true')).toBe(true)
  })

  it('while a run is starting the button and the Remove control are off, so it cannot start twice', async () => {
    gateway()
    renderHome()
    const region = await card()
    const answer = vi.mocked(fetch).getMockImplementation()!
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') await held
      return answer(url, init)
    })
    fireEvent.change(region.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [pdf()] } })
    fireEvent.click(within(region).getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Analyze' })).toBeDisabled())
    expect(within(region).getByRole('button', { name: 'Remove paper.pdf' })).toBeDisabled()
    release()
    await waitFor(() => expect(within(region).queryByText('paper.pdf')).not.toBeInTheDocument())
  })

  it('a held PDF can be removed, and typing a reference replaces it', async () => {
    const calls = gateway()
    renderHome()
    const region = await card()
    const input = region.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [pdf()] } })
    expect(within(region).getByRole('button', { name: 'Analyze' })).toBeEnabled()
    fireEvent.click(within(region).getByRole('button', { name: 'Remove paper.pdf' }))
    expect(within(region).queryByText('paper.pdf')).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Analyze' })).toBeDisabled()

    fireEvent.change(input, { target: { files: [pdf()] } })
    fireEvent.change(screen.getByLabelText('Paper to analyze'), { target: { value: '10.1/q' } })
    expect(within(region).queryByText('paper.pdf')).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses')).toBe(true))
    expect(calls.some((c) => c.path.startsWith('/analyses/upload'))).toBe(false)
  })

  it('a chosen file that is not a PDF is refused with a reason', async () => {
    const calls = gateway()
    renderHome()
    const region = await card()
    const input = region.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Only PDF files can be analyzed')
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })

  it('choosing nothing in the file picker does nothing', async () => {
    const calls = gateway()
    renderHome()
    const region = await card()
    fireEvent.change(region.querySelector('input[type="file"]')!, { target: { files: [] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })

  it('a dropped PDF is held, not sent, and the card highlights while a file is over it', async () => {
    gateway()
    const { onOpenAnalysis } = renderHome()
    const region = await card()
    fireEvent.dragOver(region)
    expect(region.className).toContain('border-accent')
    fireEvent.dragLeave(region)
    expect(region.className).not.toContain('border-accent bg-accent-soft')
    fireEvent.drop(region, { dataTransfer: { files: [pdf()] } })
    expect(within(region).getByText('paper.pdf')).toBeInTheDocument()
    expect(onOpenAnalysis).not.toHaveBeenCalled()
    fireEvent.click(within(region).getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(onOpenAnalysis).toHaveBeenCalledWith('new-1'))
  })

  it('a drop with no file does nothing', async () => {
    gateway()
    renderHome()
    const region = await card()
    fireEvent.drop(region, { dataTransfer: { files: [] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('while the checking server is offline, analyses cannot start and a dropped PDF is not sent', async () => {
    const calls = gateway({ features: { analyses: false } })
    renderHome()
    const region = await card()
    expect(await screen.findByRole('status')).toHaveTextContent('The checking server is offline')
    expect(within(region).getByRole('button', { name: 'Upload PDF' })).toBeDisabled()
    fireEvent.drop(region, { dataTransfer: { files: [pdf()] } })
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })
})
