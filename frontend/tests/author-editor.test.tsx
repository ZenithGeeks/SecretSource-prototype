import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { runTool, type DraftReader } from '../src/lib/agentTools'
import { Editor } from '../src/roles/author/screens/Editor'
import { SplitPane } from '../src/components/SplitPane'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { PAPER_TEX } from './fixtures/paper'
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
  // The write logic, not the 2 s pause, is under test here; the pause has its own test.
  const view = renderWithQuery(<Editor target={target} onFileChange={onFileChange} onNavigate={onNavigate} autosaveMs={600} />)
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
  // what a failed write keeps on this device must not reach the next test
  window.localStorage.clear()
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
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved')
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

  test('the top bar navigates (no Find a source or History tab), Re-check starts a run, and Ctrl+S saves a new version', async () => {
    const { onNavigate } = renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Check a draft' }))
    expect(onNavigate).toHaveBeenCalledWith('home')
    // A draft's check history is on its project (#712); the Editor tab is the current page.
    const sections = within(screen.getByRole('navigation', { name: 'Editor sections' }))
    expect(sections.queryByRole('button', { name: 'Find a source' })).not.toBeInTheDocument()
    expect(sections.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(sections.getByText('Editor')).toHaveAttribute('aria-current', 'page')

    const before = gateway.checks.size
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(gateway.checks.size).toBe(before + 1))
    expect(gateway.calls).toContain('POST /author/drafts/d1/check')

    const editor = screen.getByLabelText('related-work.tex source')
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v4 · Saved'))
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
  test('typing writes the file after a pause; the status goes Unsaved changes then Saved and the tab dot comes and goes', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const before = writes()

    type('% typed\n')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Unsaved changes')
    expect(within(screen.getByRole('tab', { name: /related-work\.tex/ })).getByLabelText('unsaved changes')).toBeInTheDocument()

    await waitFor(() => expect(writes()).toBe(before + 1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved'))
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

  test('a refused write keeps the text on screen and on this device, says Save failed, and retry sends it again; Ctrl+S does not make a version until it lands', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()

    gateway.failWrites = true
    type('% offline\n')
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('Could not save related-work.tex: the gateway is down')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Save failed — retry')
    expect(stored()).toBe(original)
    // kept on this device too, for a reopen
    expect(JSON.parse(window.localStorage.getItem('ss.author.unsaved.d1')!).files['related-work.tex'].startsWith('% offline\n')).toBe(true)

    // a refetch of the draft (a check landing, the window focused) does not put the old text back
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed'))
    expect(source()).toContain('% offline')
    expect(gateway.calls).not.toContain('POST /author/drafts/d1/check')

    // Ctrl+S: no version while the gateway does not hold the text
    fireEvent.keyDown(screen.getByLabelText('related-work.tex source'), { key: 's', ctrlKey: true })
    expect(await screen.findByText(/Not saved: the gateway refused the last edit/)).toBeInTheDocument()
    expect(gateway.calls).not.toContain('POST /author/drafts/d1/save')
    expect(gateway.drafts.get('d1')!.version).toBe(3)

    gateway.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(stored().startsWith('% offline\n')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved'))
    // saved: nothing is kept on this device any more
    expect(window.localStorage.getItem('ss.author.unsaved.d1')).toBeNull()
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
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saving…')

    releaseFirst!()
    await waitFor(() => expect(writes()).toBe(before + 2), { timeout: 3000 })
    await waitFor(() => expect(stored().startsWith('% one\n% two\n')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(source()).toContain('% one% two') // CodeMirror's textContent has no line breaks

    // each write carried the draft's `updated` the editor last saw: the second, the first's answer
    const bodies = putBodies().slice(-2)
    expect(bodies.map((b) => b.content.startsWith('% one\n% two'))).toEqual([false, true])
    expect(bodies.map((b) => typeof b.updated)).toEqual(['string', 'string'])
    expect(bodies[1].updated).toBe(updatedAfterFirst)
  })

  test('undoing an edit whose write is still in flight is not clean: Ctrl+S waits, the gateway gets the undone text back, and only then a version', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()
    const before = writes()

    // hold the reply to the write of what was typed
    let release: (() => void) | null = null
    let held = 0
    gateway.beforeWrite = (_name, content) => {
      if (!content.startsWith('% typed')) return Promise.resolve()
      held += 1
      return new Promise<void>((resolve) => {
        release = resolve
      })
    }
    type('% typed\n')
    await waitFor(() => expect(held).toBe(1), { timeout: 3000 })

    // undo: the text on screen is the last confirmed text again, with that write unanswered
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 0, to: '% typed\n'.length, insert: '' } }))
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saving…')
    fireEvent.keyDown(screen.getByLabelText('related-work.tex source'), { key: 's', ctrlKey: true })
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(gateway.calls).not.toContain('POST /author/drafts/d1/save')
    expect(writes()).toBe(before + 1)

    release!()
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4), { timeout: 3000 })
    expect(writes()).toBe(before + 2) // the typed text, then the undone text
    expect(stored()).toBe(original) // what v4 names is what the gateway holds
    const put = gateway.calls.lastIndexOf('PUT /author/drafts/d1/files/related-work.tex')
    expect(put).toBeLessThan(gateway.calls.indexOf('POST /author/drafts/d1/save'))
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v4 · Saved'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /** Another tab saves related-work.tex: the draft's `updated` moves on without this editor seeing it. */
  function savedElsewhere(original: string) {
    const draft = gateway.drafts.get('d1')!
    draft.files.find((f) => f.name === 'related-work.tex')!.content = `% from another tab\n${original}`
    draft.updated = new Date(Date.now() + 60_000).toISOString()
  }

  test('a write from an editor another tab has overtaken is refused and the author is asked; Keep my version overwrites', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()
    const reads = () => gateway.calls.filter((c) => c === 'GET /author/drafts/d1').length
    const readsBefore = reads()

    savedElsewhere(original)
    type('% here\n')
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('related-work.tex was changed elsewhere (another tab?) since this editor last saved it. Which version do you want to keep?')
    expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Save failed')
    expect(stored().startsWith('% from another tab\n')).toBe(true) // nothing was overwritten
    expect(source()).toContain('% here') // and the author's text is still on screen
    expect(source()).not.toContain('% from another tab')
    await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore))

    // more typing, Save and Ctrl+S do not overwrite while the choice is open
    type('% more\n')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Not saved: choose which version of the file to keep first.')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(stored().startsWith('% from another tab\n')).toBe(true)

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Keep my version' }))
    await waitFor(() => expect(stored().startsWith('% more\n% here\n')).toBe(true), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('in a conflict, Use the saved copy puts the newer text from the gateway on screen and writes nothing', async () => {
    renderEditor()
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const original = stored()

    savedElsewhere(original)
    type('% here\n')
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    const before = writes()
    fireEvent.click(within(alert).getByRole('button', { name: 'Use the saved copy' }))
    await waitFor(() => expect(source()).toContain('% from another tab'))
    expect(source()).not.toContain('% here')
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('v3 · Saved'))
    expect(writes()).toBe(before)
    expect(stored().startsWith('% from another tab\n')).toBe(true)
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

describe('Author LaTeX editor — the preview never edits the source', () => {
  test('a pasted paper renders in the preview while the saved file stays byte-identical and nothing is written', async () => {
    gateway = installFakeGateway({ files: [{ name: 'main.tex', content: PAPER_TEX }] })
    renderEditor({ draftId: 'd1', file: 'main.tex', line: 1 })
    const preview = () => screen.getByTestId('preview-page').shadowRoot
    await waitFor(() => expect(preview()?.querySelectorAll('.ss-graphic')).toHaveLength(4), { timeout: 15000 })
    expect(preview()?.textContent).toContain('Image not uploaded: figures/gemm_spock.png')
    expect(screen.queryByRole('alert')).toBeNull()

    const saved = gateway.drafts.get('d1')!.files.find((f) => f.name === 'main.tex')!.content
    expect(saved).toBe(PAPER_TEX)
    expect(gateway.calls.filter((c) => c.startsWith('PUT ') || c.endsWith('/save'))).toEqual([])
    // and the editor's own document is the same text (CodeMirror draws only the visible lines)
    expect(EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString()).toBe(PAPER_TEX)
  }, 20000)
})

describe('Author LaTeX editor — what Ask reads', () => {
  test('read_draft reads the text on screen, unsaved edits and an unsaved .bib key included, until the editor closes', async () => {
    let reader: DraftReader | null = null
    const onAgentApi = vi.fn((api: DraftReader | null) => {
      reader = api
    })
    const { unmount } = renderWithQuery(
      <Editor target={{ draftId: 'd1', file: 'related-work.tex' }} onFileChange={() => undefined} onNavigate={() => undefined} onAgentApi={onAgentApi} />,
    )
    await waitFor(() => expect(source()).toContain('\\section{Related work}'))
    const read = (args: Record<string, unknown> = {}) =>
      runTool(
        { id: '1', name: 'read_draft', args },
        { actions: { screen: 'editor', screens: [], openScreen: vi.fn(), openPaper: vi.fn(), draftEditor: () => reader }, point: vi.fn(), confirm: vi.fn() },
      )

    // The gateway refuses every write, so what is typed stays only on screen.
    gateway.failWrites = true
    type('% not saved yet\n')
    const chapter = await read({ end_line: 2 })
    expect(chapter).toMatchObject({ file: 'related-work.tex', first_line: 1, last_line: 2, truncated: false })
    // Which draft is open, so the agent can check it is the one the person asked for.
    expect(chapter.draft).toEqual({ id: 'd1', title: 'Related work — thesis ch.2' })
    expect(chapter.text).toBe('1\t% not saved yet\n2\t\\documentclass[11pt]{article}')
    expect(chapter.files).toEqual([
      { name: 'related-work.tex', kind: 'tex', dirty: true },
      { name: 'intro.tex', kind: 'tex', dirty: false },
      { name: 'main.bib', kind: 'bib', dirty: false },
    ])
    expect(chapter.bib_keys).toEqual(expect.arrayContaining(['khattab2020', 'santhanam2022']))
    expect(chapter.bib_keys).not.toContain('fresh2026')

    fireEvent.click(screen.getByRole('tab', { name: /main\.bib/ }))
    await waitFor(() => expect(screen.getByLabelText('main.bib source').textContent).toContain('khattab2020'))
    type('@misc{fresh2026, title={Fresh}}\n')
    const bib = await read({ file: 'main.bib', end_line: 1 })
    expect(bib).toMatchObject({ file: 'main.bib', text: '1\t@misc{fresh2026, title={Fresh}}' })
    expect(bib.bib_keys).toContain('fresh2026')
    // With no file named, it reads the one on screen now.
    expect(await read({ end_line: 1 })).toMatchObject({ file: 'main.bib' })
    expect(gateway.drafts.get('d1')!.files.find((f) => f.name === 'main.bib')!.content).not.toContain('fresh2026')

    // Closed, the editor takes its reader back, so read_draft finds no editor.
    unmount()
    expect(onAgentApi).toHaveBeenLastCalledWith(null)
    expect(reader).toBeNull()
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
