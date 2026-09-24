import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { setMockLatency } from '../src/lib/author'
import { authorStore } from '../src/lib/authorStore'
import { DraftCheck } from '../src/roles/author/screens/DraftCheck'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderDraftCheck(draftId = 'd1') {
  const onSelectDraft = vi.fn()
  const onOpenEditor = vi.fn()
  const onOpenHistory = vi.fn()
  renderWithQuery(
    <DraftCheck draftId={draftId} onSelectDraft={onSelectDraft} onOpenEditor={onOpenEditor} onOpenHistory={onOpenHistory} />,
  )
  return { onSelectDraft, onOpenEditor, onOpenHistory }
}

beforeEach(() => {
  setMockLatency(0)
  authorStore.reset()
  window.history.replaceState(null, '', '/')
})

describe('Author Draft check', () => {
  test('shows the header counts, the derived warnings and the three open issues', async () => {
    renderDraftCheck()
    expect(await screen.findByRole('heading', { name: 'Check a draft' })).toBeInTheDocument()
    expect(screen.getByText(/12 citations found · 3 need work/)).toBeInTheDocument()

    expect(await screen.findByText('4 warnings')).toBeInTheDocument()
    expect(screen.getByText('\\cite{liu2023} in intro.tex L18')).toBeInTheDocument()

    const rows = within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('source contradicts')
    expect(rows[0]).toHaveTextContent('\\cite{khattab2020} · 0.88 confidence')
    expect(screen.getByText('9 supported')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 of 3 issues/ })).toBeInTheDocument()
  })

  test('"Replace with …" rewrites the source, resolves the issue and moves the pager on', async () => {
    renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Replace with Santhanam 2022/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Citation replaced with Santhanam 2022')
    await waitFor(() => expect(screen.getByText(/2 need work/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /1 of 2 issues/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence · Thakur et al., 2021' })).toBeInTheDocument()

    const related = authorStore.draft('d1')!.files.find((f) => f.name === 'related-work.tex')!
    expect(related.content.split('\n')[9]).toContain('\\cite{santhanam2022}')
  })

  test('the pager cycles through open issues and "All" lists every citation', async () => {
    renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /1 of 3 issues/ }))
    expect(screen.getByRole('button', { name: /2 of 3 issues/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence · Thakur et al., 2021' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')).toHaveLength(13)

    fireEvent.click(screen.getByRole('button', { name: 'Low confidence' }))
    const low = within(screen.getByRole('list', { name: 'Citations' })).getAllByRole('button')
    expect(low).toHaveLength(1)
    expect(low[0]).toHaveTextContent('thakur2021')
  })

  test('"Override · add note" keeps the citation with a note and advances', async () => {
    renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Override · add note/ }))
    fireEvent.change(screen.getByLabelText('Why you are keeping this citation'), { target: { value: 'Table 3 says so' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(screen.getByText(/2 need work/)).toBeInTheDocument())
    expect(authorStore.citations('d1').find((c) => c.id === 'c10')?.resolution?.note).toBe('Table 3 says so')
  })

  test('warnings and "Fix in editor" open the editor at the file and line', async () => {
    const { onOpenEditor } = renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Duplicate key/ }))
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: 'd1', file: 'main.bib', line: expect.any(Number) })

    fireEvent.click(screen.getByRole('button', { name: 'Fix in editor' }))
    expect(onOpenEditor).toHaveBeenLastCalledWith({ draftId: 'd1', file: 'intro.tex', line: 18 })
  })

  test('Find sources lists the suggested fix first and inserting it replaces the selected issue', async () => {
    renderDraftCheck()
    expect(await screen.findByText(/Suggested fix for issue 1 · similarity 0.91/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert \\cite' })[0])
    await waitFor(() => expect(screen.getByText(/2 need work/)).toBeInTheDocument())
  })

  test('Your drafts switches drafts and starts a new one in the editor', async () => {
    const { onSelectDraft, onOpenEditor } = renderDraftCheck()
    fireEvent.click(await screen.findByRole('button', { name: /Seminar paper \(CPE\)/ }))
    expect(onSelectDraft).toHaveBeenCalledWith('d2')
    expect(screen.getByText('all supported')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ New draft' }))
    expect(onOpenEditor).toHaveBeenCalledWith({ draftId: expect.stringMatching(/^draft-/), file: 'main.tex', line: 1 })
  })

  test('a draft that does not exist shows the empty state, not a crash', async () => {
    renderDraftCheck('gone')
    expect(await screen.findByText('This draft no longer exists')).toBeInTheDocument()
  })
})
