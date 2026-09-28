import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const view = renderWithQuery(<Editor target={target} onFileChange={onFileChange} onNavigate={onNavigate} />)
  return { ...view, onFileChange, onNavigate }
}

/** Types into the open file the way a keystroke does: through CodeMirror, so the editor's own
 * change handling runs (the debounced write, the dirty state). */
function type(text: string, at = 0) {
  const cm = document.querySelector('.cm-editor') as HTMLElement
  const view = EditorView.findFromDOM(cm)!
  act(() => view.dispatch({ changes: { from: at, insert: text } }))
}

const source = () => screen.getByLabelText('related-work.tex source').textContent ?? ''
const stored = () => gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!.content
/** The PUTs of the chapter so far. */
const writes = () => gateway.calls.filter((c) => c === 'PUT /author/drafts/d1/files/related-work.tex').length

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
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saved')
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

  test('the top bar navigates (no Find a source tab), Re-check starts a run, and Ctrl+S saves a new version', async () => {
    const { onNavigate } = renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('home')
    expect(screen.queryByRole('button', { name: 'Find a source' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onNavigate).toHaveBeenCalledWith('history')

    const before = gateway.checks.size
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(gateway.checks.size).toBe(before + 1))
    expect(gateway.calls).toContain('POST /author/drafts/d1/check')

    const editor = screen.getByLabelText('related-work.tex source')
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v4 · saved'))
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

describe('Author LaTeX editor — saving', () => {
  test('typing writes the file after a pause; the status goes saving… then saved and the tab dot comes and goes', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const before = writes()

    type('% typed\n')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saving…')
    expect(within(screen.getByRole('tab', { name: /related-work\.tex/ })).getByLabelText('unsaved changes')).toBeInTheDocument()

    await waitFor(() => expect(writes()).toBe(before + 1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saved'))
    expect(stored().startsWith('% typed\n')).toBe(true)
    expect(gateway.drafts.get('d1')!.version).toBe(3) // typing never makes a version
    expect(within(screen.getByRole('tab', { name: /related-work\.tex/ })).queryByLabelText('unsaved changes')).toBeNull()
  })

  test('leaving the editor before the pause still writes what was typed', async () => {
    const { unmount } = renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    type('% leaving\n')
    unmount()
    await waitFor(() => expect(stored().startsWith('% leaving\n')).toBe(true))
  })

  test('a refused write keeps the text on screen, says not saved, and Retry sends it again; Ctrl+S does not make a version until it lands', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()

    gateway.failWrites = true
    type('% offline\n')
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('Could not save related-work.tex: the gateway is down')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · not saved')
    expect(stored()).toBe(original)

    // a refetch of the draft (a check landing, the window focused) does not put the old text back
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('not saved'))
    expect(source()).toContain('% offline')
    expect(gateway.calls).not.toContain('POST /author/drafts/d1/check')

    // Ctrl+S: no version while the gateway does not hold the text
    fireEvent.keyDown(screen.getByLabelText('related-work.tex source'), { key: 's', ctrlKey: true })
    expect(await screen.findByText(/Not saved: the gateway refused the last edit/)).toBeInTheDocument()
    expect(gateway.calls).not.toContain('POST /author/drafts/d1/save')
    expect(gateway.drafts.get('d1')!.version).toBe(3)

    gateway.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(stored().startsWith('% offline\n')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saved'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(source()).toContain('% offline')

    fireEvent.keyDown(screen.getByLabelText('related-work.tex source'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
  })

  test('an edit made while a write is in flight waits for its answer: the gateway applies the two in order, neither is refused, and the newest text is what it holds', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const before = writes()
    const putBodies = () =>
      gateway.fetch.mock.calls
        .filter(([url, init]) => String(url).endsWith('/files/related-work.tex') && (init as RequestInit)?.method === 'PUT')
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { content: string; updated?: string })

    // hold the first write's reply
    let releaseFirst: (() => void) | null = null
    let held = 0
    let updatedAfterFirst = ''
    gateway.beforeWrite = (_name, content) => {
      if (content.startsWith('% one') && !content.startsWith('% one\n% two')) {
        held += 1
        return new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      updatedAfterFirst = gateway.drafts.get('d1')!.updated
      return Promise.resolve()
    }
    type('% one\n')
    await waitFor(() => expect(held).toBe(1), { timeout: 3000 })
    type('% two\n', '% one\n'.length)
    // past the pause, the second write has not gone out: one PUT of this file is in flight
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(writes()).toBe(before + 1)
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saving…')

    releaseFirst!()
    await waitFor(() => expect(writes()).toBe(before + 2), { timeout: 3000 })
    await waitFor(() => expect(stored().startsWith('% one\n% two\n')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saved'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(source()).toContain('% one% two') // CodeMirror's textContent has no line breaks

    // each write carried the draft's `updated` the editor last saw: the second, the first's answer
    const bodies = putBodies().slice(-2)
    expect(bodies.map((b) => b.content.startsWith('% one\n% two'))).toEqual([false, true])
    expect(bodies.map((b) => typeof b.updated)).toEqual(['string', 'string'])
    expect(bodies[1].updated).toBe(updatedAfterFirst)
  })

  test('a write from an editor another tab has overtaken is refused: the text stays, the error names it, and Retry overwrites', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()
    const reads = () => gateway.calls.filter((c) => c === 'GET /author/drafts/d1').length
    const readsBefore = reads()

    // another tab saves the file: the draft's `updated` moves on without this editor seeing it
    const draft = gateway.drafts.get('d1')!
    draft.files.find((f) => f.name === 'related-work.tex')!.content = `% from another tab\n${original}`
    draft.updated = new Date(Date.now() + 60_000).toISOString()

    type('% here\n')
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('related-work.tex was changed elsewhere (another tab?) since this editor last saved it.')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · not saved')
    expect(stored().startsWith('% from another tab\n')).toBe(true) // nothing was overwritten
    expect(source()).toContain('% here') // and the author's text is still on screen
    expect(source()).not.toContain('% from another tab')
    // the draft was read again, so the editor now knows the gateway's `updated`
    await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(stored().startsWith('% here\n')).toBe(true), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · saved'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('switching drafts keeps each draft its own text', async () => {
    const { rerender } = renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    type('% first draft\n')
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Editor key="d2" target={{ draftId: 'd2' }} onFileChange={() => undefined} onNavigate={() => undefined} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText('seminar.tex source').textContent).toContain('\\section{Seminar}'))
    expect(screen.getByLabelText('seminar.tex source').textContent).not.toContain('% first draft')
    await waitFor(() => expect(stored().startsWith('% first draft\n')).toBe(true))
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
