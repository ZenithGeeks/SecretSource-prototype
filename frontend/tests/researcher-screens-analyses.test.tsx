/** The Analyses screen of the researcher app: the recent-analyses list in the sidebar, the form
 * that starts an analysis, and picking, deleting and narrowing an open one. The gateway is a
 * fetch stub; the browser notice is stubbed because jsdom has no Notification. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

const notice = vi.hoisted(() => ({ opens: [] as (() => void)[] }))
vi.mock('../src/lib/desktopNotice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/desktopNotice')>()),
  showDoneNotice: (_title: string, _body: string, _tag: string, onOpen?: () => void) => {
    if (onOpen) notice.opens.push(onOpen)
  },
}))

const cite = { title: 'Cited work', authors: ['A'], year: '2020', doi: '10/c', arxiv: '', url: '' }
const claim = (text: string, verdict: 'supports' | 'refutes' | 'insufficient', section = '') => ({
  claim: text,
  section,
  citations: [cite],
  verdicts: [{ verdict, quote: 'q', reasoning: 'r', source: 's.pdf', evidence: [], pages: [] }],
  unchecked: [],
})

const analysis = (id: string, over: Record<string, unknown> = {}) => ({
  id, paper: `${id}.pdf`, file: `raw/${id}.pdf`, status: 'done', stages: [], claims: [], ...over,
})

let analyses: ReturnType<typeof analysis>[] = []
let calls: { method: string; path: string; body?: string }[] = []
let startFails = false

beforeEach(() => {
  notice.opens = []
  calls = []
  startFails = false
  analyses = [
    analysis('bad', { claims: [claim('Backed.', 'supports'), claim('Refuted.', 'refutes', '1')] }),
    analysis('silent', { claims: [claim('Silent.', 'insufficient')] }),
    analysis('good', {
      claims: [claim('Good one.', 'supports', '1')],
      outline: [{ n: '1', title: 'Introduction', page: 1, y: 10 }],
    }),
    analysis('empty'),
    analysis('busy', { status: 'running' }),
    analysis('broke', { status: 'error', message: 'failed' }),
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^\/api/, '')
      const method = init?.method ?? 'GET'
      calls.push({ method, path, body: init?.body as string | undefined })
      if (method === 'DELETE') return Response.json({ deleted: path.split('/').pop() })
      if (method === 'POST' && path === '/analyses') {
        return startFails ? new Response('too many', { status: 429 }) : Response.json({ id: 'good' })
      }
      if (path === '/uploads') return Response.json({ url: null })
      if (method === 'POST') return Response.json({ id: 'good' })
      if (path === '/analyses') return Response.json(analyses)
      if (path.startsWith('/analyses/')) {
        const found = analyses.find((a) => a.id === path.split('/')[2])
        return found ? Response.json(found) : new Response('missing', { status: 404 })
      }
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderAnalyses(search = '') {
  window.history.replaceState(null, '', `?role=researcher&screen=analyses${search}`)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ResearcherApp />
    </QueryClientProvider>,
  )
  return client
}

const list = () => screen.getByRole('navigation', { name: 'Analyses' })
const row = (name: string) => within(list()).getByTitle(name).closest('div')!
const formHeading = () => screen.findByRole('heading', { name: /Does the paper.s evidence hold up/ })

describe('recent analyses', () => {
  it('says it is loading, then lists nothing as "No analyses yet."', async () => {
    analyses = []
    renderAnalyses()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('No analyses yet.')).toBeInTheDocument()
  })

  it('lists each analysis by file name with its claim count, or a dash', async () => {
    renderAnalyses()
    await screen.findByRole('navigation', { name: 'Analyses' })
    expect(within(row('bad.pdf')).getByText('2')).toBeInTheDocument()
    expect(within(row('good.pdf')).getByText('1')).toBeInTheDocument()
    for (const name of ['empty.pdf', 'busy.pdf', 'broke.pdf']) {
      expect(within(row(name)).getByText('—')).toBeInTheDocument()
    }
    expect(within(row('broke.pdf')).getByText('!')).toBeInTheDocument()
  })

  it('colours the dot by the worst verdict, and pulses while running', async () => {
    renderAnalyses()
    await screen.findByRole('navigation', { name: 'Analyses' })
    const dot = (name: string) => row(name).querySelector('[aria-hidden="true"]')!
    expect(dot('bad.pdf').className).toContain('bg-refutes')
    expect(dot('silent.pdf').className).toContain('bg-insufficient')
    expect(dot('good.pdf').className).toContain('bg-supports')
    expect(dot('empty.pdf').className).toContain('bg-neutral')
    expect(dot('busy.pdf').className).toContain('animate-pulse')
  })

  it('picking one opens it, marks it current and shows its contents', async () => {
    renderAnalyses()
    await screen.findByRole('navigation', { name: 'Analyses' })
    fireEvent.click(within(row('good.pdf')).getByTitle('good.pdf'))
    expect(await screen.findByText('Good one.')).toBeInTheDocument()
    expect(within(row('good.pdf')).getByTitle('good.pdf')).toHaveAttribute('aria-current', 'true')
    expect(new URLSearchParams(window.location.search).get('analysis')).toBe('good')
    expect(await screen.findByRole('navigation', { name: 'Contents of this paper' })).toBeInTheDocument()
  })

  it('+ New returns from an open analysis to the form', async () => {
    renderAnalyses('&analysis=good')
    await screen.findByText('Good one.')
    fireEvent.click(screen.getByRole('button', { name: '+ New' }))
    expect(await formHeading()).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).has('analysis')).toBe(false)
  })

  it('deleting the open analysis returns to the form; deleting another keeps the open one', async () => {
    renderAnalyses('&analysis=good')
    await screen.findByText('Good one.')
    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of empty.pdf' }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/analyses/empty', body: undefined }))
    expect(screen.getByText('Good one.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete analysis of good.pdf' }))
    expect(await formHeading()).toBeInTheDocument()
  })

  it('a finished-run notice opens that analysis from wherever the reader is', async () => {
    const client = renderAnalyses()
    await screen.findByRole('navigation', { name: 'Analyses' })
    // Wait for the first list so "busy" counts as seen running, then let it finish.
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses')).toBe(true))
    analyses = analyses.map((a) => (a.id === 'busy' ? { ...a, status: 'done' } : a))
    await client.invalidateQueries({ queryKey: ['analyses'] })
    await waitFor(() => expect(notice.opens).toHaveLength(1))

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Home' }))
    notice.opens[0]()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('analysis')).toBe('busy'))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('analyses')
  })
})

describe('narrowing an open analysis to a section', () => {
  // The page viewer that opens beside the claims asks matchMedia for the screen size.
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })

  it('picking a section lists only its claims and Show all claims undoes it', async () => {
    renderAnalyses('&analysis=good')
    const contents = await screen.findByRole('navigation', { name: 'Contents of this paper' })
    fireEvent.click(within(contents).getByTitle('1 Introduction, page 1'))
    expect(await screen.findByText(/Claims from/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all claims' }))
    await waitFor(() => expect(screen.queryByText('Show all claims')).not.toBeInTheDocument())
  })
})

describe('starting an analysis', () => {
  const box = () => screen.getByLabelText('Paper to analyze')
  const analyze = () => screen.getByRole('button', { name: 'Analyze' })

  it('shows the form with the three steps when nothing is open', async () => {
    renderAnalyses()
    expect(await formHeading()).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Read the claims'), expect.stringContaining('Weigh it')]),
    )
  })

  it('starts from a typed reference, opens the run and clears the box', async () => {
    renderAnalyses()
    await formHeading()
    expect(analyze()).toBeDisabled()
    fireEvent.change(box(), { target: { value: ' 10.1/x ' } })
    fireEvent.click(analyze())
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('analysis')).toBe('good'))
    const start = calls.find((c) => c.method === 'POST' && c.path === '/analyses')!
    expect(JSON.parse(start.body!)).toEqual({ paper: '10.1/x', verify: true })
  })

  it('does not start from a blank reference', async () => {
    renderAnalyses()
    await formHeading()
    fireEvent.submit(box().closest('form')!)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('Compare full text can be switched off for the run', async () => {
    renderAnalyses()
    await formHeading()
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.change(box(), { target: { value: '10.1/y' } })
    fireEvent.click(analyze())
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses' && c.method === 'POST')).toBe(true))
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!).verify).toBe(false)
  })

  it('shows the gateway message when the start is refused', async () => {
    startFails = true
    renderAnalyses()
    await formHeading()
    fireEvent.change(box(), { target: { value: '10.1/z' } })
    fireEvent.click(analyze())
    expect(await screen.findByRole('alert')).toHaveTextContent('429: too many')
  })

  it('a chosen PDF is uploaded, and an empty choice is ignored', async () => {
    renderAnalyses()
    await formHeading()
    const input = screen.getByLabelText('PDF to analyze')
    fireEvent.change(input, { target: { files: [] } })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    const click = vi.spyOn(input as HTMLInputElement, 'click')
    fireEvent.click(screen.getByRole('button', { name: /drop a PDF here/ }))
    expect(click).toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'p.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses/upload?verify=true')).toBe(true))
  })

  it('a dropped file is uploaded and the zone highlights while it is over', async () => {
    renderAnalyses()
    await formHeading()
    const zone = box().closest('form')!.parentElement!
    fireEvent.dragOver(zone)
    expect(zone.className).toContain('bg-accent-soft')
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toContain('bg-accent-soft')

    fireEvent.drop(zone, { dataTransfer: { files: [] } })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['%PDF'], 'p.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(calls.some((c) => c.path === '/analyses/upload?verify=true')).toBe(true))
  })

  it('a second drop while an upload is running is ignored', async () => {
    let finish!: () => void
    let uploads = 0
    const inner = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/analyses/upload')) uploads += 1
      if (String(url).includes('/analyses/upload')) await new Promise<void>((resolve) => (finish = resolve))
      return inner(url, init)
    })
    renderAnalyses()
    await formHeading()
    const zone = box().closest('form')!.parentElement!
    const drop = () =>
      fireEvent.drop(zone, { dataTransfer: { files: [new File(['%PDF'], 'p.pdf', { type: 'application/pdf' })] } })
    drop()
    await waitFor(() => expect(uploads).toBe(1))
    drop()
    finish()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('analysis')).toBe('good'))
    expect(uploads).toBe(1)
  })

  it('while the checking server is offline nothing can be started, and a drop is ignored', async () => {
    const online = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url).endsWith('/health') ? Response.json({ features: { analyses: false } }) : online(url, init),
    )
    renderAnalyses()
    await formHeading()
    expect(await screen.findByRole('status')).toHaveTextContent('The checking server is offline')
    expect(screen.getByRole('button', { name: /drop a PDF here/ })).toBeDisabled()
    const zone = box().closest('form')!.parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['%PDF'], 'p.pdf', { type: 'application/pdf' })] } })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
