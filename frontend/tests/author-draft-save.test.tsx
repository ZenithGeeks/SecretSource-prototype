/**
 * Naming and saving a draft in the Author editor (SCRUM-462): a new draft is "Untitled draft
 * N", the title in the top bar renames it in place, typing is written about 2 s after it stops,
 * the work survives a reload, an empty title is refused, a \title is offered as the name, and
 * text a failed save could not write is kept on this device and offered back on reopen. The
 * gateway is the fake one; the editor, CodeMirror and the cache are real.
 */

import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { authorApi, editedLabel } from '../src/lib/author'
import { YourDraftsCard } from '../src/roles/author/components/YourDraftsCard'
import { AUTOSAVE_DELAY_MS, texTitle } from '../src/lib/draftSave'
import { Editor } from '../src/roles/author/screens/Editor'
import type { Draft } from '../src/types/draftCheck'
import { Toaster } from '../src/components/Toaster'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
  Element.prototype.scrollIntoView = () => undefined
})

let gateway: FakeGateway

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
  window.localStorage.clear()
})

afterEach(() => vi.unstubAllGlobals())

/** The editor as the app mounts it, with a cache of its own: a second call is a reload. */
function open(draftId: string, ui: (editor: ReactNode) => ReactNode = (e) => e) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onWriteFailed = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      {ui(<Editor target={{ draftId, file: 'main.tex', line: 1 }} onFileChange={() => undefined} onNavigate={() => undefined} onWriteFailed={onWriteFailed} />)}
    </QueryClientProvider>,
  )
  return { ...view, onWriteFailed }
}

function type(text: string, at = 0) {
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
  act(() => view.dispatch({ changes: { from: at, insert: text } }))
}

const docText = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.doc.toString()
const stored = (id: string) => gateway.drafts.get(id)!.files.find((f) => f.name === 'main.tex')!.content
const writesOf = (id: string) => gateway.calls.filter((c) => c === `PUT /author/drafts/${id}/files/main.tex`).length
const patchesOf = (id: string) => gateway.calls.filter((c) => c === `PATCH /author/drafts/${id}`).length

describe('a new draft', () => {
  test('is "Untitled draft", then "Untitled draft 2"', async () => {
    expect((await authorApi.createDraft({ title: 'Untitled draft' })).title).toBe('Untitled draft')
    expect((await authorApi.createDraft({ title: 'Untitled draft' })).title).toBe('Untitled draft 2')
    expect((await authorApi.createDraft({})).title).toBe('Untitled draft 3')
  })
})

describe('rename and save', () => {
  test('create → rename → edit → autosave about 2 s after typing stops → reload shows the same title and text', async () => {
    const { id } = await authorApi.createDraft({ title: 'Untitled draft' })
    const first = open(id)
    const title = await screen.findByRole('button', { name: 'Draft title: Untitled draft. Rename' })

    fireEvent.click(title)
    const field = screen.getByRole('textbox', { name: 'Draft title' })
    expect(field).toHaveValue('Untitled draft')
    fireEvent.change(field, { target: { value: '  Batched   solvers on GPUs ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Draft title: Batched solvers on GPUs. Rename' })).toBeInTheDocument()
    expect(gateway.drafts.get(id)!.title).toBe('Batched solvers on GPUs')

    // the autosave waits for a 2 s pause: nothing is written a second in, the text is at ~2 s
    expect(AUTOSAVE_DELAY_MS).toBe(2000)
    type('\\section{Intro}\nGrouping by size.\n')
    expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved changes')
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)))
    expect(writesOf(id)).toBe(0)
    await waitFor(() => expect(writesOf(id)).toBe(1), { timeout: 2500 })
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Saved'))
    expect(stored(id)).toBe('\\section{Intro}\nGrouping by size.\n')

    first.unmount()
    open(id)
    expect(await screen.findByRole('button', { name: 'Draft title: Batched solvers on GPUs. Rename' })).toBeInTheDocument()
    await waitFor(() => expect(docText()).toBe('\\section{Intro}\nGrouping by size.\n'))
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saved')
  }, 20000)

  test('an empty title is refused and nothing is sent; Escape cancels; leaving an empty field keeps the old title', async () => {
    open('d1')
    fireEvent.click(await screen.findByRole('button', { name: /^Draft title: Related work — thesis ch\.2\. Rename$/ }))
    const field = screen.getByRole('textbox', { name: 'Draft title' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('A draft needs a title')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(patchesOf('d1')).toBe(0)

    fireEvent.change(field, { target: { value: 'Something else' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Draft title' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Draft title: Related work — thesis ch\.2\. Rename$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Draft title: Related work/ }))
    const again = screen.getByRole('textbox', { name: 'Draft title' })
    expect(again).toHaveAttribute('maxLength', '120')
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.blur(again)
    expect(screen.getByRole('button', { name: /^Draft title: Related work — thesis ch\.2\. Rename$/ })).toBeInTheDocument()
    expect(patchesOf('d1')).toBe(0)
    expect(gateway.drafts.get('d1')!.title).toBe('Related work — thesis ch.2')
  })

  test('a rename the gateway refuses keeps the field open with its reason', async () => {
    open('d1')
    fireEvent.click(await screen.findByRole('button', { name: /^Draft title: Related work/ }))
    const field = screen.getByRole('textbox', { name: 'Draft title' })
    gateway.failWrites = true
    fireEvent.change(field, { target: { value: 'Chapter 2' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not renamed: the gateway is down')
    expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Chapter 2')
  })

  test('the Save button writes what is pending and makes a version; Ctrl+S does the same from anywhere on the screen', async () => {
    open('d1')
    await screen.findByRole('button', { name: /^Draft title: Related work/ })
    await waitFor(() => expect(docText()).toContain('\\section{Related work}'))
    type('% saved by the button\n')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
    expect(gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!.content.startsWith('% saved by the button\n')).toBe(true)
    expect(await screen.findByText('Saved as v4')).toBeInTheDocument()

    // focus outside the source: the window takes Ctrl+S, not the browser
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(5))
  })

  test('a draft still called "Untitled draft N" is offered the name in its \\title', async () => {
    const { id } = await authorApi.createDraft({ title: 'Untitled draft', files: [{ name: 'main.tex', content: '' }] })
    open(id)
    await screen.findByRole('button', { name: 'Draft title: Untitled draft. Rename' })
    expect(screen.queryByText(/from its \\title/)).toBeNull()

    type('\\documentclass{article}\n\\title{Batched \\textbf{Dense} Solvers\\\\ on GPUs\\thanks{Funded.}}\n\\begin{document}\n\\end{document}\n')
    // offered once typing pauses for a second, not while the \title is half typed
    expect(screen.queryByText(/from its \\title/)).toBeNull()
    const offer = await screen.findByText('Name this draft “Batched Dense Solvers on GPUs”, from its \\title?', {}, { timeout: 3000 })
    fireEvent.click(within(offer.parentElement!).getByRole('button', { name: 'Use this title' }))
    expect(await screen.findByRole('button', { name: 'Draft title: Batched Dense Solvers on GPUs. Rename' })).toBeInTheDocument()
    expect(gateway.drafts.get(id)!.title).toBe('Batched Dense Solvers on GPUs')
    expect(screen.queryByText(/from its \\title/)).toBeNull()
  })
})

describe('what is not a conflict', () => {
  test("the editor's own Save, and another tab changing another file, never ask which version to keep", async () => {
    open('d1')
    await screen.findByRole('button', { name: /^Draft title: Related work/ })
    await waitFor(() => expect(docText()).toContain('\\section{Related work}'))
    const chapter = () => gateway.drafts.get('d1')!.files.find((f) => f.name === 'related-work.tex')!.content

    // Save makes a version (the draft's `updated` moves); typing right after still writes
    type('% one\n')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gateway.drafts.get('d1')!.version).toBe(4))
    type('% two\n')
    await waitFor(() => expect(chapter().startsWith('% two\n% one\n')).toBe(true), { timeout: 4000 })

    // another tab changes intro.tex only: this file is written, nothing is asked
    const draft = gateway.drafts.get('d1')!
    draft.files.find((f) => f.name === 'intro.tex')!.content += '% elsewhere\n'
    draft.updated = new Date(Date.now() + 60_000).toISOString()
    type('% three\n')
    await waitFor(() => expect(chapter().startsWith('% three\n% two\n')).toBe(true), { timeout: 4000 })
    expect(screen.queryByText(/Which version do you want to keep/)).toBeNull()
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Saved'))
  }, 20000)

  test('Escape, then the field losing focus, does not rename', async () => {
    open('d1')
    fireEvent.click(await screen.findByRole('button', { name: /^Draft title: Related work/ }))
    const field = screen.getByRole('textbox', { name: 'Draft title' })
    fireEvent.change(field, { target: { value: 'Draft X' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.blur(field)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(patchesOf('d1')).toBe(0)
    expect(gateway.drafts.get('d1')!.title).toBe('Related work — thesis ch.2')
  })
})

describe('a save that fails', () => {
  test('leaving the editor writes what is pending and keeps nothing on this device once that write lands', async () => {
    const { id } = await authorApi.createDraft({ title: 'Leaving', files: [{ name: 'main.tex', content: 'saved text\n' }] })
    const first = open(id)
    await waitFor(() => expect(docText()).toBe('saved text\n'))
    type('% typed then left\n')
    first.unmount()
    await waitFor(() => expect(stored(id)).toBe('% typed then left\nsaved text\n'))
    await waitFor(() => expect(window.localStorage.getItem(`ss.author.unsaved.${id}`)).toBeNull())
    open(id)
    await waitFor(() => expect(docText()).toBe('% typed then left\nsaved text\n'))
    expect(screen.queryByText(/were kept on this device/)).toBeNull()
  })

  test('keeps the text on this device; reopening offers it back, Restore writes it, and then nothing is kept', async () => {
    const { id } = await authorApi.createDraft({ title: 'Recovery', files: [{ name: 'main.tex', content: 'saved text\n' }] })
    const first = open(id)
    await waitFor(() => expect(docText()).toBe('saved text\n'))

    gateway.failWrites = true
    type('% written offline\n')
    expect(await screen.findByText(/Could not save main\.tex: the gateway is down/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed — retry')
    const kept = JSON.parse(window.localStorage.getItem(`ss.author.unsaved.${id}`)!) as { at: string; files: Record<string, string> }
    expect(kept.files['main.tex']).toBe('% written offline\nsaved text\n')

    // leaving fails too; the gateway still holds the old text
    first.unmount()
    await waitFor(() => expect(first.onWriteFailed).toHaveBeenCalled())
    expect(stored(id)).toBe('saved text\n')

    gateway.failWrites = false
    open(id)
    const offer = await screen.findByText(/Unsaved edits to main\.tex from .* were kept on this device\./)
    expect(docText()).toBe('saved text\n') // nothing changes until the author says so
    fireEvent.click(within(offer.parentElement!).getByRole('button', { name: 'Restore them' }))
    expect(docText()).toBe('% written offline\nsaved text\n')
    await waitFor(() => expect(stored(id)).toBe('% written offline\nsaved text\n'), { timeout: 4000 })
    await waitFor(() => expect(window.localStorage.getItem(`ss.author.unsaved.${id}`)).toBeNull())
    expect(screen.queryByText(/were kept on this device/)).toBeNull()
  }, 20000)

  test('Discard drops what was kept; text that matches the gateway is never offered', async () => {
    const { id } = await authorApi.createDraft({ title: 'Recovery', files: [{ name: 'main.tex', content: 'saved text\n' }] })
    window.localStorage.setItem(`ss.author.unsaved.${id}`, JSON.stringify({ at: new Date().toISOString(), files: { 'main.tex': 'older edit\n' } }))
    const first = open(id)
    const offer = await screen.findByText(/Unsaved edits to main\.tex/)
    fireEvent.click(within(offer.parentElement!).getByRole('button', { name: 'Discard' }))
    expect(window.localStorage.getItem(`ss.author.unsaved.${id}`)).toBeNull()
    expect(docText()).toBe('saved text\n')
    first.unmount()

    window.localStorage.setItem(`ss.author.unsaved.${id}`, JSON.stringify({ at: new Date().toISOString(), files: { 'main.tex': 'saved text\n' } }))
    open(id)
    await waitFor(() => expect(docText()).toBe('saved text\n'))
    await waitFor(() => expect(window.localStorage.getItem(`ss.author.unsaved.${id}`)).toBeNull())
    expect(screen.queryByText(/were kept on this device/)).toBeNull()
  })
})

describe('the drafts list', () => {
  test('shows each draft by title with when its text was last edited', async () => {
    const drafts = (await authorApi.listDrafts()) as Draft[]
    const now = Date.now()
    const recent = { ...drafts[0], title: 'Batched solvers on GPUs', updated: new Date(now - 5 * 60_000).toISOString() }
    render(<YourDraftsCard drafts={[recent]} currentId={recent.id} onSelect={() => undefined} onNew={() => undefined} onHistory={() => undefined} />)
    const row = within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button')
    expect(row).toHaveTextContent('Batched solvers on GPUs')
    expect(row).toHaveTextContent('edited 5 min ago')
    expect(editedLabel(new Date(now - 26 * 3600_000).toISOString(), now)).toBe('edited yesterday')
  })
})

describe('texTitle', () => {
  test('reads the \\title as plain words, and nothing when there is none', () => {
    expect(texTitle('\\title[Short]{A {Nested} Title\\\\ with a break}')).toBe('A Nested Title with a break')
    expect(texTitle('\\title{x\\thanks{y}}')).toBe('x')
    expect(texTitle('no title here')).toBe('')
    expect(texTitle(`\\title{${'w '.repeat(100)}}`)).toHaveLength(120)
  })
})
