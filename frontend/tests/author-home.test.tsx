/**
 * Author Home (Redesign A1) against the fake gateway (tests/fakeAuthorGateway.ts): the counts and
 * warnings come from the seeded thesis chapter, and every action ends in the request the real
 * gateway would get. What the screen changed is still there after it unmounts and mounts again, as
 * after a page refresh. New project ▾ lives in the shell's toolbar: see author-app.test.tsx.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { centreInView } from '../src/lib/centreInView'
import { resetSettings, updateSettings } from '../src/lib/settings'
import { AuthorApp } from '../src/roles/author/AuthorApp'
import { Home } from '../src/roles/author/screens/Home'
import { Toaster } from '../src/components/Toaster'
import { DEFAULT_VERDICTS, installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway
let queryClient: QueryClient

function renderWithQuery(ui: ReactNode) {
  return render(<QueryClientProvider client={queryClient}><Toaster />{ui}</QueryClientProvider>)
}

function renderHome(draftId: string | null = 'd1') {
  const onSelectDraft = vi.fn()
  const onOpenEditor = vi.fn()
  const onOpenHistory = vi.fn()
  const view = renderWithQuery(<Home draftId={draftId} onSelectDraft={onSelectDraft} onOpenEditor={onOpenEditor} onOpenHistory={onOpenHistory} />)
  return { ...view, onSelectDraft, onOpenEditor, onOpenHistory }
}

/** Every citation row on the card: the issues' list, and the "couldn't be checked" one while open. */
const rowsOf = async () => {
  const lists = await screen.findAllByRole('list', { name: /^Citations/ })
  return lists.flatMap((list) => within(list).getAllByRole('button'))
}
const unreadToggle = () => screen.getByRole('button', { name: /couldn’t be checked$/ })
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
    // What could not be judged waits, folded, under the issues.
    expect(rows).toHaveLength(3)
    expect(unreadToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(unreadToggle()).toHaveTextContent('3 couldn’t be checked')
    fireEvent.click(unreadToggle())
    expect(unreadToggle()).toHaveAttribute('aria-expanded', 'true')
    const all = await rowsOf()
    expect(all.some((row) => row.textContent?.includes('missing bib key'))).toBe(true)
    // The badge says what the legend counts: an unreadable source is not "not checked".
    expect(all.find((row) => row.textContent?.includes('nguyen2016'))).toHaveTextContent('Source unavailable')
    expect(all.find((row) => row.textContent?.includes('liu2023'))).toHaveTextContent('Not checked')
  })

  test('"Needs work" puts the worst first: Source contradicts, then Source is silent, then what was not read', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      // robertson2009 comes first in the draft, but a silent source is less bad than a contradiction.
      verdictFor: (key, claim) => (key === 'robertson2009' ? { verdict: 'insufficient', passage: '' } : DEFAULT_VERDICTS(key, claim)),
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Citations that need work' })
    fireEvent.click(await waitFor(unreadToggle))
    // The Evidence pager walks the same order: issue 1 is the top row, not the first in the draft.
    expect(await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 of 4 issues/ })).toBeInTheDocument()
    const badges = (await rowsOf()).map((row) => row.querySelector('[data-verdict]')?.textContent)
    expect(badges).toEqual(['Source contradicts', 'Source contradicts', 'Source is silent', 'Source is silent', 'Source unavailable', 'Not checked', 'Not checked'])
  })

  test('a reference no index knows reads "Not found" in the refutes tone, and is still not an issue', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: (key, claim) => (key === 'nguyen2016' ? { verdict: 'unavailable', reason: 'no-open-access', message: 'no free copy', exists: 'no' } : DEFAULT_VERDICTS(key, claim)),
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Citations that need work' })
    // It may be made up, so it is never folded away: it sits right after the contradictions, above
    // the silent sources, and the count names it, though it is still not counted as an issue.
    expect(await waitFor(unreadToggle)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/^3 issues · 1 not found · \d+ not checked$/)).toBeInTheDocument()
    const top = within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')
    expect(top.map((r) => r.querySelector('[data-verdict]')?.textContent)).toEqual(['Source contradicts', 'Source contradicts', 'Not found', 'Source is silent'])
    const row = top.find((r) => r.textContent?.includes('nguyen2016'))!
    expect(row.querySelector('[data-verdict]')).toHaveAttribute('data-verdict', 'refutes')
    expect(row.querySelector('[data-verdict]')).toHaveTextContent('Not found')
    expect(row).toHaveTextContent('check that it exists')
    expect(screen.getByRole('button', { name: /1 of 3 issues/ })).toBeInTheDocument()
    // Its fix is in the draft (the DOI, or the \cite): Edit leads, with no PDF to upload and no
    // verdict to override, and the panel gives no author and year to a work no index knows.
    fireEvent.click(row)
    const evidence = within(await screen.findByRole('region', { name: 'Evidence · \\cite{nguyen2016}' }))
    expect(evidence.getByText('Not found')).toBeInTheDocument()
    expect(evidence.getByRole('button', { name: /^Edit at L\d+$/ })).toHaveClass('bg-accent')
    expect(evidence.queryByRole('button', { name: /Override/ })).not.toBeInTheDocument()
    expect(evidence.queryByRole('button', { name: /Upload source PDF/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Evidence for \\cite\{nguyen2016\}, line \d+: Not found\.$/)).toBeInTheDocument()
  })

  test('the Evidence panel names the verdict, and the cards are named regions', async () => {
    renderHome()
    const evidence = within(await screen.findByRole('region', { name: 'Evidence · Khattab & Zaharia, 2020' }))
    expect(evidence.getByText('Source contradicts')).toBeInTheDocument()
    expect(evidence.getByText('\\cite{khattab2020}')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Citations that need work' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your drafts' })).toBeInTheDocument()
  })

  test('picking another row while its paper is open brings the evidence back, never the old paper', async () => {
    // The viewer reads the window's width and size, which jsdom lacks (as in analysis-page-viewer).
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    renderHome()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    fireEvent.click(screen.getByRole('button', { name: 'show in the paper' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Evidence/ })).not.toBeInTheDocument())
    fireEvent.click((await rowsOf()).find((row) => row.textContent?.includes('thakur2021'))!)
    expect(await screen.findByRole('region', { name: /^Evidence · / })).toHaveTextContent('\\cite{thakur2021}')
  })

  test('a source the publisher refused says so in plain words, not the raw HTTP error', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: (key, claim) =>
        key === 'nguyen2016'
          ? { verdict: 'unavailable', reason: 'failed', message: '403 Client Error: Forbidden for url: https://lekythos.library.example/pdf/123?token=abc' }
          : DEFAULT_VERDICTS(key, claim),
    })
    const { container } = renderHome()
    await screen.findByRole('heading', { name: 'Citations that need work' })
    fireEvent.click(await waitFor(unreadToggle))
    const row = (await rowsOf()).find((r) => r.textContent?.includes('nguyen2016'))!
    expect(row).toHaveTextContent('HTTP 403: lekythos.library.example refused the download')
    expect(container.textContent).not.toContain('Client Error')
  })

  test('the card says what it counts: its issues are the pager’s and Your drafts’ number, the rest are named', async () => {
    renderHome()
    const card = within((await screen.findByRole('heading', { name: 'Citations that need work' })).closest('.rounded-2xl') as HTMLElement)
    const label = await card.findByText(/^\d+ issues?/)
    expect(label).toHaveTextContent(/^3 issues/)
    expect(label).toHaveTextContent(/\d+ not checked$/)
    // Every row on the card is in the label, once the folded ones are open.
    const counted = (label.textContent ?? '').split(' · ').reduce((sum, part) => sum + Number(part.split(' ')[0]), 0)
    fireEvent.click(unreadToggle())
    expect(await rowsOf()).toHaveLength(counted)
    expect(screen.getByRole('button', { name: /1 of 3 issues/ })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Drafts' })).getAllByRole('button').some((row) => row.textContent?.includes('3 issues'))).toBe(true)

    fireEvent.click(card.getByRole('button', { name: 'All' }))
    expect(await card.findByText('8 citations')).toBeInTheDocument()
  })

  test('a row or the pager brings the Evidence panel to the middle of the screen, showing that citation (#721)', async () => {
    const calls: { panel: string | null; options: ScrollIntoViewOptions }[] = []
    const scroll = vi.fn(function (this: Element, options: ScrollIntoViewOptions) {
      calls.push({ panel: this.querySelector('h2, h3')?.textContent ?? null, options })
    })
    Element.prototype.scrollIntoView = scroll as unknown as Element['scrollIntoView']
    try {
      renderHome()
      await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
      expect(scroll).not.toHaveBeenCalled() // opening Home does not jump

      const rows = await rowsOf()
      fireEvent.click(rows.find((row) => !row.textContent?.includes('khattab2020'))!)
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
      // after the panel shows the row's citation, so its new height is the one centred
      expect(calls[0].panel).toMatch(/^Evidence · /)
      expect(calls[0].panel).not.toBe('Evidence · Khattab & Zaharia, 2020')
      expect(calls[0].options).toEqual({ block: 'center', behavior: 'smooth' })

      fireEvent.click(screen.getByRole('button', { name: /of 3 issues/ }))
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2))

      // reduced motion: no smooth scroll
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
      fireEvent.click(rows[0])
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(3))
      expect(calls[2].options).toEqual({ block: 'center', behavior: 'auto' })
    } finally {
      Element.prototype.scrollIntoView = () => undefined
    }
  })

  test('a panel taller than the screen goes to the top instead, so its start is not cut off', () => {
    const element = document.createElement('div')
    const scroll = vi.fn()
    element.scrollIntoView = scroll
    element.getBoundingClientRect = () => ({ height: window.innerHeight + 1 }) as DOMRect
    centreInView(element)
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    element.getBoundingClientRect = () => ({ height: 100 }) as DOMRect
    centreInView(element)
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ block: 'center' }))
  })

  test('nothing to centre does nothing: no element yet, or one that cannot scroll', () => {
    expect(() => centreInView(null)).not.toThrow()
    const element = document.createElement('div')
    Object.defineProperty(element, 'scrollIntoView', { value: undefined })
    const measured = vi.spyOn(element, 'getBoundingClientRect')
    centreInView(element)
    expect(measured).not.toHaveBeenCalled()
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

  test('Edit at the line opens the editor on the citation’s file and line, first among the actions', async () => {
    const { onOpenEditor } = renderHome()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    const edit = screen.getByRole('button', { name: /^Edit at L\d+$/ })
    const line = Number(edit.textContent?.match(/L(\d+)/)?.[1])
    fireEvent.click(edit)
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: 'd1', file: 'related-work.tex', line })
    expect(line).toBeGreaterThan(0)
  })

  test('the "couldn’t be checked" group stays in the page while closed, so its toggle points at a real list', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Citations that need work' })
    const toggle = await waitFor(unreadToggle)
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(list).toHaveAttribute('hidden')
    fireEvent.click(toggle)
    expect(list).not.toHaveAttribute('hidden')
    fireEvent.click(toggle)
    expect(list).toHaveAttribute('hidden')
  })

  test('for a citation with no answer, Upload source PDF leads and Edit steps back', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Citations that need work' })
    fireEvent.click(await waitFor(unreadToggle))
    fireEvent.click((await rowsOf()).find((row) => row.textContent?.includes('nguyen2016'))!)
    const upload = await screen.findByRole('button', { name: /Upload source PDF/ })
    const edit = screen.getByRole('button', { name: /^Edit at L\d+$/ })
    expect(upload).toHaveClass('bg-accent')
    expect(edit).not.toHaveClass('bg-accent')
  })

  test('a passage read from a preprint keeps Upload source PDF: the published paper might differ', async () => {
    gateway = installFakeGateway({
      files: THESIS_FILES,
      verdictFor: (key, claim) => (key === 'khattab2020' ? { ...DEFAULT_VERDICTS(key, claim), sourceVersion: 'preprint' } : DEFAULT_VERDICTS(key, claim)),
    })
    renderHome()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    expect(screen.getByRole('button', { name: /Upload source PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Edit at L\d+$/ })).toHaveClass('bg-accent')
  })

  test('Upload source PDF only shows where no passage was read, and attaches the file to that citation’s key', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Evidence · Khattab & Zaharia, 2020' })
    // The check quoted the paper: a PDF upload would not change the verdict.
    expect(screen.queryByRole('button', { name: /Upload source PDF/ })).not.toBeInTheDocument()
    fireEvent.click(unreadToggle())
    fireEvent.click((await rowsOf()).find((row) => row.textContent?.includes('nguyen2016'))!)
    expect(await screen.findByRole('button', { name: /Upload source PDF/ })).toBeInTheDocument()
    const input = document.querySelector('input[accept="application/pdf,.pdf"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'msmarco.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(gateway.calls).toContain('POST /author/drafts/d1/citations/nguyen2016/pdf'))
    expect(await screen.findByText('msmarco.pdf attached to \\cite{nguyen2016}. Re-check to read it.')).toBeInTheDocument()
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

  test('a row in Your drafts opens that draft in the editor, the one already selected too', async () => {
    const { onSelectDraft, onOpenEditor } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /^Seminar paper \(CPE\)/ }))
    expect(onOpenEditor).toHaveBeenLastCalledWith({ draftId: 'd2' })
    fireEvent.click(screen.getByRole('button', { name: /^Related work — thesis ch\.2/ }))
    expect(onOpenEditor).toHaveBeenLastCalledWith({ draftId: 'd1' })
    expect(onSelectDraft).not.toHaveBeenCalled()
  })

  test('"+ New draft" creates one on the gateway and opens it', async () => {
    const { onOpenEditor } = renderHome()
    fireEvent.click(await screen.findByRole('button', { name: '+ New draft' }))
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

describe('Opening a draft, in the whole Author role', () => {
  // CodeMirror measures text with Range geometry that jsdom does not implement.
  beforeAll(() => {
    const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
    Range.prototype.getBoundingClientRect = () => rect as DOMRect
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
    Element.prototype.scrollIntoView = () => undefined
  })
  afterEach(() => window.history.replaceState(null, '', window.location.pathname))

  function renderApp(search: string) {
    window.history.replaceState(null, '', search)
    renderWithQuery(<AuthorApp />)
  }
  const inEditorOn = async (draftId: string, title: string) => {
    expect(await screen.findByRole('button', { name: `Draft title: ${title}. Rename` })).toBeInTheDocument()
    const params = new URLSearchParams(window.location.search)
    expect(params.get('screen')).toBe('editor')
    expect(params.get('draft')).toBe(draftId)
  }
  const SEMINAR = 'Seminar paper (CPE)'
  const THESIS = 'Related work — thesis ch.2'

  test('a row in Your drafts opens the editor on that draft, and Home agrees on it afterwards', async () => {
    renderApp('?screen=home&draft=d1')
    fireEvent.click(await screen.findByRole('button', { name: /^Seminar paper \(CPE\)/ }))
    await inEditorOn('d2', SEMINAR)

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Home' }))
    expect(await screen.findByRole('heading', { name: `${THESIS} · ${SEMINAR}` })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('draft')).toBe('d2')
  })

  test('the row of the draft Home already shows opens the editor too', async () => {
    renderApp('?screen=home&draft=d1')
    // Scoped: the sidebar's Recent projects has a project of the same name.
    fireEvent.click(within(await screen.findByRole('list', { name: 'Drafts' })).getByRole('button', { name: /^Related work — thesis ch\.2/ }))
    await inEditorOn('d1', THESIS)
  })

  test('a project’s "Open draft" opens the draft selected in its list in the editor', async () => {
    renderApp('?screen=library&project=proj1')
    fireEvent.click(await screen.findByRole('button', { name: /^Seminar paper \(CPE\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open draft' }))
    await inEditorOn('d2', SEMINAR)
  })

  test('a double-click on a project’s draft opens it in the editor; one click only selects it', async () => {
    renderApp('?screen=library&project=proj1')
    const row = await screen.findByRole('button', { name: /^Seminar paper \(CPE\)/ })
    fireEvent.click(row)
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('library')
    fireEvent.doubleClick(row)
    await inEditorOn('d2', SEMINAR)
  })

  test('"Open draft" on a Library attention row opens the editor on that draft', async () => {
    renderApp('?screen=library')
    fireEvent.click(await screen.findByRole('button', { name: 'Open draft' }))
    await inEditorOn('d1', THESIS)
    const cited = [...gateway.checks.values()].find((c) => c.draftId === 'd1')!.citations.find((c) => c.verdict === 'refutes')!
    const params = new URLSearchParams(window.location.search)
    expect(params.get('file')).toBe(cited.file)
    expect(params.get('line')).toBe(String(cited.line))
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
      expect.arrayContaining(['action:check', 'action:open-editor', 'action:fix-in-editor', 'action:fix-warning-1', 'action:next-issue', 'action:edit-at-line', 'action:override', 'action:new-draft', 'draft:d1', 'draft:d2']),
    )
    expect(targets.some((t) => t?.startsWith('citation:'))).toBe(true)
  })
})
