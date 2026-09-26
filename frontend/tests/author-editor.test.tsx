import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { Editor } from '../src/roles/author/screens/Editor'
import { SplitPane } from '../src/roles/author/components/editor/SplitPane'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

// Login off, as on a gateway without Supabase: the client sends no token and asks for no session.
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

// CodeMirror measures text with Range geometry that jsdom does not implement.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
  Element.prototype.scrollIntoView = () => undefined
})

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderEditor(target = { draftId: 'd1', file: 'related-work.tex', line: 10 }) {
  const onFileChange = vi.fn()
  const onNavigate = vi.fn()
  const onSearch = vi.fn()
  const onFindReplacement = vi.fn()
  renderWithQuery(<Editor target={target} onFileChange={onFileChange} onNavigate={onNavigate} onSearch={onSearch} onFindReplacement={onFindReplacement} />)
  return { onFileChange, onNavigate, onSearch, onFindReplacement }
}

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
})

afterEach(() => vi.unstubAllGlobals())

describe('Author LaTeX editor', () => {
  test('opens the target file with its source, tabs, verdict marks and per-file status', async () => {
    renderEditor()
    expect(await screen.findByRole('tab', { name: /related-work\.tex/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    const editor = screen.getByLabelText('related-work.tex source')
    await waitFor(() => expect(editor.textContent).toContain('\\section{Related work}'))

    // 7 \cite on this file: 2 supported, 1 partial, 2 not supported, 1 unavailable, 1 missing.
    await waitFor(() => expect(screen.getByText('2 supported')).toBeInTheDocument())
    expect(screen.getByText('2 not supported')).toBeInTheDocument()
    expect(screen.getByText(/7 \\cite · 1 warning$/)).toBeInTheDocument()

    // jsdom has no layout, so CodeMirror only draws the first lines of the viewport.
    await waitFor(() => expect(document.querySelectorAll('.cm-verdict-dot').length).toBeGreaterThanOrEqual(1))
    await waitFor(() => expect(document.querySelector('.cm-cite-refutes')?.textContent).toBe('khattab2020'))

    expect(screen.getByText('Related work — thesis ch.2')).toBeInTheDocument()
    expect(screen.getByText('v3 · saved')).toBeInTheDocument()
  })

  test('switching tabs shows that file and reports it; "+ file" adds one on the gateway', async () => {
    const { onFileChange } = renderEditor()
    fireEvent.click(await screen.findByRole('tab', { name: /intro\.tex/ }))
    expect(onFileChange).toHaveBeenCalledWith('intro.tex')
    await waitFor(() => expect(screen.getByLabelText('intro.tex source').textContent).toContain('\\section{Introduction}'))
    expect(screen.getByText(/1 \\cite · 1 warning$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ file' }))
    fireEvent.change(screen.getByLabelText('New file name'), { target: { value: 'methods' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('tab', { name: /methods\.tex/ })).toHaveAttribute('aria-selected', 'true')
    expect(gateway.calls).toContain('PUT /author/drafts/d1/files/methods.tex')
    expect(gateway.drafts.get('d1')!.files.some((f) => f.name === 'methods.tex')).toBe(true)
  })

  test('the top bar navigates, Re-check starts a run, and Ctrl+S saves a new version', async () => {
    const { onNavigate } = renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('home')
    fireEvent.click(screen.getByRole('button', { name: 'Find a source' }))
    expect(onNavigate).toHaveBeenCalledWith('find-source')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onNavigate).toHaveBeenCalledWith('history')

    const before = gateway.checks.size
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(gateway.checks.size).toBe(before + 1))
    expect(gateway.calls).toContain('POST /author/drafts/d1/check')

    const editor = screen.getByLabelText('related-work.tex source')
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
    expect(await screen.findByText('v4 · saved')).toBeInTheDocument()
  })

  test('a change made on the gateway (a replacement elsewhere) shows up in the open file', async () => {
    renderEditor()
    const editor = await screen.findByLabelText('related-work.tex source')
    await waitFor(() => expect(editor.textContent).toContain('\\cite{khattab2020}'))

    const related = gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!
    related.content = related.content.replace('matching retrieval quality~\\cite{khattab2020}', 'matching retrieval quality~\\cite{santhanam2022}')
    // The query refetches on the next re-check; drive it the way Draft check does.
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(editor.textContent).toContain('quality~\\cite{santhanam2022}'))
    await waitFor(() => expect(screen.getByText('3 supported')).toBeInTheDocument())
  })

  test('a draft that does not exist offers the way back', async () => {
    const { onNavigate } = renderEditor({ draftId: 'gone', file: undefined, line: undefined } as never)
    expect(await screen.findByText('This draft no longer exists.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('home')
  })

  test('the Export menu builds the .bib from the real files and asks the gateway for the report', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[1])
    expect(await screen.findByRole('status')).toHaveTextContent('Downloaded related-work-thesis-ch-2.bib')

    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    await waitFor(() => expect(gateway.calls).toContain('POST /author/drafts/d1/report'))
    expect(await screen.findByRole('status')).toHaveTextContent('Downloaded the verification report')
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
