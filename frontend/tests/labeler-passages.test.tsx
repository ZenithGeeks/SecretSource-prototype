/** The passage list: judging, focusing, asking about a passage, and adding one by hand. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyDraft, type Candidate, type Draft, type Reference, type WorkClaim } from '../src/lib/labeling'
import { PassageList } from '../src/roles/labeler/components/PassageList'

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  cand_id: id,
  reference_id: 'refB',
  reference_file: 'refB.pdf',
  rank: 1,
  score: 2.5,
  page: 4,
  passage: `text of ${id}`,
  ...over,
})

const claim = (candidates: Candidate[]): WorkClaim => ({
  claim_id: 'p#0',
  claim: 'Y is fast.',
  sentence: '',
  section: '',
  source: null,
  candidates,
  origin: 'extracted',
})

const refs: Reference[] = [
  { reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' },
  { reference_id: 'refC', file: '', label: 'Ref C' },
]

function setup(over: Partial<Parameters<typeof PassageList>[0]> = {}) {
  const props = {
    claim: claim([cand('c1'), cand('c2', { rank: 2, page: null, score: null })]),
    draft: emptyDraft() as Draft,
    references: refs,
    focus: null,
    onFocus: vi.fn(),
    onJudge: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    grade: (id: string) => <p>grade for {id}</p>,
    ...over,
  }
  render(<PassageList {...props} />)
  return props
}

afterEach(() => {
  // @ts-expect-error jsdom has none; the tests that need one add it
  delete Element.prototype.scrollIntoView
})

describe('the passages of a claim', () => {
  it('lists each passage under its reference with page and the grade form', () => {
    setup()
    const section = screen.getByRole('region', { name: 'Ref B' })
    expect(within(section).getByRole('button', { name: /text of c1/ })).toHaveTextContent(/p\.\s*4/)
    expect(within(section).getAllByRole('button', { name: /text of c[12]/ })).toHaveLength(2)
    expect(within(section).getByText('grade for refB')).toBeInTheDocument()
  })

  it('focuses a passage and judges it', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /text of c1/ }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Passage 1 of Ref B' })).getByRole('radio', { name: 'Not relevant' }))
    expect(props.onJudge).toHaveBeenCalledWith('c1', 'rejected')
  })

  it('marks the focused passage, shows the shortcut keys, and scrolls it into view', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    setup({
      focus: { file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' },
      draft: { ...emptyDraft(), cands: { c1: 'relevant', c2: 'rejected' } },
    })
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByRole('button', { name: /text of c1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-keyshortcuts', 'R')
    expect(screen.getAllByRole('radio', { name: /^Not relevant/ })[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('names a reference by its id when the reference list does not know it', () => {
    setup({ references: [] })
    expect(screen.getByRole('region', { name: 'refB' })).toBeInTheDocument()
  })

  it('says retrieval found nothing', () => {
    setup({ claim: claim([]) })
    expect(screen.getByText(/Retrieval found nothing/)).toBeInTheDocument()
  })

  it('says a search is running', () => {
    setup({ claim: claim([]), search: 'searching' })
    expect(screen.getByRole('status')).toHaveTextContent('Searching the reference papers')
    expect(screen.queryByText(/Retrieval found nothing/)).not.toBeInTheDocument()
  })

  it('offers to search again after a failed search', () => {
    const onSearchAgain = vi.fn()
    setup({ claim: claim([]), search: 'failed', onSearchAgain })
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(onSearchAgain).toHaveBeenCalled()
  })
})

describe('asking about a passage', () => {
  it('has no Ask button unless the screen can ask', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Ask AI about this passage' })).not.toBeInTheDocument()
  })

  it('asks about a retrieved passage, and about one the person added when the reference has a PDF', () => {
    const onAsk = vi.fn()
    setup({ onAsk, draft: { ...emptyDraft(), added: [{ reference_id: 'refB', page: 9, passage: 'mine' }] } })
    const asks = screen.getAllByRole('button', { name: 'Ask AI about this passage' })
    expect(asks).toHaveLength(3)
    fireEvent.click(asks[0])
    expect(onAsk).toHaveBeenLastCalledWith({ referenceId: 'refB', name: '#1 Ref B', page: 4, text: 'text of c1' })
    fireEvent.click(asks[2])
    expect(onAsk).toHaveBeenLastCalledWith({ referenceId: 'refB', name: 'Yours · Ref B', page: 9, text: 'mine' })
  })

  it('does not offer to ask about a passage added for a work with no PDF', () => {
    setup({ onAsk: vi.fn(), claim: claim([]), draft: { ...emptyDraft(), added: [{ reference_id: 'refC', page: null, passage: 'mine' }] } })
    expect(screen.queryByRole('button', { name: 'Ask AI about this passage' })).not.toBeInTheDocument()
  })
})

describe('passages the person added', () => {
  const added = { reference_id: 'refB', page: 9, passage: 'mine' }

  it('focuses and removes them, and marks the focused one', () => {
    const props = setup({ draft: { ...emptyDraft(), added: [added] }, focus: { file: 'refB.pdf', passage: 'mine', page: 9, key: 'added:refB:mine' } })
    expect(screen.getByRole('button', { name: /p\.9/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /p\.9/ }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: 'mine', page: 9, key: 'added:refB:mine' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove this passage' }))
    expect(props.onRemove).toHaveBeenCalledWith(added)
  })

  it('opens a passage added for a reference the list does not know with no file', () => {
    const props = setup({ references: [], claim: claim([]), draft: { ...emptyDraft(), added: [{ reference_id: 'ghost', page: null, passage: 'lost' }] } })
    fireEvent.click(screen.getByRole('button', { name: 'lost' }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: '', passage: 'lost', page: null, key: 'added:ghost:lost' })
  })

  it('opens a passage added for a work with no PDF with no file, scrolling it into view when focused', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const props = setup({
      claim: claim([]),
      draft: { ...emptyDraft(), added: [{ reference_id: 'refC', page: null, passage: 'cited only' }] },
      focus: { file: '', passage: 'cited only', page: null, key: 'added:refC:cited only' },
    })
    expect(scroll).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'cited only' }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: '', passage: 'cited only', page: null, key: 'added:refC:cited only' })
  })
})

describe('adding a passage retrieval missed', () => {
  it('offers nothing when the paper has no references', () => {
    setup({ references: [] })
    expect(screen.queryByRole('button', { name: 'Add a passage retrieval missed' })).not.toBeInTheDocument()
  })

  it('adds a passage under the first reference, ignoring a blank one', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    const form = screen.getByLabelText('The passage').closest('form') as HTMLFormElement
    fireEvent.submit(form)
    expect(props.onAdd).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: '  found it  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    expect(props.onAdd).toHaveBeenCalledWith({ reference_id: 'refB', page: null, passage: 'found it' })
    expect(screen.queryByLabelText('The passage')).not.toBeInTheDocument()
  })

  it('adds a passage under the chosen reference and page, and marks a reference with no PDF', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    expect(screen.getByRole('option', { name: 'Ref C (no PDF)' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reference paper'), { target: { value: 'refC' } })
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('The passage'), { target: { value: 'cited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }))
    expect(props.onAdd).toHaveBeenCalledWith({ reference_id: 'refC', page: 12, passage: 'cited' })
  })

  it('closes the form with Cancel', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passage retrieval missed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Add a passage retrieval missed' })).toBeInTheDocument()
  })
})
