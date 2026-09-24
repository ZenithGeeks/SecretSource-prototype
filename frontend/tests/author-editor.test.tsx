import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { setMockLatency } from '../src/lib/author'
import { authorStore } from '../src/lib/authorStore'
import { Editor } from '../src/roles/author/screens/Editor'
import { SplitPane } from '../src/roles/author/components/editor/SplitPane'

// CodeMirror measures text with Range geometry that jsdom does not implement.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
  Element.prototype.scrollIntoView = () => undefined
})

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderEditor(target = { draftId: 'd1', file: 'related-work.tex', line: 10 }) {
  const onFileChange = vi.fn()
  const onNavigate = vi.fn()
  const onSearch = vi.fn()
  renderWithQuery(<Editor target={target} onFileChange={onFileChange} onNavigate={onNavigate} onSearch={onSearch} />)
  return { onFileChange, onNavigate, onSearch }
}

beforeEach(() => {
  setMockLatency(0)
  authorStore.reset()
  vi.useRealTimers()
})

describe('Author LaTeX editor', () => {
  test('opens the target file with its source, tabs, verdict marks and per-file status', async () => {
    renderEditor()
    expect(await screen.findByRole('tab', { name: /related-work\.tex/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(4)

    const editor = screen.getByLabelText('related-work.tex source')
    await waitFor(() => expect(editor.textContent).toContain('\\section{Related work}'))

    // 5 \cite on this file: 2 supported, 1 partial, 1 not supported, 1 unavailable.
    expect(screen.getByText('2 supported')).toBeInTheDocument()
    expect(screen.getByText('1 not supported')).toBeInTheDocument()
    expect(screen.getByText(/5 \\cite · 0 warnings/)).toBeInTheDocument()

    await waitFor(() => expect(document.querySelectorAll('.cm-verdict-dot').length).toBeGreaterThanOrEqual(5))
    expect(document.querySelector('.cm-cite-refutes')?.textContent).toBe('khattab2020')
    expect(document.querySelectorAll('.cm-line-refutes').length).toBe(2)

    expect(screen.getByText('Related work — thesis ch.2')).toBeInTheDocument()
    expect(screen.getByText('v3 · saved')).toBeInTheDocument()
  })

  test('switching tabs shows that file, reports it, and "+ file" adds one', async () => {
    const { onFileChange } = renderEditor()
    fireEvent.click(await screen.findByRole('tab', { name: /intro\.tex/ }))
    expect(onFileChange).toHaveBeenCalledWith('intro.tex')
    await waitFor(() => expect(screen.getByLabelText('intro.tex source').textContent).toContain('\\section{Introduction}'))
    expect(screen.getByText(/6 \\cite · 1 warning$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ file' }))
    fireEvent.change(screen.getByLabelText('New file name'), { target: { value: 'methods' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('tab', { name: /methods\.tex/ })).toHaveAttribute('aria-selected', 'true')
    expect(authorStore.draft('d1')!.files.some((f) => f.name === 'methods.tex')).toBe(true)
  })

  test('the top bar navigates and Re-check runs', async () => {
    const { onNavigate } = renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('draft-check')
    fireEvent.click(screen.getByRole('button', { name: 'Find a source' }))
    expect(onNavigate).toHaveBeenCalledWith('find-source')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onNavigate).toHaveBeenCalledWith('history')

    const before = authorStore.draft('d1')!.lastCheckedAt
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(authorStore.draft('d1')!.lastCheckedAt).not.toBe(before))
  })

  test('a replacement made in the store shows up in the open file', async () => {
    renderEditor()
    const editor = await screen.findByLabelText('related-work.tex source')
    await waitFor(() => expect(editor.textContent).toContain('\\cite{khattab2020}'))

    const run = authorStore.checkRun('d1')!
    const issue = run.issues[0]
    authorStore.replaceCitation(issue.id, issue.suggestedReplacement!)
    // The query refetches on the next re-check; drive it the way Draft check does.
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(editor.textContent).toContain('quality~\\cite{santhanam2022}'))
    await waitFor(() => expect(screen.getByText('3 supported')).toBeInTheDocument())
  })

  test('a draft that does not exist offers the way back', async () => {
    const { onNavigate } = renderEditor({ draftId: 'gone', file: undefined, line: undefined } as never)
    expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('draft-check')
  })
})

describe('SplitPane', () => {
  test('the handle is a keyboard separator', () => {
    render(<SplitPane left={<p>left</p>} right={<p>right</p>} leftLabel="Source" rightLabel="Preview" />)
    const handle = screen.getByRole('separator', { name: /Resize/ })
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '55')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '75')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handle).toHaveAttribute('aria-valuenow', '25')
    expect(within(screen.getByRole('region', { name: 'Source' })).getByText('left')).toBeInTheDocument()
  })
})
