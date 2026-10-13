import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  puts: [] as { path: string; body: unknown }[],
  posts: [] as { path: string; body: unknown }[],
  statusError: '',
  scopus: true,
  downloadFails: false,
  fetched: [] as string[],
  searches: [] as string[],
  pool: {
    topics: ['CV', 'NLP', 'SE', 'HPC'],
    me: 'Chanya',
    people: [
      { name: 'Chanya', topic: 'NLP' },
      { name: 'Nuttadon', topic: '' },
    ],
    papers: [
      { analysis_id: 'x1', title: 'HPC paper', topic: 'HPC', claims: 3, judged: 0, labelers: [], status: 'done', reason: '', mine: false },
      { analysis_id: 'x2', title: 'NLP paper', topic: 'NLP', claims: 5, judged: 2, labelers: ['Chanya', 'Somchai'], status: 'done', reason: '', mine: true },
      { analysis_id: 'x3', title: '10.1/new', topic: 'NLP', claims: 0, judged: 0, labelers: [], status: 'running', reason: '', mine: true },
      { analysis_id: 'x4', title: '10.1/closed', topic: 'SE', claims: 0, judged: 0, labelers: [], status: 'error', reason: 'no open-access PDF known for DOI:10.1/closed', mine: true },
    ],
  },
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      gateway.puts.push({ path, body: JSON.parse(String(init.body)) })
      return {}
    }
    if (init?.method === 'POST') {
      gateway.posts.push({ path, body: JSON.parse(String(init.body)) })
      return { id: 'n1', existing: false }
    }
    if (path === '/labeling/status' && gateway.statusError) throw new Error(gateway.statusError)
    if (path === '/labeling/status') return { annotator: 'Chanya', configured: true, scopus: gateway.scopus }
    if (path === '/labeling/pool') return gateway.pool
    if (path.startsWith('/labeling/scopus/search')) {
      gateway.searches.push(path)
      return {
        results: [
          { doi: '10.1/a', title: 'A late interaction retriever', venue: 'NAACL 2022', year: '2022', first_author: 'Santhanam K.', cited_by: 412, added: false },
          { doi: '10.1/b', title: 'Already listed paper', venue: 'ACL 2021', year: '2021', first_author: 'Lee J.', cited_by: 0, added: true },
        ],
      }
    }
    throw new Error(`unexpected ${path}`)
  }),
  fetchFile: vi.fn(async (url: string) => {
    if (gateway.downloadFails) throw new Error(`500: ${url}`)
    gateway.fetched.push(url)
    return new Blob(['x'])
  }),
}))

import { Queue } from '../src/roles/labeler/screens/Queue'

const onOpen = vi.fn()

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Queue onOpen={onOpen} />
    </QueryClientProvider>,
  )
}

describe('the labeler queue', () => {
  beforeEach(() => {
    gateway.puts.length = 0
    gateway.posts.length = 0
    gateway.searches.length = 0
    gateway.statusError = ''
    gateway.scopus = true
    gateway.downloadFails = false
    gateway.fetched.length = 0
    onOpen.mockClear()
    vi.restoreAllMocks()
  })

  it('lists only the papers brought in for labeling, the viewer\'s own topic first', async () => {
    renderQueue()
    const list = await screen.findByRole('region', { name: 'Papers to label' })
    const titles = within(list).getAllByText(/paper$|^10\.1\//).map((el) => el.textContent)
    expect(titles).toEqual(['NLP paper', '10.1/new', 'HPC paper', '10.1/closed'])
    expect(within(list).getAllByText(/your topic/)).toHaveLength(2) // the two NLP papers
  })

  it('opens a ready paper, shows one being read, and says why another failed', async () => {
    renderQueue()
    const list = await screen.findByRole('region', { name: 'Papers to label' })
    fireEvent.click(within(list).getByRole('button', { name: /NLP paper/ }))
    expect(onOpen).toHaveBeenCalledWith('x2')
    expect(within(list).getByRole('button', { name: /reading the paper/ })).toBeDisabled()
    expect(within(list).getByRole('alert')).toHaveTextContent('no open-access PDF known for DOI:10.1/closed')
  })

  it('lets the person who added a paper remove it', async () => {
    renderQueue()
    const list = await screen.findByRole('region', { name: 'Papers to label' })
    const removes = within(list).getAllByRole('button', { name: 'Remove' })
    expect(removes).toHaveLength(3) // x2, x3, x4 are mine; x1 is someone else's
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(removes[0])
    expect(confirm).toHaveBeenCalledWith("Remove this paper from the team's list? Labels already saved are kept.")
    await waitFor(() => expect(gateway.puts).toEqual([{ path: '/labeling/papers/x2/topic', body: { topic: '' } }]))
  })

  it('does nothing when the person declines to remove a paper', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderQueue()
    const list = await screen.findByRole('region', { name: 'Papers to label' })
    fireEvent.click(within(list).getAllByRole('button', { name: 'Remove' })[0])
    expect(confirm).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(gateway.puts).toEqual([])
  })

  it('shows how far the viewer is through each paper and who else labeled it', async () => {
    renderQueue()
    const list = await screen.findByRole('region', { name: 'Papers to label' })
    expect(within(list).getByText('2 of 5 claims judged by you')).toBeInTheDocument()
    expect(within(list).getByText('0 of 3 claims judged by you')).toBeInTheDocument()
    const bar = within(list).getByRole('progressbar', { name: /NLP paper/ })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    expect(within(list).getByText('Also labeled by Somchai')).toBeInTheDocument() // not Chanya: that is the viewer
    expect(within(list).getAllByText(/Also labeled by/)).toHaveLength(1)
  })

  it('says Label, Continue or Review depending on how much is judged', async () => {
    gateway.pool.papers.push({ analysis_id: 'x5', title: 'Finished paper', topic: 'CV', claims: 4, judged: 4, labelers: ['Chanya'], status: 'done', reason: '', mine: false })
    try {
      renderQueue()
      const list = await screen.findByRole('region', { name: 'Papers to label' })
      const action = (name: RegExp) => within(within(list).getByRole('button', { name })).getByText(/^(Label|Continue|Review)$/).textContent
      expect(action(/^HPC paper/)).toBe('Label')
      expect(action(/^NLP paper/)).toBe('Continue')
      expect(action(/^Finished paper/)).toBe('Review')
      expect(within(list).getByText('All 4 claims judged by you')).toBeInTheDocument()
    } finally {
      gateway.pool.papers.pop()
    }
  })

  it('puts papers the viewer has not finished before finished ones of the same topic', async () => {
    gateway.pool.papers.unshift({ analysis_id: 'x6', title: 'Done NLP paper', topic: 'NLP', claims: 4, judged: 4, labelers: ['Chanya'], status: 'done', reason: '', mine: false })
    try {
      renderQueue()
      const list = await screen.findByRole('region', { name: 'Papers to label' })
      const titles = within(list).getAllByText(/paper$|^10\.1\//).map((el) => el.textContent)
      expect(titles).toEqual(['NLP paper', '10.1/new', 'Done NLP paper', 'HPC paper', '10.1/closed'])
    } finally {
      gateway.pool.papers.shift()
    }
  })

  it('sets a teammate\'s topic from the dropdown', async () => {
    renderQueue()
    const group = await screen.findByRole('radiogroup', { name: 'Topic for Nuttadon' })
    expect(within(group).getByRole('radio', { name: 'No topic' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: 'HPC' }))
    await waitFor(() => expect(gateway.puts).toEqual([{ path: '/labeling/people', body: { name: 'Nuttadon', topic: 'HPC' } }]))
  })

  it('searches Scopus by topic and adds a result under that topic', async () => {
    renderQueue()
    fireEvent.change(await screen.findByLabelText('Topic to search'), { target: { value: 'CV' } })
    fireEvent.change(screen.getByLabelText(/Words in the title/), { target: { value: 'late interaction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search Scopus' }))
    const results = await screen.findByRole('list', { name: 'Scopus results' })
    expect(gateway.searches[0]).toContain('topic=CV')
    expect(gateway.searches[0]).toContain('q=late+interaction')
    expect(within(results).getByText(/NAACL 2022 · 2022 · Santhanam K\. · cited 412/)).toBeInTheDocument()
    expect(within(results).getByRole('button', { name: 'Add Already listed paper' })).toBeDisabled()
    fireEvent.click(within(results).getByRole('button', { name: 'Add A late interaction retriever' }))
    await waitFor(() => expect(gateway.posts).toEqual([{ path: '/labeling/scopus/add', body: { doi: '10.1/a', topic: 'CV' } }]))
    expect(await within(results).findByRole('button', { name: 'Add A late interaction retriever' })).toHaveTextContent('Added')
  })

  it('downloads the labels CSV and the two DSPy example files', async () => {
    const saved: string[] = []
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    renderQueue()
    for (const name of ['Download labels CSV', 'Download DSPy claims (JSONL)', 'Download DSPy verdicts (JSONL)']) {
      const button = await screen.findByRole('button', { name })
      await waitFor(() => expect(button).toBeEnabled())
      fireEvent.click(button)
      await waitFor(() => expect(saved).toHaveLength(saved.length > 0 ? saved.length : 1))
      await waitFor(() => expect(button).toBeEnabled())
    }
    expect(gateway.fetched.map((u) => u.split('tab=')[1])).toEqual(['labels', 'dspy_claims', 'dspy_verdicts'])
    expect(saved).toEqual(['evidence_labels.csv', 'dspy_claims.jsonl', 'dspy_verdicts.jsonl'])
  })

  it('says so, in plain words, when a download fails', async () => {
    gateway.downloadFails = true
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Download DSPy claims (JSONL)' }))
    expect(await screen.findByText(/Something went wrong\./)).toBeInTheDocument()
    expect(screen.queryByText(/500:/)).not.toBeInTheDocument()
  })

  it('says Scopus search is not set up when the gateway has no key', async () => {
    gateway.scopus = false
    renderQueue()
    expect(await screen.findByText('Scopus search is not set up yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search Scopus' })).not.toBeInTheDocument()
  })

  it('tells a person what went wrong in plain words, never the gateway\'s own text', async () => {
    gateway.statusError = '403: {"detail":"this account is not on the labeling team (LABELING_ALLOWED)"}'
    renderQueue()
    expect(await screen.findByText("You can't use the labeler")).toBeInTheDocument()
    expect(screen.queryByText(/LABELING_ALLOWED|detail/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows who has which topic on one line, and opens by itself for someone with no topic', async () => {
    renderQueue()
    const summary = await screen.findByText(/NLP 1 · no topic 1 · you: NLP/)
    expect(summary.closest('details')).not.toHaveAttribute('open') // Chanya already has NLP
  })

  it('opens the team panel when the viewer has no topic yet', async () => {
    gateway.pool.people[0].topic = ''
    renderQueue()
    const summary = await screen.findByText(/no topic 2/)
    expect(summary.closest('details')).toHaveAttribute('open')
    gateway.pool.people[0].topic = 'NLP'
  })
})
