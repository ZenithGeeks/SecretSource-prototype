/** The paper table's failed rows and the bell's less common states. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  online: true,
  retry: 'ok' as 'ok' | 'fail' | 'hang',
  upload: 'ok' as 'ok' | 'fail' | 'hang',
  pool: {} as Record<string, unknown>,
  posts: [] as string[],
  puts: [] as unknown[],
}))

vi.mock('../src/lib/api', async (original) => {
  const real = await original<typeof import('../src/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      uploadAnalysis: vi.fn(async () => {
        if (gateway.upload === 'hang') await new Promise(() => undefined)
        if (gateway.upload === 'fail') throw new Error('500: boom')
        return { id: 'up1' }
      }),
    },
    request: vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { features: { analyses: gateway.online } }
      if (path === '/labeling/pool') return gateway.pool
      if (init?.method === 'PUT') {
        gateway.puts.push(JSON.parse(String(init.body)))
        return {}
      }
      if (init?.method === 'POST') {
        gateway.posts.push(path)
        if (path.endsWith('/retry') && gateway.retry === 'hang') await new Promise(() => undefined)
        if (path.endsWith('/retry') && gateway.retry === 'fail') throw new Error('409: running')
        return { id: 'n1' }
      }
      throw new Error(`unexpected ${path}`)
    }),
  }
})

import type { Pool } from '../src/lib/labeling'
import { PaperBell } from '../src/roles/labeler/components/PaperBell'
import { PaperTable } from '../src/roles/labeler/components/PaperTable'

type Paper = Pool['papers'][number]

const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  analysis_id: id,
  title: `Paper ${id}`,
  topic: 'CV',
  claims: 4,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: true,
  added_by: 'Chanya',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
  ...over,
})

const withQuery = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

beforeEach(() => {
  gateway.online = true
  gateway.retry = 'ok'
  gateway.upload = 'ok'
  gateway.posts.length = 0
  gateway.puts.length = 0
  gateway.pool = { topics: ['CV'], me: 'Chanya', people: [], papers: [] }
})
afterEach(() => vi.restoreAllMocks())

describe('failed rows in the paper table', () => {
  const failed = (over: Partial<Paper> = {}) => paper('f1', { status: 'error', claims: 0, ...over })
  const row = () => screen.getByRole('row', { name: /Paper f1/ })

  it('says there are no claims for a paper that is ready but empty', () => {
    withQuery(<PaperTable papers={[paper('e1', { claims: 0 })]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    expect(screen.getByText('No claims')).toBeInTheDocument()
  })

  it('tells someone else who can retry a paper that has no reason recorded', () => {
    withQuery(<PaperTable papers={[failed({ mine: false, added_by: '' })]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    expect(row()).toHaveTextContent('Could not be read: no open PDF was found. Only the person who added it can try again')
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
  })

  it('says why trying again failed', async () => {
    gateway.retry = 'fail'
    withQuery(<PaperTable papers={[failed({ reason: 'Not open access' })]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again Paper f1' }))
    await waitFor(() => expect(row()).toHaveTextContent('Trying again failed: This paper is not ready.'))
  })

  it('shows Starting while a retry runs and keeps the other buttons off', async () => {
    gateway.retry = 'hang'
    withQuery(<PaperTable papers={[failed()]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again Paper f1' }))
    const starting = await screen.findByRole('button', { name: 'Starting Paper f1' })
    expect(starting).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More actions for Paper f1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Upload the PDF/ })).toBeDisabled()
  })

  it('uploads a PDF in place of the failed paper, and says when that fails', async () => {
    gateway.upload = 'fail'
    withQuery(<PaperTable papers={[failed()]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    const pdf = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } })
    await waitFor(() => expect(row()).toHaveTextContent('The PDF was not added: Something went wrong.'))
  })

  it('turns the retry off while its PDF uploads', async () => {
    gateway.upload = 'hang'
    withQuery(<PaperTable papers={[failed()]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    const pdf = new File(['x'], 'p.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again Paper f1' })).toBeDisabled())
  })

  it('turns the controls off and says why when the checking server is offline', async () => {
    gateway.online = false
    withQuery(<PaperTable papers={[failed()]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    await waitFor(() => expect(row()).toHaveTextContent('The checking server is offline'))
    expect(screen.getByRole('button', { name: 'Try again Paper f1' })).toBeDisabled()
  })

  it('removes a paper from the row menu only after the person agrees', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    withQuery(<PaperTable papers={[paper('r1')]} me="Chanya" myTopic="CV" onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Paper r1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(gateway.puts).toEqual([])
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Paper r1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(gateway.puts).toEqual([{ topic: '' }]))
  })

  it('hides keywords behind a toggle', () => {
    withQuery(<PaperTable papers={[paper('k1', { keywords: ['rag', 'llm'], mine: false })]} me="Chanya" myTopic="NLP" onOpen={vi.fn()} />)
    expect(screen.queryByText('rag')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keywords' }))
    expect(screen.getByText('rag')).toBeInTheDocument()
  })
})

describe('the bell', () => {
  const bell = () => screen.findByRole('button', { name: /^Your papers/ })
  const open = async () => {
    fireEvent.click(await bell())
    return screen.getByRole('dialog', { name: 'Your papers' })
  }

  it('lists a paper being read', async () => {
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('r1', { status: 'running' })] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    const panel = await open()
    expect(within(panel).getByText('Reading the paper and its references')).toBeInTheDocument()
  })

  it('names a failure without a reason, and shows Starting while the retry runs', async () => {
    gateway.retry = 'hang'
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('f1', { status: 'error' })] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    const panel = await open()
    expect(within(panel).getByText('The analysis stopped.')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again Paper f1' }))
    expect(await within(panel).findByRole('button', { name: 'Starting Paper f1' })).toBeDisabled()
  })

  it('lists the ready papers that are new first', async () => {
    window.localStorage.setItem('labeler.seenPapers', JSON.stringify({ old: 'done' }))
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('old'), paper('fresh')] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    await screen.findByRole('button', { name: 'Your papers, 1 new' })
    const panel = await open()
    const titles = within(panel).getAllByRole('listitem').map((item) => item.textContent)
    expect(titles[0]).toContain('Paper fresh')
    expect(titles[0]).toContain('New')
    expect(titles[1]).toBe('Paper oldOpen')
  })

  it('stays open for a click or a scroll inside the panel and a press on the bell itself', async () => {
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('a1')] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    const panel = await open()
    fireEvent.pointerDown(within(panel).getByText('Your papers', { selector: 'h2' }))
    fireEvent.scroll(within(panel).getByRole('region', { name: 'Ready to label' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Your papers/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps what it has seen in memory when the browser will not store it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('a1')] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    await open()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('counts nothing when the browser will not give storage back', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    gateway.pool = { topics: [], me: 'Chanya', people: [], papers: [paper('a1')] }
    withQuery(<PaperBell onOpen={vi.fn()} />)
    expect(await bell()).toHaveAccessibleName('Your papers')
  })
})
