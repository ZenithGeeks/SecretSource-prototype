/**
 * Author Home (Redesign A1) against the fake gateway (tests/fakeAuthorGateway.ts): the counts and
 * warnings come from the seeded thesis chapter, and every action ends in the request the real
 * gateway would get. What the screen changed is still there after it unmounts and mounts again, as
 * after a page refresh. New project ▾ lives in the shell's toolbar: see author-app.test.tsx.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { resetSettings, updateSettings } from '../src/lib/settings'
import { Home } from '../src/roles/author/screens/Home'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway
let queryClient: QueryClient

function renderWithQuery(ui: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderHome(draftId: string | null = 'd1') {
  const onSelectDraft = vi.fn()
  const onOpenEditor = vi.fn()
  const onOpenHistory = vi.fn()
  const view = renderWithQuery(<Home draftId={draftId} onSelectDraft={onSelectDraft} onOpenEditor={onOpenEditor} onOpenHistory={onOpenHistory} />)
  return { ...view, onSelectDraft, onOpenEditor, onOpenHistory }
}

const rowsOf = async () => within(await screen.findByRole('list', { name: 'Citations' })).getAllByRole('button')
const bibliography = () => within(screen.getByRole('heading', { name: 'Bibliography' }).closest('.rounded-2xl') as HTMLElement)

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

afterEach(() => vi.unstubAllGlobals())

describe('Author Home', () => {
  test('greets, says what needs work, and shows the latest-project card with its bar and legend', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeInTheDocument()
    expect(await screen.findByText('3 \\cite commands in Related work — thesis ch.2 point to papers that don’t say what you wrote.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Related work — thesis ch.2 · Related work — thesis ch.2' })).toBeInTheDocument()
    expect(screen.getByText(/related-work\.tex/, { selector: 'p[title]' })).toBeInTheDocument()
    expect(screen.getByText('2 supported')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /2 supported/ })).toBeInTheDocument()
    expect(gateway.calls).toContain('GET /author/drafts/d1')
  })

  test('"Open in editor" opens the draft; no old screen and no sources search anywhere', async () => {
    const { onOpenEditor } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Open in editor' }))
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: 'd1' })
    expect(screen.queryByRole('heading', { name: 'Check a draft' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Find a source/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Find a replacement/ })).not.toBeInTheDocument()
    expect(gateway.calls.some((c) => c.includes('/author/search'))).toBe(false)
  })

  test('"Citations that need work" lists the open issues and what could not be judged, with file and line', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Citations that need work' })).toBeInTheDocument()
    const rows = await rowsOf()
    expect(rows[0]).toHaveTextContent('Source contradicts')
    expect(rows[0]).toHaveTextContent('\\cite{khattab2020}')
    expect(rows[0]).toHaveTextContent(/related-work\.tex · L\d+ · khattab2020\.pdf p\.7/)
    expect(rows.some((row) => row.textContent?.includes('no bib entry'))).toBe(true)
  })

  test('the card says what it counts: its issues are the pager’s and Your drafts’ number, the rest are named', async () => {
    renderHome()
    const card = within((await screen.findByRole('heading', { name: 'Citations that need work' })).closest('.rounded-2xl') as HTMLElement)
    const label = await card.findByText(/^\d+ issues?/)
    expect(label).toHaveTextContent(/^3 issues/)
    expect(label).toHaveTextContent(/\d+ not checked$/)
    // Every row on the card is in the label.
    const counted = (label.textContent ?? '').split(' · ').reduce((sum, part) => sum + Number(part.split(' ')[0]), 0)
    expect(await rowsOf()).toHaveLength(counted)
    expect(screen.getByRole('button', { name: /1 of 3 issues/ })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Drafts' })).getAllByRole('button').some((row) => row.textContent?.includes('3 issues'))).toBe(true)

    fireEvent.click(card.getByRole('button', { name: 'All' }))
    expect(await card.findByText('8 citations')).toBeInTheDocument()
  })

  test('the Evidence panel follows the rows and its pager cycles the open issues only', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })).toBeInTheDocument()
    expect(screen.getByText('“we leave compression of the embeddings to future work”')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 of 3 issues/ }))
    expect(screen.getByRole('button', { name: /2 of 3 issues/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('heading', { name: 'Citations' })).toBeInTheDocument()
    expect(await rowsOf()).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Low confidence' }))
    const low = await rowsOf()
    expect(low).toHaveLength(1)
    expect(low[0]).toHaveTextContent('thakur2021')
    fireEvent.click(screen.getByRole('button', { name: 'By section' }))
    expect(screen.getByRole('list', { name: 'Citations by section' })).toBeInTheDocument()
  })

  test('Override and Keep mine record the resolution, survive a remount, and Reopen undoes it', async () => {
    const first = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /Override · add note/ }))
    fireEvent.change(screen.getByLabelText('Why you are keeping this citation'), { target: { value: 'Table 3 says so' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /1 of 2 issues/ })).toBeInTheDocument())
    expect(gateway.calls.some((c) => /^PATCH \/author\/checks\/check\d+\/citations\//.test(c))).toBe(true)
    const check = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!
    expect(check.citations.find((c) => c.resolution)?.resolution).toMatchObject({ kind: 'overridden', note: 'Table 3 says so' })

    // A fresh mount (a refresh) reads the same state back from the gateway.
    first.unmount()
    queryClient.clear()
    renderHome()
    expect(await screen.findByRole('button', { name: /1 of 2 issues/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    const kept = (await rowsOf()).find((row) => row.textContent?.includes('kept, with a note'))!
    fireEvent.click(kept)
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /of 3 issues/ })).toBeInTheDocument())
    expect(check.citations.some((c) => c.resolution)).toBe(false)
  })

  test('Upload source PDF attaches the file to that citation’s key', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    expect(screen.getByRole('button', { name: /Upload source PDF/ })).toBeInTheDocument()
    const input = document.querySelector('input[accept="application/pdf,.pdf"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'colbert.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(gateway.calls).toContain('POST /author/drafts/d1/citations/khattab2020/pdf'))
    expect(await screen.findByText('colbert.pdf attached to \\cite{khattab2020}. Re-check to read it.')).toBeInTheDocument()
  })

  test('Re-check starts a run on the gateway and the new verdicts land', async () => {
    renderHome()
    await rowsOf()
    gateway.verdictFor = () => ({ verdict: 'supports', passage: 'all good', page: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(screen.queryByText(/point to papers/)).not.toBeInTheDocument())
    expect(gateway.calls).toContain('POST /author/drafts/d1/check')
  })

  test('a draft never checked offers Check and says so', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES, prechecked: false })
    renderHome()
    expect(await screen.findByRole('button', { name: 'Check' })).toBeInTheDocument()
    expect(screen.getByText('Check Related work — thesis ch.2 to verify every \\cite against its source.', { selector: 'header p' })).toBeInTheDocument()
    // Nothing was judged, so nothing is said to be fine.
    expect(screen.getAllByText('Not checked yet')).toHaveLength(2)
    expect(screen.queryByText('Nothing needs work')).not.toBeInTheDocument()
    expect(screen.queryByText('No open issues')).not.toBeInTheDocument()
  })

  test('Your drafts switches drafts and "+ New draft" creates one on the gateway', async () => {
    const { onSelectDraft, onOpenEditor } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /^Seminar paper \(CPE\)/ }))
    expect(onSelectDraft).toHaveBeenCalledWith('d2')
    expect(screen.getByText('all supported')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ New draft' }))
    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledWith({ draftId: expect.stringMatching(/^draft/), file: 'main.tex', line: 1 }))
    expect(gateway.calls).toContain('POST /author/drafts')
  })

  test('with no drafts the card offers upload, write and add bibliography', async () => {
    gateway = installFakeGateway({})
    const { onOpenEditor } = renderHome(null)
    expect(await screen.findByRole('heading', { name: 'No drafts yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload .tex or .zip' })).toHaveAttribute('data-ask-target', 'action:upload')
    expect(screen.getByRole('button', { name: 'Add bibliography' })).toHaveAttribute('data-ask-target', 'action:add-bibliography')
    expect(screen.queryByRole('button', { name: /Find a source/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Write a draft' }))
    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledWith({ draftId: expect.stringMatching(/^draft/), file: 'main.tex', line: 1 }))
  })

  test('uploading a .tex and adding a .bib go to the gateway', async () => {
    const { onSelectDraft } = renderHome()
    await rowsOf()
    fireEvent.change(screen.getByLabelText('Upload a .tex or .zip file'), { target: { files: [new File(['\\section{A}'], 'chapter.tex')] } })
    await waitFor(() => expect(gateway.calls).toContain('POST /author/drafts/upload'))
    await waitFor(() => expect(onSelectDraft).toHaveBeenCalledWith(expect.stringMatching(/^draft/)))

    fireEvent.change(screen.getByLabelText('Upload a .bib file'), { target: { files: [new File(['@misc{a,title={A}}'], 'more.bib')] } })
    await waitFor(() => expect(gateway.calls).toContain('PUT /author/drafts/d1/files/more.bib'))
  })

  test('a draft that does not exist shows an honest message, and a toast still shows there', async () => {
    renderHome('gone')
    expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Upload a .tex or .zip file'), { target: { files: [new File(['\\section{A}'], 'chapter.tex')] } })
    expect(await screen.findByText(/chapter\.tex uploaded/)).toBeInTheDocument()
  })

  test('a failed check stays said after the refetch, and Retry starts a new one', async () => {
    const check = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!
    check.status = 'error'
    check.message = '<!DOCTYPE html><html><head><title>Bad gateway</title></head></html>'
    renderHome()
    expect(await screen.findByText('The check failed')).toBeInTheDocument()
    expect(screen.getByText('the server sent an error page (Bad gateway)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(gateway.calls).toContain('POST /author/drafts/d1/check'))
  })

  test('a name chosen in Settings greets, first word only, with stray spaces ignored', async () => {
    updateSettings({ displayName: '  Ada Lovelace' })
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: /, Ada$/ })).toBeInTheDocument()
    resetSettings()
  })

  test('with the drafts list down, Add bibliography goes to the draft in the URL, not a new one', async () => {
    gateway.fetch.mockRejectedValueOnce(new Error('the gateway is down'))
    renderHome()
    await screen.findByText('Could not load your drafts')
    fireEvent.change(screen.getByLabelText('Upload a .bib file'), { target: { files: [new File(['@misc{a,title={A}}'], 'more.bib')] } })
    await waitFor(() => expect(gateway.calls).toContain('PUT /author/drafts/d1/files/more.bib'))
    expect(gateway.calls).not.toContain('POST /author/drafts')
  })

  test('a gateway that does not answer shows ErrorState with a Retry that works', async () => {
    gateway.fetch.mockRejectedValueOnce(new Error('the gateway is down'))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your draftsthe gateway is down')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: /^Good/ })).toBeInTheDocument()
  })

  test('a long title and a long note truncate, and the grid can shrink to a phone', async () => {
    gateway.drafts.get('d1')!.title = 'A'.repeat(300)
    const { container } = renderHome()
    const title = await screen.findByRole('heading', { name: new RegExp(`· ${'A'.repeat(300)}`) })
    // jsdom has no layout: the classes are what can be read here; a browser measures the rest.
    expect(title).toHaveClass('truncate')
    expect(title.parentElement).toHaveClass('min-w-0')
    expect(container.querySelector('.grid-cols-\\[minmax\\(0\\,1fr\\)\\]')).not.toBeNull()
    const rows = await rowsOf()
    expect(rows[0].lastElementChild).toHaveClass('truncate')
  })
})

describe('A partly checked draft (#727 rule)', () => {
  test('the bar and legend show what was not judged, never an all-green bar', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: (key) => (key === 'khattab2020' ? { verdict: 'unavailable', reason: 'no-open-access', message: 'no free copy' } : { verdict: 'supports', passage: 'all good', page: 1 }),
    })
    renderHome()
    const bar = await screen.findByRole('img', { name: /supported/ })
    await waitFor(() => expect(bar.getAttribute('aria-label')).toMatch(/[1-9]\d* not checked/))
    expect(bar.getAttribute('aria-label')).toMatch(/[1-9]\d* unavailable/)
    expect(bar.children.length).toBe(3)
    expect(screen.getByText(/[1-9]\d* not checked/, { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByText(/[1-9]\d* unavailable/, { selector: 'li' })).toBeInTheDocument()
  })

  test('a check that judged nothing is not "all supported"', async () => {
    // Every source unreadable (as with ColBERT down), plus the thesis's missing key liu2023.
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: () => ({ verdict: 'unavailable', reason: 'indexing-failed', message: 'the index is down' }),
    })
    renderHome()
    const row = within(await screen.findByRole('list', { name: 'Drafts' })).getAllByRole('button')[0]
    expect(row).toHaveTextContent(/\d+ unavailable · \d+ not checked/)
    expect(row).not.toHaveTextContent('all supported')
    // The rows are there to act on, and nothing says "holds up".
    expect((await rowsOf()).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/couldn't be checked: \d+ sources? unavailable, \d+ keys? missing from the \.bib\./).length).toBeGreaterThan(0)
    expect(screen.queryByText(/holds up/)).not.toBeInTheDocument()
    expect(screen.queryByText('all supported')).not.toBeInTheDocument()
  })
})

describe('While the verdicts are not here', () => {
  test('a last check that fails to load says so, never "Nothing needs work"', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      /\/author\/checks\/check\d+$/.test(String(input)) ? Promise.reject(new Error('checks are down')) : real(input, init),
    )
    renderHome()
    expect(await screen.findByText('Could not load the last check')).toBeInTheDocument()
    expect(screen.getAllByText('Verdicts not loaded')).toHaveLength(2)
    expect(screen.queryByText('Nothing needs work')).not.toBeInTheDocument()
    expect(screen.queryByText('No open issues')).not.toBeInTheDocument()
  })
})

describe('A raw citation message', () => {
  const page = `<!DOCTYPE html><html lang="en"><head><title>Just a moment...</title></head><body>${'<div class="cf">x</div>'.repeat(400)}</body></html>`

  test('a whole error page never reaches the row or the Evidence panel', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: () => ({ verdict: 'unavailable', reason: 'indexing-failed', message: page }),
    })
    const { container } = renderHome()
    const rows = await rowsOf()
    expect(rows[0]).toHaveTextContent('the server sent an error page (Just a moment...)')
    fireEvent.click(rows[0])
    expect(await screen.findByText(/The source could not be read: the server sent an error page/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('<div')
    expect(container.textContent).not.toContain('<!DOCTYPE')
    expect(container.innerHTML).not.toContain('&lt;!DOCTYPE')
  })

  test('a long plain message is cut short', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: () => ({ verdict: 'unavailable', reason: 'x', message: 'y'.repeat(2000) }),
    })
    renderHome()
    const rows = await rowsOf()
    expect(rows[0].textContent).toContain('…')
    expect(rows[0].textContent).not.toContain('y'.repeat(200))
  })
})

describe('Bibliography', () => {
  test('in a project it is the project lint, and a key another draft cites is not "never cited" (#714)', async () => {
    renderHome()
    await waitFor(() => expect(gateway.calls).toContain('GET /author/projects/proj1/lint'))
    expect(gateway.calls).not.toContain('GET /author/drafts/d1/parse')
    await screen.findByText(/across 2 drafts/)
    expect(bibliography().getByText('santhanam2022 defined twice')).toBeInTheDocument()
    expect(bibliography().getByText(/\\cite\{liu2023\} in related-work\.tex L37/)).toBeInTheDocument()
  })

  test('a draft in no project reads its own parse', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES, project: false })
    renderHome()
    await waitFor(() => expect(gateway.calls).toContain('GET /author/drafts/d1/parse'))
    expect(gateway.calls.some((c) => c.endsWith('/lint'))).toBe(false)
    expect(await screen.findByText('5 warnings')).toBeInTheDocument()
  })

  test('warnings and "Fix in editor" open the editor at the file and line', async () => {
    const { onOpenEditor } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /Duplicate key/ }))
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: 'd1', file: expect.stringMatching(/\.bib$/), line: expect.any(Number) })

    fireEvent.click(screen.getByRole('button', { name: 'Fix in editor' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(2)
    expect(onOpenEditor.mock.lastCall?.[0]).toMatchObject({ draftId: 'd1', line: expect.any(Number) })
  })

  test('a lint that fails shows ErrorState in the card and the rest of Home still works', async () => {
    const real = gateway.fetch.getMockImplementation()!
    gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/lint') ? Promise.reject(new Error('500: {"detail":"lint is down"}')) : real(input, init),
    )
    renderHome()
    expect(await screen.findByText('Could not read the bibliography')).toBeInTheDocument()
    expect(screen.getByText('lint is down')).toBeInTheDocument()
    expect((await rowsOf()).length).toBeGreaterThan(0)
  })
})

describe('Bibliography rows', () => {
  test('two missing keys on one line are two rows with no duplicate key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    gateway = installFakeGateway({ files: [{ name: 'a.tex', content: '\\cite{ghost1} and \\cite{ghost2}' }] })
    renderHome()
    expect(await screen.findByText(/\\cite\{ghost1\} in a\.tex L1/)).toBeInTheDocument()
    expect(screen.getByText(/\\cite\{ghost2\} in a\.tex L1/)).toBeInTheDocument()
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
    errors.mockRestore()
  })
})

describe('What the screen agent can see (data-ask-target)', () => {
  test('everything that moved keeps its marker', async () => {
    const { container } = renderHome()
    await rowsOf()
    await screen.findByRole('button', { name: 'Fix in editor' })
    const targets = [...container.querySelectorAll('[data-ask-target]')].map((el) => el.getAttribute('data-ask-target'))
    expect(targets).toEqual(
      expect.arrayContaining(['action:check', 'action:open-editor', 'action:fix-in-editor', 'action:fix-warning-1', 'action:next-issue', 'action:upload-pdf', 'action:override', 'action:new-draft', 'draft:d1', 'draft:d2']),
    )
    expect(targets.some((t) => t?.startsWith('citation:'))).toBe(true)
  })
})
