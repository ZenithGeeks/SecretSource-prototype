/** The passage list: judging, focusing, asking about a passage, and adding one by hand. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyDraft, type Candidate, type Draft, type Reference, type UncheckedCitation, type WorkClaim } from '../src/lib/labeling'
import { PassageList, revealInPanel } from '../src/roles/labeler/components/PassageList'

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

const claim = (candidates: Candidate[], over: Partial<WorkClaim> = {}): WorkClaim => ({
  claim_id: 'p#0',
  claim: 'Y is fast.',
  sentence: '',
  section: '',
  source: null,
  candidates,
  origin: 'extracted',
  ...over,
})

const refs: Reference[] = [
  { reference_id: 'refB', file: 'refB.pdf', label: 'Ref B' },
  { reference_id: 'refC', file: '', label: 'Ref C' },
]

function setup(over: Partial<Parameters<typeof PassageList>[0]> = {}, reactStrictMode = false) {
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
  const view = render(<PassageList {...props} />, { reactStrictMode })
  return { ...props, rerender: (next: Partial<typeof props>) => view.rerender(<PassageList {...props} {...next} />) }
}

afterEach(() => {
  // @ts-expect-error jsdom has none; the tests that need one add it
  delete Element.prototype.scrollIntoView
})

describe('the passages of a claim', () => {
  it('lists each passage under its reference with page and the grade form', () => {
    setup()
    const section = screen.getByRole('region', { name: 'Ref B' })
    expect(within(section).getByRole('button', { name: /text of c1/ })).toHaveTextContent(/page\s*4/)
    expect(within(section).getAllByRole('button', { name: /text of c[12]/ })).toHaveLength(2)
    expect(within(section).getByText('grade for refB')).toBeInTheDocument()
  })

  it('clamps passages that are not in focus and opens one from the keyboard', () => {
    const long = 'word '.repeat(80).trim()
    const props = setup({
      claim: claim([cand('c1', { passage: long }), cand('c2', { rank: 2, page: null, passage: long })]),
      focus: { file: 'refB.pdf', passage: long, page: 4, key: 'c1' },
    })
    const open = screen.getByRole('button', { name: /Passage 1/ })
    const shut = screen.getByRole('button', { name: /Passage 2/ })
    expect(open).toHaveAttribute('aria-expanded', 'true')
    expect(shut).toHaveAttribute('aria-expanded', 'false')
    const openText = within(open).getByText(long)
    const shutText = within(shut).getByText(long)
    expect(openText).toHaveClass('block')
    expect(openText).not.toHaveClass('line-clamp-3')
    expect(shutText).toHaveClass('line-clamp-3')
    expect(shutText).not.toHaveClass('block')

    fireEvent.focus(open)
    expect(props.onFocus).not.toHaveBeenCalled()
    fireEvent.focus(shut)
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: long, page: null, key: 'c2' })
  })

  it('puts the level form after every passage of the reference, wherever the focus is', () => {
    setup({ focus: { file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' } })
    const form = document.querySelector('[data-level-form]') as HTMLElement
    expect(form).toHaveTextContent('grade for refB')
    for (const name of [/text of c1/, /text of c2/]) {
      const card = screen.getByRole('button', { name }).closest('li') as HTMLElement
      expect(card.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(document.querySelectorAll('[data-level-form]')).toHaveLength(1)
  })

  it('puts the level form after the passages the person added, even when one of them is in focus', () => {
    setup({
      draft: { ...emptyDraft(), added: [{ reference_id: 'refB', page: 9, passage: 'mine' }] },
      focus: { file: 'refB.pdf', passage: 'mine', page: 9, key: 'added:refB:mine' },
    })
    const form = document.querySelector('[data-level-form]') as HTMLElement
    const added = screen.getByRole('button', { name: /mine/ }).closest('li') as HTMLElement
    expect(added.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens an added passage from the keyboard, and leaves the open one as it is', () => {
    const props = setup({
      claim: claim([]),
      draft: {
        ...emptyDraft(),
        added: [
          { reference_id: 'refB', page: 9, passage: 'mine' },
          { reference_id: 'refB', page: 2, passage: 'other note' },
        ],
      },
      focus: { file: 'refB.pdf', passage: 'mine', page: 9, key: 'added:refB:mine' },
    })
    fireEvent.focus(screen.getByRole('button', { name: /mine/ }))
    expect(props.onFocus).not.toHaveBeenCalled()
    fireEvent.focus(screen.getByRole('button', { name: /other note/ }))
    expect(props.onFocus).toHaveBeenCalledWith({
      file: 'refB.pdf',
      passage: 'other note',
      page: 2,
      key: 'added:refB:other note',
    })
    expect(screen.getByRole('button', { name: /other note/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /mine/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('switches between reference tabs and shows the summary chip on a finished one', () => {
    const second = { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C', ref: 'b2', authors: [], year: '2022' }
    const bothClaims: WorkClaim = claim([
      cand('c1'),
      cand('c2', { rank: 2 }),
      cand('c3', { reference_id: 'refC', reference_file: 'refC.pdf' }),
    ])
    const props = setup({
      claim: bothClaims,
      references: [refs[0], second],
      draft: {
        ...emptyDraft(),
        cands: { c1: 'relevant', c2: 'rejected' },
        labels: { refB: { evidence: 3, rationale: '', confidence: 'high' } },
      },
    })
    const tabs = screen.getByRole('tablist', { name: 'References for this claim' })
    const refBTab = within(tabs).getByRole('tab', { name: /1 of 2 relevant/ })
    const refCTab = within(tabs).getByRole('tab', { name: /Ref C/ })
    expect(refCTab).toHaveAttribute('aria-selected', 'true')
    expect(refBTab).toHaveAttribute('title', refBTab.textContent ?? '')
    expect(refBTab).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(refBTab)
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' })
  })

  it('tags a reference tab with the number the paper prints, when the markers give one', () => {
    const second = { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C', ref: 'b2', authors: [], year: '2022' }
    setup({
      claim: claim([cand('c1'), cand('c3', { reference_id: 'refC', reference_file: 'refC.pdf' })]),
      references: [refs[0], second],
      markers: [{ ref: 'b2', text: '7' }],
    })
    expect(screen.getByRole('tab', { name: /\[7\] Ref C/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Ref B/ })).not.toHaveAccessibleName(/\[/)
  })

  it('names the cited paper in the heading for one reference, and the cited papers for several', () => {
    const second = { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C', ref: 'b2', authors: [], year: '2022' }
    const one = setup()
    expect(screen.getByText('Passages found in Ref B')).toBeInTheDocument()
    one.rerender({
      claim: claim([cand('c1'), cand('c3', { reference_id: 'refC', reference_file: 'refC.pdf' })]),
      references: [refs[0], second],
    })
    expect(screen.getByText('Passages found in the cited papers')).toBeInTheDocument()
  })

  it('focuses an added passage or the reference file when switching to a tab with no candidates', () => {
    const second = { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C', ref: 'b2', authors: [], year: '2022' }
    const props = setup({
      claim: claim([cand('c1')]),
      references: [refs[0], second],
      draft: { ...emptyDraft(), added: [{ reference_id: 'refC', page: 2, passage: 'added note' }] },
    })
    fireEvent.click(screen.getByRole('tab', { name: /Ref C/ }))
    expect(props.onFocus).toHaveBeenCalledWith({
      file: 'refC.pdf',
      passage: 'added note',
      page: 2,
      key: 'added:refC:added note',
    })
  })

  it('focuses a passage and judges it', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /text of c1/ }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Passage 1 of Ref B' })).getByRole('radio', { name: 'Not relevant' }))
    expect(props.onJudge).toHaveBeenCalledWith('c1', 'rejected')
  })

  it('keeps automatic focus from scrolling during StrictMode replay but reveals explicit focus', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const props = setup({
      focus: { file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1', automatic: true },
      draft: { ...emptyDraft(), cands: { c1: 'relevant', c2: 'rejected' } },
    }, true)
    // A new claim opens at its decision: the first focused passage is not scrolled to.
    expect(scroll).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /text of c1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('radio', { name: /^Relevant/ })[0]).toHaveAttribute('aria-keyshortcuts', 'R')
    expect(screen.getAllByRole('radio', { name: /^Not relevant/ })[1]).toHaveAttribute('aria-checked', 'true')

    props.rerender({ focus: { file: 'refB.pdf', passage: 'text of c2', page: null, key: 'c2' } })
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
  })

  it('reveals a newly added passage that mounts with explicit focus', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const props = setup({}, true)
    props.rerender({
      draft: { ...emptyDraft(), added: [{ reference_id: 'refB', page: 3, passage: 'new passage' }] },
      focus: { file: 'refB.pdf', passage: 'new passage', page: 3, key: 'added:refB:new passage' },
    })
    expect(screen.getByRole('button', { name: /new passage/ })).toHaveAttribute('aria-pressed', 'true')
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
  })

  it('scrolls only the label panel to a newly focused passage, above or below the view', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const panel = document.createElement('div')
    panel.setAttribute('data-label-panel', '')
    document.body.appendChild(panel)
    const card = document.createElement('li')
    panel.appendChild(card)
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 40 })
    panel.getBoundingClientRect = () => ({ top: 0 }) as DOMRect

    panel.scrollTop = 0
    card.getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    revealInPanel(card)
    expect(panel.scrollTop).toBe(140)

    card.getBoundingClientRect = () => ({ top: -100 }) as DOMRect
    revealInPanel(card)
    expect(panel.scrollTop).toBe(40)

    card.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
    revealInPanel(card)
    expect(panel.scrollTop).toBe(40)
    expect(scroll).not.toHaveBeenCalled()
    panel.remove()
  })

  it('leaves a narrow page alone when the browser cannot scroll an element into view', () => {
    const card = document.createElement('li')
    expect(() => revealInPanel(card)).not.toThrow()
  })

  it('names a reference by its id when the reference list does not know it', () => {
    setup({ references: [] })
    expect(screen.getByRole('region', { name: 'refB' })).toBeInTheDocument()
  })

  it('says no passages were stored, without claiming a search found nothing', () => {
    setup({ claim: claim([]) })
    expect(screen.getByText(/No passages were stored for this claim/)).toBeInTheDocument()
    expect(screen.queryByText(/Retrieval found nothing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Citations that were not checked' })).not.toBeInTheDocument()
  })

  it('shows one line, not a list of citations, when a claim has no passages', () => {
    const unchecked: UncheckedCitation[] = [
      { ref: 'b0', label: 'Work named', reason: 'named' },
      { ref: 'b1', label: 'Work failed', reason: 'failed' },
    ]
    setup({ claim: claim([], { unchecked }) })
    expect(screen.getByText('No passages were stored for this claim. Add what supports it below.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Citations that were not checked' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Citations that were not checked/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Work named/)).not.toBeInTheDocument()
  })

  it('says a search is running', () => {
    setup({ claim: claim([]), search: 'searching' })
    expect(screen.getByRole('status')).toHaveTextContent('Searching the reference papers')
    expect(screen.queryByText(/No passages were stored/)).not.toBeInTheDocument()
  })

  it('offers to search again after a failed search', () => {
    const onSearchAgain = vi.fn()
    setup({ claim: claim([]), search: 'failed', onSearchAgain })
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(onSearchAgain).toHaveBeenCalled()
    expect(screen.queryByText(/No passages were stored/)).not.toBeInTheDocument()
  })
})

describe('which passage the keys mark', () => {
  it('shows R and N on every passage, says which one they mark, and outlines that one', () => {
    setup({ focus: { file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' } })
    expect(screen.getByText('R relevant · N not relevant · J/U or ↓/↑ next/previous')).toBeInTheDocument()
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getAllByText('R')).toHaveLength(1)
    expect(within(second).getAllByText('R')).toHaveLength(1)
    expect(within(first).getByText('R').parentElement).not.toHaveClass('opacity-50')
    expect(within(second).getByText('R').parentElement).toHaveClass('opacity-50')
    expect(first).toHaveClass('ring-2', 'bg-surface')
    expect(second).not.toHaveClass('ring-2')
  })

  it('puts no interactive element inside the button that opens a passage', () => {
    const { container } = render(
      <PassageList
        claim={claim([cand('c1'), cand('c2', { rank: 2 })])}
        draft={{ ...emptyDraft(), added: [{ reference_id: 'refB', page: 2, passage: 'mine' }] }}
        references={refs}
        focus={{ file: 'refB.pdf', passage: 'text of c1', page: 4, key: 'c1' }}
        onFocus={vi.fn()}
        onJudge={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onAsk={vi.fn()}
        grade={() => null}
      />,
    )
    const inner = 'button, a[href], input, select, textarea, [role="radio"], [role="radiogroup"], [tabindex]'
    for (const button of container.querySelectorAll('button')) expect(button.querySelector(inner)).toBeNull()
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
    expect(onAsk).toHaveBeenLastCalledWith({ referenceId: 'refB', name: 'Passage 1 · Ref B', page: 4, text: 'text of c1' })
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
    expect(screen.getByRole('button', { name: /page 9/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /page 9/ }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: 'refB.pdf', passage: 'mine', page: 9, key: 'added:refB:mine' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove this passage' }))
    expect(props.onRemove).toHaveBeenCalledWith(added)
  })

  it('opens a passage added for a reference the list does not know with no file', () => {
    const props = setup({ references: [], claim: claim([]), draft: { ...emptyDraft(), added: [{ reference_id: 'ghost', page: null, passage: 'lost' }] } })
    fireEvent.click(screen.getByRole('button', { name: 'lost' }))
    expect(props.onFocus).toHaveBeenCalledWith({ file: '', passage: 'lost', page: null, key: 'added:ghost:lost' })
  })

  it('opens a passage added for a work with no PDF with no file, scrolling it into view once focused', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const props = setup({
      claim: claim([]),
      draft: { ...emptyDraft(), added: [{ reference_id: 'refC', page: null, passage: 'cited only' }] },
    })
    props.rerender({ focus: { file: '', passage: 'cited only', page: null, key: 'added:refC:cited only' } })
    // No label panel around it here, so the page scrolls the browser's way.
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
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
