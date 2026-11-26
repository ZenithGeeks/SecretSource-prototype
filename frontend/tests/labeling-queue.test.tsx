import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  puts: [] as { path: string; body: unknown }[],
  putFails: false,
  posts: [] as { path: string; body: unknown }[],
  uploads: [] as string[],
  statusError: '',
  scopus: true,
  downloadFails: false,
  fetched: [] as string[],
  searches: [] as string[],
  pool: {
    topics: ['CV', 'NLP', 'SE', 'HPC'],
    me: 'Chanya',
    lead: false as boolean,
    blind: [] as string[],
    people: [
      { name: 'Chanya', topic: 'NLP' },
      { name: 'Nuttadon', topic: '' },
    ],
    papers: [
      { analysis_id: 'x1', subject: '', keywords: [], title: 'HPC paper', topic: 'HPC', claims: 3, judged: 0, team_judged: 0, labelers: [], status: 'done', reason: '', mine: false, added_by: 'Nuttadon' },
      { analysis_id: 'x2', subject: 'Information Retrieval', keywords: ['ColBERT', 'dense retrieval'], title: 'NLP paper', topic: 'NLP', claims: 5, judged: 2, team_judged: 4, labelers: ['Chanya', 'Somchai'], status: 'done', reason: '', mine: true, venue_rank: 'A*', venue_rank_source: 'CORE 2026' },
      { analysis_id: 'x3', subject: '', keywords: [], title: '10.1/new', topic: 'NLP', claims: 0, judged: 0, team_judged: 0, labelers: [], status: 'running', reason: '', mine: true },
      { analysis_id: 'x4', subject: '', keywords: [], title: '10.1/closed', topic: 'SE', claims: 0, judged: 0, team_judged: 0, labelers: [], status: 'error', reason: 'no open-access PDF known for DOI:10.1/closed', mine: true },
    ],
  },
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  // A labeler's PDF goes up the Researcher role's way, then share-upload lists it.
  api: {
    ...(await original<typeof import('../src/lib/api')>()).api,
    uploadAnalysis: vi.fn(async (file: File) => {
      gateway.uploads.push(file.name)
      return { id: 'up1' }
    }),
  },
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      gateway.puts.push({ path, body: JSON.parse(String(init.body)) })
      if (gateway.putFails) {
        await new Promise((resolve) => setTimeout(resolve, 50)) // long enough to see the list before it fails
        throw new Error('500: could not write')
      }
      return {}
    }
    if (init?.method === 'POST') {
      gateway.posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return { id: 'n1', existing: false }
    }
    if (path === '/labeling/status' && gateway.statusError) throw new Error(gateway.statusError)
    if (path === '/labeling/status') return { annotator: 'Chanya', configured: true, scopus: gateway.scopus }
    if (path === '/labeling/pool') return gateway.pool
    if (path.startsWith('/labeling/scopus/search')) {
      gateway.searches.push(path)
      return {
        results: [
          { doi: '10.1/a', title: 'A late interaction retriever', venue: 'NAACL 2022', year: '2022', first_author: 'Santhanam K.', cited_by: 412, subject: '', keywords: [], added: false },
          { doi: '10.1/b', title: 'Already listed paper', venue: 'ACL 2021', year: '2021', first_author: 'Lee J.', cited_by: 0, subject: '', keywords: [], added: true },
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

const onShowBlind = vi.fn()

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Queue onOpen={onOpen} onShowBlind={onShowBlind} />
    </QueryClientProvider>,
  )
}

describe('the labeler queue', () => {
  beforeEach(() => {
    gateway.puts.length = 0
    gateway.putFails = false
    gateway.posts.length = 0
    gateway.uploads.length = 0
    gateway.searches.length = 0
    gateway.statusError = ''
    gateway.scopus = true
    gateway.downloadFails = false
    gateway.fetched.length = 0
    onOpen.mockClear()
    window.history.replaceState(null, '', '/')
    vi.restoreAllMocks()
  })

  // The papers table: one <tr> per paper after the header row.
  const titlesIn = (table: HTMLElement) =>
    within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].querySelector('.line-clamp-2')?.textContent)
  const rowOf = (table: HTMLElement, title: string) => within(table).getAllByRole('row').find((row) => row.querySelector('.line-clamp-2')?.textContent === title)!

  it('lists only the papers brought in for labeling, the viewer\'s own topic first', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    expect(titlesIn(table)).toEqual(['NLP paper', '10.1/new', 'HPC paper', '10.1/closed'])
    expect(within(table).getAllByText(/your topic/)).toHaveLength(2) // the two NLP papers
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Paper', 'Progress', 'Also labeled by', 'Actions',
    ])
  })

  it('opens a ready paper, shows one being read, and says why another failed', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    fireEvent.click(within(table).getByRole('link', { name: 'NLP paper (Continue)' }))
    expect(onOpen).toHaveBeenCalledWith('x2')
    const reading = rowOf(table, '10.1/new')
    expect(within(reading).getByText('Reading…')).toBeInTheDocument()
    expect(within(reading).queryByRole('button', { name: /10\.1\/new \(/ })).toBeNull() // cannot be opened yet
    expect(within(table).getByRole('alert')).toHaveTextContent('no open-access PDF known for DOI:10.1/closed')
    expect(within(rowOf(table, '10.1/closed')).getByText('Could not be read')).toBeInTheDocument()
  })

  it('lets the person who added a paper remove it', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    const removes = within(table).getAllByRole('button', { name: /^More actions for / })
    expect(removes).toHaveLength(3) // x2, x3, x4 are mine; x1 is someone else's
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(table).getByRole('button', { name: 'More actions for NLP paper' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledWith("Remove this paper from the team's list? Labels already saved are kept.")
    await waitFor(() => expect(gateway.puts).toEqual([{ path: '/labeling/papers/x2/topic', body: { topic: '' } }]))
    expect(onOpen).not.toHaveBeenCalled() // Remove does not also open the row
  })

  it('takes a removed paper off the list at once, and puts it back when the save fails', async () => {
    gateway.putFails = true
    renderQueue()
    const table = await screen.findByRole('table')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(table).getByRole('button', { name: 'More actions for NLP paper' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(titlesIn(table)).not.toContain('NLP paper'))
    await waitFor(() => expect(titlesIn(table)).toContain('NLP paper'))
  })

  it('turns a paper being read into a ready one without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const before = gateway.pool
    try {
      renderQueue()
      const table = await screen.findByRole('table')
      expect(screen.getByText('Reading 1 paper. This list updates by itself.')).toBeInTheDocument()
      gateway.pool = {
        ...before,
        papers: before.papers.map((p) => (p.analysis_id === 'x3' ? { ...p, status: 'done', claims: 4 } : p)),
      }
      await vi.advanceTimersByTimeAsync(5_000)
      // A ready paper shows its progress; only one still being read carries a status.
      await waitFor(() => expect(within(rowOf(table, '10.1/new')).getByText(/of 4 claims/)).toBeInTheDocument())
      expect(within(rowOf(table, '10.1/new')).queryByText('Reading…')).toBeNull()
      expect(screen.queryByText(/This list updates by itself/)).toBeNull()
    } finally {
      gateway.pool = before
      vi.useRealTimers()
    }
  })

  it('says who added a failed paper, and that only they can try again or remove it', async () => {
    gateway.pool.papers.push({
      analysis_id: 'x7', subject: '', keywords: [], title: '10.1145/3712285.3771787', topic: 'HPC', claims: 0, judged: 0, team_judged: 0, labelers: [],
      status: 'error', reason: 'Connection broken: IncompleteRead', mine: false, added_by: 'Nuttadon',
    })
    try {
      renderQueue()
      const table = await screen.findByRole('table')
      const row = rowOf(table, '10.1145/3712285.3771787')
      expect(within(row).getByRole('alert')).toHaveTextContent('Only Nuttadon can try again, upload its PDF or remove it.')
      expect(within(row).queryByRole('button', { name: /Try again/ })).toBeNull()
      expect(within(row).queryByRole('button', { name: /Upload the PDF/ })).toBeNull()
      expect(within(row).queryByRole('button', { name: /More actions/ })).toBeNull()
    } finally {
      gateway.pool.papers.pop()
    }
  })

  it('lets the person who added a failed paper try it again', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    const row = rowOf(table, '10.1/closed')
    expect(within(row).getByRole('alert')).toHaveTextContent('Try again, upload its PDF, or remove it.')
    fireEvent.click(within(row).getByRole('button', { name: 'Try again 10.1/closed' }))
    await waitFor(() => expect(gateway.posts).toEqual([{ path: '/labeling/papers/x4/retry', body: undefined }]))
  })

  it('lets the person who added a failed paper upload its PDF in its place', async () => {
    renderQueue()
    const row = rowOf(await screen.findByRole('table'), '10.1/closed')
    expect(within(row).getByRole('button', { name: 'Upload the PDF of 10.1/closed' })).toBeEnabled()

    // The button opens the browser's file picker; a test picks the file on its input directly.
    const pdf = new File(['%PDF-1.7'], 'closed.pdf', { type: 'application/pdf' })
    fireEvent.change(row.querySelector('input[type="file"]')!, { target: { files: [pdf] } })

    await waitFor(() =>
      expect(gateway.posts).toEqual([
        { path: '/labeling/papers/up1/share-upload', body: { topic: '', doi: '', replaces: 'x4' } },
      ]),
    )
    expect(gateway.uploads).toEqual(['closed.pdf'])
  })

  it('does nothing when the person declines to remove a paper', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderQueue()
    const table = await screen.findByRole('table')
    fireEvent.click(within(table).getAllByRole('button', { name: /^More actions for / })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(gateway.puts).toEqual([])
  })

  it("shows the team's progress on each paper, the viewer's own count, and who else labeled it", async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    // Chanya decided 2 of the NLP paper's claims; with Somchai the team has decided 4.
    expect(within(table).getByText('Team: 4 of 5')).toBeInTheDocument()
    expect(within(rowOf(table, 'NLP paper')).getByText('You: 2 of 5 claims')).toBeInTheDocument()
    expect(within(table).getByText('Team: 0 of 3')).toBeInTheDocument()
    const bar = within(table).getByRole('progressbar', { name: 'Claims you decided in NLP paper' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    const labeledBy = within(rowOf(table, 'NLP paper')).getAllByRole('cell')[2]
    expect(labeledBy).toHaveTextContent('Somchai') // not Chanya: that is the viewer
    expect(labeledBy).not.toHaveTextContent('Chanya')
  })

  it('says Start, Continue or Review depending on how much is judged', async () => {
    gateway.pool.papers.push({ analysis_id: 'x5', subject: '', keywords: [], title: 'Finished paper', topic: 'CV', claims: 4, judged: 4, team_judged: 4, labelers: ['Chanya'], status: 'done', reason: '', mine: false })
    try {
      renderQueue()
      const table = await screen.findByRole('table')
      expect(within(table).getByRole('link', { name: 'HPC paper (Start)' })).toBeInTheDocument()
      expect(within(table).getByRole('link', { name: 'NLP paper (Continue)' })).toBeInTheDocument()
      expect(within(table).getByRole('link', { name: 'Finished paper (Review)' })).toBeInTheDocument()
      const finished = rowOf(table, 'Finished paper')
      expect(within(finished).getByText('You: all 4 claims')).toHaveClass('text-supports')
      expect(within(finished).getByText('Team: all 4')).toBeInTheDocument()
    } finally {
      gateway.pool.papers.pop()
    }
  })

  it('puts every paper the viewer has not finished before the finished ones', async () => {
    gateway.pool.papers.unshift({ analysis_id: 'x6', subject: '', keywords: [], title: 'Done NLP paper', topic: 'NLP', claims: 4, judged: 4, team_judged: 4, labelers: ['Chanya'], status: 'done', reason: '', mine: false })
    try {
      renderQueue()
      const table = await screen.findByRole('table')
      expect(titlesIn(table)).toEqual(['NLP paper', '10.1/new', 'HPC paper', '10.1/closed', 'Done NLP paper'])
    } finally {
      gateway.pool.papers.shift()
    }
  })

  it('filters by topic and status together, with counts for each choice', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    expect(screen.getByRole('status')).toHaveTextContent('4 papers')

    fireEvent.click(screen.getByRole('button', { name: 'Topic' }))
    const topics = screen.getByRole('group', { name: 'Topic' })
    expect(within(topics).getByRole('checkbox', { name: /NLP/ }).closest('label')).toHaveTextContent('NLP2')
    fireEvent.click(within(topics).getByRole('checkbox', { name: /NLP/ }))
    expect(titlesIn(table)).toEqual(['NLP paper', '10.1/new'])

    fireEvent.click(screen.getByRole('button', { name: /^Status/ }))
    const statuses = screen.getByRole('group', { name: 'Status' })
    // Counts follow the other filters: of the two NLP papers, one is ready and one is being read.
    expect(within(statuses).getByRole('checkbox', { name: /Ready/ }).closest('label')).toHaveTextContent('Ready1')
    expect(within(statuses).getByRole('checkbox', { name: /Could not be read/ }).closest('label')).toHaveTextContent('Could not be read0')
    fireEvent.click(within(statuses).getByRole('checkbox', { name: /Ready/ }))
    expect(within(statuses).getByRole('checkbox', { name: /Ready/ })).toBeChecked()
    expect(titlesIn(table)).toEqual(['NLP paper'])
    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 papers')
    expect(window.location.search).toContain('topic=NLP')
  })

  it('lists "You" first under Added by and matches any of the chosen people', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Added by' }))
    const people = screen.getByRole('group', { name: 'Added by' })
    expect(within(people).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(['You3', 'Nuttadon1'])
    fireEvent.click(within(people).getByRole('checkbox', { name: /Nuttadon/ }))
    expect(titlesIn(table)).toEqual(['HPC paper'])
    fireEvent.click(within(people).getByRole('checkbox', { name: /You/ }))
    expect(titlesIn(table)).toHaveLength(4)
  })

  it('summarizes the chosen people\'s papers by the whole team\'s progress, for one or several', async () => {
    renderQueue()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Added by' }))
    const people = screen.getByRole('group', { name: 'Added by' })

    // Nuttadon's one paper (HPC paper) has no claims judged yet by anyone.
    fireEvent.click(within(people).getByRole('checkbox', { name: /Nuttadon/ }))
    expect(screen.getByText(/Nuttadon: 0 done · 0 in progress · 1 not started/)).toBeInTheDocument()

    // Several chosen, same as Topic: the summary covers everyone picked, combined.
    fireEvent.click(within(people).getByRole('checkbox', { name: /You/ }))
    expect(screen.getByText(/Nuttadon, You: 0 done · 1 in progress · 3 not started/)).toBeInTheDocument()

    // Back to one: your papers. NLP paper is started (4 of 5 judged by the team), the other two untouched.
    fireEvent.click(within(people).getByRole('checkbox', { name: /Nuttadon/ }))
    expect(screen.getByText(/You: 0 done · 1 in progress · 2 not started/)).toBeInTheDocument()

    // Nobody chosen: no summary.
    fireEvent.click(within(people).getByRole('checkbox', { name: /You/ }))
    expect(screen.queryByText(/in progress/)).not.toBeInTheDocument()
  })

  it('filters by my progress and by words in the title', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'My progress' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'My progress' })).getByRole('checkbox', { name: /Started/ }))
    expect(titlesIn(table)).toEqual(['NLP paper'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and keywords' }), { target: { value: 'hpc' } })
    expect(titlesIn(table)).toEqual(['HPC paper'])
  })

  it('shows a paper’s venue rank when it is known', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    expect(within(rowOf(table, 'NLP paper')).getByTitle('Venue rank A*, CORE 2026')).toBeInTheDocument()
    expect(within(rowOf(table, 'HPC paper')).queryByTitle(/Venue rank/)).toBeNull()
  })

  it('shows each paper’s subject and keywords, and finds a paper by a keyword', async () => {
    renderQueue()
    const table = await screen.findByRole('table')
    fireEvent.click(within(rowOf(table, 'NLP paper')).getByRole('button', { name: 'Keywords' }))
    const tags = within(rowOf(table, 'NLP paper')).getByRole('list', { name: 'Subject and keywords' })
    expect(within(tags).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Information Retrieval',
      'ColBERT',
      'dense retrieval',
    ])
    expect(within(rowOf(table, 'HPC paper')).queryByRole('button', { name: 'Keywords' })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and keywords' }), { target: { value: 'colbert' } })
    expect(titlesIn(table)).toEqual(['NLP paper'])
  })

  it('says which filters left nothing, and clears them from there', async () => {
    renderQueue()
    await screen.findByRole('table')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and keywords' }), { target: { value: 'nothing like this' } })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No papers match these filters')).toBeInTheDocument()
    expect(screen.getByText('Title or keywords have "nothing like this"')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 of 4 papers')
    const clears = screen.getAllByRole('button', { name: 'Clear filters' })
    fireEvent.click(clears[clears.length - 1])
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('keeps the filters in the address bar', async () => {
    window.history.replaceState(null, '', '/?status=error&topic=SE')
    renderQueue()
    const table = await screen.findByRole('table')
    expect(titlesIn(table)).toEqual(['10.1/closed'])
  })

  it('sets a teammate\'s topic from the dropdown', async () => {
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Team' }))
    const group = await screen.findByRole('radiogroup', { name: 'Topic for Nuttadon' })
    expect(within(group).getByRole('radio', { name: 'No topic' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: 'HPC' }))
    await waitFor(() => expect(gateway.puts).toEqual([{ path: '/labeling/people', body: { name: 'Nuttadon', topic: 'HPC' } }]))
  })

  it('searches Scopus by topic and adds a result under that topic', async () => {
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Add papers' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Downloads' }))
    for (const name of [
      'Download labels CSV',
      'Download claims CSV',
      'Download DSPy claims (JSONL)',
      'Download DSPy verdicts (JSONL)',
    ]) {
      const button = await screen.findByRole('button', { name })
      await waitFor(() => expect(button).toBeEnabled())
      fireEvent.click(button)
      await waitFor(() => expect(saved).toHaveLength(saved.length > 0 ? saved.length : 1))
      await waitFor(() => expect(button).toBeEnabled())
    }
    expect(gateway.fetched.map((u) => u.split('tab=')[1])).toEqual([
      'labels&scope=mine',
      'claims&scope=mine',
      'dspy_claims&scope=mine',
      'dspy_verdicts&scope=mine',
    ])
    expect(saved).toEqual(['evidence_labels.csv', 'claims.csv', 'dspy_claims.jsonl', 'dspy_verdicts.jsonl'])
  })

  it('downloads the whole team only when asked, under its own file name', async () => {
    const before = gateway.pool
    gateway.pool = { ...before, lead: true }
    onTestFinished(() => {
      gateway.pool = before
    })
    const saved: string[] = []
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Downloads' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Whole team' }))
    const button = await screen.findByRole('button', { name: 'Download labels CSV' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(saved).toEqual(['evidence_labels_team.csv']))
    expect(gateway.fetched.at(-1)).toContain('tab=labels&scope=team')
  })

  it('offers the whole team download only to a lead', async () => {
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Downloads' }))
    await screen.findByRole('button', { name: 'Download labels CSV' })
    expect(screen.queryByRole('radio', { name: 'Whole team' })).not.toBeInTheDocument()
  })

  it('lists papers checked blind, marked, and points to the Blind checks tab', async () => {
    const before = gateway.pool
    gateway.pool = { ...before, blind: ['x1'] }
    onTestFinished(() => {
      gateway.pool = before
    })
    renderQueue()
    await screen.findByRole('table')
    expect(within(screen.getByText('HPC paper').closest('tr')!).getByText('Blind check')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open blind checks' }))
    expect(onShowBlind).toHaveBeenCalled()
  })

  it('says so, in plain words, when a download fails', async () => {
    gateway.downloadFails = true
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Downloads' }))
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

  it('tells a Cloudflare challenge apart from a real access denial', async () => {
    gateway.statusError =
      '403: <!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
    renderQueue()
    expect(await screen.findByText("The site's protection blocked this request")).toBeInTheDocument()
    expect(screen.getByText(/Reload the page, or open \/api\/health/)).toBeInTheDocument()
    expect(screen.queryByText("You can't use the labeler")).not.toBeInTheDocument()
    expect(screen.queryByText(/Just a moment|<!DOCTYPE/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows who has which topic on one line, and opens by itself for someone with no topic', async () => {
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Team' }))
    const summary = await screen.findByText(/NLP 1 · no topic 1 · you: NLP/)
    expect(summary.closest('details')).not.toHaveAttribute('open') // Chanya already has NLP
  })

  it('opens the team panel when the viewer has no topic yet', async () => {
    gateway.pool.people[0].topic = ''
    renderQueue()
    fireEvent.click(await screen.findByRole('button', { name: 'Team' }))
    const summary = await screen.findByText(/no topic 2/)
    expect(summary.closest('details')).toHaveAttribute('open')
    gateway.pool.people[0].topic = 'NLP'
  })
})
