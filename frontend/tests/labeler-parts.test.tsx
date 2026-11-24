/** The small pieces of the labeler: filters, claim strip, label form, save bar and friends. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async () => {
    throw new Error('503: not set up')
  }),
}))

import { emptyDraft, emptyLabel, type Draft, type Pool, type WorkClaim } from '../src/lib/labeling'
import { ClaimDecision, ClaimSticky } from '../src/roles/labeler/components/ClaimDecision'
import { ClaimNav } from '../src/roles/labeler/components/ClaimNav'
import { LabelForm } from '../src/roles/labeler/components/LabelForm'
import { NoMatch, PaperFilters } from '../src/roles/labeler/components/PaperFilters'
import { SaveBar } from '../src/roles/labeler/components/SaveBar'
import { SelectionBar } from '../src/roles/labeler/components/SelectionBar'
import { TeamTopics } from '../src/roles/labeler/components/TeamTopics'
import { TopicSelect } from '../src/roles/labeler/components/TopicSelect'
import { UploadPdfButton } from '../src/roles/labeler/components/UploadPdfButton'
import { VenueRankBadge } from '../src/roles/labeler/components/VenueRankBadge'
import { NO_FILTERS, readFilters, teamStatusOf, valueLabel, writeFilters, type Paper } from '../src/roles/labeler/paperFilters'

const withQuery = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('paper filters in the address bar', () => {
  it('reads only the status and progress values it knows', () => {
    const filters = readFilters('?status=done&status=bogus&progress=started&progress=nope&q=bert&by=Chanya&topic=CV')
    expect(filters).toEqual({ search: 'bert', addedBy: ['Chanya'], topic: ['CV'], status: ['done'], progress: ['started'] })
  })

  it('writes the filters back and keeps other keys', () => {
    expect(writeFilters('?analysis=a1&q=old', { ...NO_FILTERS, search: 'bert', topic: ['CV', 'NLP'] })).toBe('analysis=a1&q=bert&topic=CV&topic=NLP')
    expect(writeFilters('?q=old', NO_FILTERS)).toBe('')
  })

  it('words a value for the filter buttons, and passes an unknown one through', () => {
    expect(valueLabel('addedBy', 'Chanya', 'Chanya')).toBe('You')
    expect(valueLabel('addedBy', '', 'Chanya')).toBe('Unknown')
    expect(valueLabel('addedBy', 'Somchai', 'Chanya')).toBe('Somchai')
    expect(valueLabel('status', 'error', 'x')).toBe('Could not be read')
    expect(valueLabel('status', 'weird', 'x')).toBe('weird')
    expect(valueLabel('progress', 'none', 'x')).toBe('Not started')
    expect(valueLabel('progress', 'weird', 'x')).toBe('weird')
    expect(valueLabel('topic', 'CV', 'x')).toBe('CV')
  })
})

const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  analysis_id: id,
  title: `Paper ${id}`,
  topic: 'CV',
  claims: 2,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: false,
  added_by: 'Somchai',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
  ...over,
})

describe('teamStatusOf', () => {
  it('is done only once every claim is judged by someone on the team, and the paper itself is ready', () => {
    expect(teamStatusOf(paper('a', { claims: 2, team_judged: 2 }))).toBe('done')
    expect(teamStatusOf(paper('b', { claims: 2, team_judged: 1 }))).toBe('started')
    expect(teamStatusOf(paper('c', { claims: 2, team_judged: 0 }))).toBe('none')
    // A paper with no claims at all is never "done", even though 0 judged meets 0 needed.
    expect(teamStatusOf(paper('d', { claims: 0, team_judged: 0 }))).toBe('none')
    // Still being read: not done no matter how many of its (not yet final) claims are judged.
    expect(teamStatusOf(paper('e', { status: 'running', claims: 2, team_judged: 2 }))).toBe('started')
  })
})

describe('PaperFilters', () => {
  it('lists the people who added papers, you first and the unnamed last', () => {
    const papers = [
      paper('a', { added_by: 'Zed' }),
      paper('b', { added_by: '' }),
      paper('c', { added_by: 'Chanya' }),
      paper('d', { added_by: 'Ann' }),
      paper('e', { added_by: '' }),
    ]
    render(<PaperFilters papers={papers} topics={['CV']} me="Chanya" filters={NO_FILTERS} onChange={vi.fn()} shown={5} />)
    fireEvent.click(screen.getByRole('button', { name: /Added by/ }))
    expect(screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('Ann'),
      expect.stringContaining('Zed'),
      expect.stringContaining('Unknown'),
    ])
  })

  it('says how many of the papers are shown, and clears the filters', () => {
    const onChange = vi.fn()
    render(<PaperFilters papers={[paper('a'), paper('b')]} topics={[]} me="x" filters={{ ...NO_FILTERS, search: 'a' }} onChange={onChange} shown={1} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 papers')
    fireEvent.change(screen.getByPlaceholderText('Search titles and keywords'), { target: { value: 'ab' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, search: 'ab' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onChange).toHaveBeenLastCalledWith(NO_FILTERS)
  })
})

describe('NoMatch', () => {
  it('names each active filter', () => {
    const onClear = vi.fn()
    render(<NoMatch filters={{ ...NO_FILTERS, search: ' bert ', status: ['running', 'error'], addedBy: ['Chanya'] }} me="Chanya" onClear={onClear} />)
    expect(screen.getByText('Title or keywords have "bert" · Added by: You · Status: Reading or Could not be read')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('names only the facets when there are no search words', () => {
    render(<NoMatch filters={{ ...NO_FILTERS, topic: ['CV'] }} me="x" onClear={vi.fn()} />)
    expect(screen.getByText('Topic: CV')).toBeInTheDocument()
  })
})

const claim = (id: string, text: string, over: Partial<WorkClaim> = {}): WorkClaim => ({
  claim_id: id,
  claim: text,
  sentence: '',
  section: '',
  source: null,
  candidates: [],
  origin: 'extracted',
  ...over,
})

describe('ClaimNav', () => {
  const claims = [claim('c1', 'First claim.'), claim('c2', 'Second claim.')]
  const renderNav = (over: Partial<Parameters<typeof ClaimNav>[0]> = {}) => {
    const props = { claims, drafts: {}, saved: {}, references: [], current: 'c1', onSelect: vi.fn(), onAdd: vi.fn(), ...over }
    function StatefulNav() {
      const [adding, setAdding] = useState(false)
      const [text, setText] = useState('')
      return <ClaimNav adding={adding} setAdding={setAdding} text={text} setText={setText} {...props} />
    }
    render(<StatefulNav />)
    return props
  }

  it('scrolls the current chip into view when the browser can', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderNav()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    // @ts-expect-error jsdom has none; later tests expect it missing
    delete Element.prototype.scrollIntoView
  })

  it('shows the edited wording of an edited claim, and crosses out a rejected one', () => {
    const drafts: Record<string, Draft> = {
      c1: { ...emptyDraft(), status: 'edited', edited: 'Better claim.' },
      c2: { ...emptyDraft(), status: 'rejected' },
    }
    renderNav({ drafts, saved: drafts })
    expect(screen.getByRole('button', { name: /^Claim 1, finished: Better claim\./ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claim 2, finished: Second claim\./ })).toHaveClass('line-through')
  })

  it('adds a claim and closes the form, ignoring a blank one', () => {
    const props = renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))
    const box = screen.getByRole('textbox')
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    expect(props.onAdd).not.toHaveBeenCalled()

    fireEvent.change(box, { target: { value: '  A new claim  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add claim' }))
    expect(props.onAdd).toHaveBeenCalledWith('A new claim')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes the form with Cancel, and selects a claim from its chip', () => {
    const props = renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed claim' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Claim 2/ }))
    expect(props.onSelect).toHaveBeenCalledWith('c2')
  })

  it('is one Tab stop, moved along with the arrow keys, Home and End, without opening a claim', () => {
    const props = renderNav({ claims: [...claims, claim('c3', 'Third claim.')] })
    const chip = (n: number) => screen.getByRole('button', { name: new RegExp(`^Claim ${n},`) })
    expect(chip(1)).toHaveAttribute('tabindex', '0')
    expect(chip(2)).toHaveAttribute('tabindex', '-1')
    chip(1).focus()
    fireEvent.keyDown(chip(1), { key: 'ArrowRight' })
    expect(chip(2)).toHaveFocus()
    fireEvent.keyDown(chip(2), { key: 'End' })
    expect(chip(3)).toHaveFocus()
    fireEvent.keyDown(chip(3), { key: 'ArrowRight' })
    expect(chip(3)).toHaveFocus()
    fireEvent.keyDown(chip(3), { key: 'Home' })
    expect(chip(1)).toHaveFocus()
    fireEvent.keyDown(chip(1), { key: 'ArrowLeft' })
    fireEvent.keyDown(chip(1), { key: 'a' })
    expect(chip(1)).toHaveFocus()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('marks a claim with no reference to read, in its look and its description', () => {
    renderNav({ noReference: (c) => c.claim_id === 'c2' })
    const chip = screen.getByRole('button', { name: /^Claim 2,/ })
    expect(chip).toHaveAccessibleName(/, no reference to read: /)
    expect(screen.getByRole('button', { name: /^Claim 1,/ })).not.toHaveAccessibleName(/no reference to read/)
  })

  it('gives a chip with no reference an icon and a dotted outline, the usual fill, and a legend', () => {
    renderNav({ noReference: () => true })
    const current = screen.getByRole('button', { name: /^Claim 1,/ })
    const other = screen.getByRole('button', { name: /^Claim 2,/ })
    expect(current.querySelector('svg')).not.toBeNull()
    expect(other.querySelector('svg')).not.toBeNull()
    expect(other).toHaveClass('border-dotted', 'bg-surface', 'text-ink-muted')
    expect(current).toHaveClass('border-dotted', 'bg-accent-soft')
    expect(screen.getByText('= no reference to read')).toBeInTheDocument()
  })

  it('shows no legend when every claim has a reference', () => {
    renderNav({ noReference: () => false })
    expect(screen.queryByText('= no reference to read')).not.toBeInTheDocument()
  })

  it('shows overflow scroll buttons when the claim strip overflows', () => {
    renderNav()
    const list = screen.getByRole('list')
    const scrollBy = vi.fn()
    Object.defineProperty(list, 'scrollWidth', { value: 500, configurable: true })
    Object.defineProperty(list, 'clientWidth', { value: 200, configurable: true })
    Object.defineProperty(list, 'scrollLeft', { value: 50, configurable: true })
    list.scrollBy = scrollBy
    fireEvent.scroll(list)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll claims left' }))
    expect(scrollBy).toHaveBeenCalledWith({ left: -160, behavior: 'smooth' })
    fireEvent.click(screen.getByRole('button', { name: 'More claims' }))
    expect(scrollBy).toHaveBeenCalledWith({ left: 160, behavior: 'smooth' })
  })
})

describe('ClaimDecision', () => {
  it('lets the person write the edited claim', () => {
    const onChange = vi.fn()
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={2} draft={{ ...emptyDraft(), status: 'edited', edited: 'Mine' }} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'The claim, as it should read' }), { target: { value: 'Mine, better' } })
    expect(onChange).toHaveBeenCalledWith({ edited: 'Mine, better' })
  })

  it('leaves the wording box on Escape, keeping the wording, so the next key is a shortcut again', () => {
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={2} draft={{ ...emptyDraft(), status: 'edited', edited: 'Mine' }} onChange={vi.fn()} />)
    const box = screen.getByRole('textbox', { name: 'The claim, as it should read' })
    box.focus()
    fireEvent.keyDown(box, { key: 'z' })
    expect(box).toHaveFocus()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).not.toHaveFocus()
    expect(box).toHaveValue('Mine')
  })

  it('reopens a saved decision so it can be changed', () => {
    const onChange = vi.fn()
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={2} draft={{ ...emptyDraft(), status: 'accepted' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }))
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toHaveAttribute('aria-describedby')
    fireEvent.click(screen.getByRole('radio', { name: /Reject/ }))
    expect(onChange).toHaveBeenCalledWith({ status: 'rejected' })
  })

  it('reopens a rejected decision with its rejected choice selected', () => {
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={2} draft={{ ...emptyDraft(), status: 'rejected' }} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    expect(screen.getByRole('radiogroup', { name: 'Decision on this claim' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Reject/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('quotes the paper sentence until the claim is pinned', () => {
    const row = claim('c1', 'Original.', { sentence: 'The paper wrote a longer sentence.' })
    const { rerender } = render(
      <ClaimDecision claim={row} position={1} count={1} draft={emptyDraft()} onChange={vi.fn()} />,
    )
    expect(screen.getByText(/The paper says/)).toHaveTextContent('The paper wrote a longer sentence.')

    rerender(<ClaimDecision claim={row} pinned position={1} count={1} draft={emptyDraft()} onChange={vi.fn()} />)
    expect(screen.queryByText(/The paper says/)).not.toBeInTheDocument()
    expect(screen.getByText('Original.')).toBeInTheDocument()
  })

  it('leaves the quote out when the claim is the sentence, or a decision is already made', () => {
    const same = claim('c1', 'Original.', { sentence: 'Original.' })
    const { rerender } = render(
      <ClaimDecision claim={same} position={1} count={1} draft={emptyDraft()} onChange={vi.fn()} />,
    )
    expect(screen.queryByText(/The paper says/)).not.toBeInTheDocument()

    const row = claim('c1', 'Original.', { sentence: 'The paper wrote a longer sentence.' })
    rerender(
      <ClaimDecision claim={row} position={1} count={1} draft={{ ...emptyDraft(), status: 'accepted' }} onChange={vi.fn()} />,
    )
    expect(screen.queryByText(/The paper says/)).not.toBeInTheDocument()
  })
  it('says what comes after the claim is decided', () => {
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={1} draft={emptyDraft()} onChange={vi.fn()} />)
    expect(screen.getByText(/Decide on the claim first\. Its passages, and a 1–4 level for each reference, come after Keep or Edit\./)).toBeInTheDocument()
  })

  it('shows the paper sentence with the numbers the paper prints', () => {
    const row = claim('c1', 'Original.', { sentence: 'It builds on [b1] and [b2].' })
    render(
      <ClaimDecision
        claim={row}
        position={1}
        count={1}
        draft={emptyDraft()}
        markers={[{ ref: 'b1', text: '7' }]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/The paper says/)).toHaveTextContent('It builds on [7] and [b2].')
  })

  it('offers Clear decision only when it is given a handler', () => {
    const onClear = vi.fn()
    const row = claim('c1', 'Original.')
    const draft = { ...emptyDraft(), status: 'rejected' as const }
    const { rerender } = render(<ClaimDecision claim={row} position={1} count={1} draft={draft} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear decision' })).not.toBeInTheDocument()
    rerender(<ClaimDecision claim={row} position={1} count={1} draft={draft} onClear={onClear} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear decision' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('names the clear button after clearLabel', () => {
    const draft = { ...emptyDraft(), status: 'rejected' as const }
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={1} draft={draft} onClear={vi.fn()} clearLabel="Discard change" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Discard change' })).toBeInTheDocument()
  })

  it('asks for a new wording while the edit is empty or the same as the claim', () => {
    const row = claim('c1', 'Original.')
    const edited = (text: string) => ({ ...emptyDraft(), status: 'edited' as const, edited: text })
    const { rerender } = render(<ClaimDecision claim={row} position={1} count={1} draft={edited('Original.')} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'The claim, as it should read' })).toHaveAccessibleDescription('Reword the claim, or choose Keep')

    rerender(<ClaimDecision claim={row} position={1} count={1} draft={edited('   ')} onChange={vi.fn()} />)
    expect(screen.getByText('Reword the claim, or choose Keep')).toBeInTheDocument()

    rerender(<ClaimDecision claim={row} position={1} count={1} draft={edited('Better.')} onChange={vi.fn()} />)
    expect(screen.queryByText('Reword the claim, or choose Keep')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'The claim, as it should read' })).not.toHaveAttribute('aria-describedby')
  })
})

describe('ClaimSticky', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows a short claim whole, with no button', () => {
    render(<ClaimSticky text="Y is fast." />)
    expect(screen.getByText('Y is fast.')).toHaveClass('line-clamp-4')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers the full claim when the panel narrows and cleans up the observer', () => {
    const disconnect = vi.fn()
    let resize!: () => void
    vi.stubGlobal('ResizeObserver', class {
      constructor(notify: () => void) { resize = notify }
      observe() {}
      disconnect = disconnect
    })
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80)
    const { unmount } = render(<ClaimSticky text="Changes width." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    scrollHeight.mockReturnValue(120)
    act(() => resize())
    expect(screen.getByRole('button', { name: 'Show the full claim' })).toBeInTheDocument()
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('offers the full claim when the text is cut, and folds it again', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80)
    render(<ClaimSticky text="A very long claim." />)
    const more = screen.getByRole('button', { name: 'Show the full claim' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(screen.getByText('A very long claim.')).not.toHaveClass('line-clamp-4')
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByText('A very long claim.')).toHaveClass('line-clamp-4')
  })
})

describe('LabelForm', () => {
  const form = (over: Partial<Parameters<typeof LabelForm>[0]> = {}) => {
    const onChange = vi.fn()
    render(<LabelForm tag="[7]" title="Ref B" active label={{ ...emptyLabel(), evidence: 3 }} others={[]} onChange={onChange} {...over} />)
    return onChange
  }

  it('leaves the reason box on Escape, keeping what was typed', () => {
    form({ label: { ...emptyLabel(), evidence: 3, rationale: 'n = 12' } })
    const box = screen.getByRole('textbox', { name: /Why this level/ })
    box.focus()
    fireEvent.keyDown(box, { key: 'a' })
    expect(box).toHaveFocus()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).not.toHaveFocus()
    expect(box).toHaveValue('n = 12')
  })

  it('shows who else labeled the pair, and sends each change', () => {
    const onChange = form({ others: ['Somchai', 'Ann'] })
    expect(screen.getByText('Also labeled by Somchai, Ann. Their levels are not shown here, so choose yours on your own.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '3 · Clear' })).toHaveAccessibleDescription('The passage backs the claim, with a gap in scope or detail.')
    expect(screen.getByText('How to judge')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 3, rationale: 'because' })
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 3, confidence: 'high' })
    fireEvent.click(screen.getByRole('radio', { name: '4 · Strong' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 4 })
  })

  it('shows descriptions for all four levels even when none is chosen', () => {
    form({ active: false, label: undefined })
    expect(screen.getByRole('radio', { name: /^1 ·/ })).toHaveAccessibleDescription(/\S/)
    expect(screen.getByRole('radio', { name: /^4 ·/ })).toHaveAccessibleDescription(/\S/)
    expect(screen.getByText('How to judge')).toBeInTheDocument()
  })

  it('asks about the reference by its tag and shows the full title under it', () => {
    form()
    expect(screen.getByRole('group', { name: 'How well does [7] support the claim?' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Support level for [7]' })).toBeInTheDocument()
    expect(screen.getByTitle('Ref B')).toHaveTextContent('Ref B')
  })

  it('leaves the title out when it is the tag', () => {
    form({ tag: 'Ref B' })
    expect(screen.queryByTitle('Ref B')).not.toBeInTheDocument()
  })

  it('takes the chosen level back when it is clicked again', () => {
    const onChange = form()
    fireEvent.click(screen.getByRole('radio', { name: '3 · Clear' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: null })
  })

  it('takes the chosen confidence back when it is clicked again', () => {
    const onChange = form({ label: { ...emptyLabel(), evidence: 3, confidence: 'high' } })
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 3, confidence: null })
  })
})

describe('LabelForm keys and level rules', () => {
  const form = (over: Partial<Parameters<typeof LabelForm>[0]> = {}) =>
    render(<LabelForm tag="[7]" title="Ref B" active label={emptyLabel()} others={[]} onChange={vi.fn()} {...over} />)

  it('shows the key chip of each level on the reference in view only', () => {
    const { unmount } = form()
    const clear = screen.getByRole('radio', { name: '3 · Clear' })
    expect(clear).toHaveAttribute('aria-keyshortcuts', '3')
    expect(clear.querySelector('kbd')).toHaveTextContent('3')
    expect(clear).toHaveTextContent(/^3Clear3$/)
    unmount()
    form({ active: false })
    expect(screen.getByRole('radio', { name: '3 · Clear' })).not.toHaveAttribute('aria-keyshortcuts')
    expect(screen.getByRole('radio', { name: '3 · Clear' }).querySelector('kbd')).toBeNull()
  })

  it('shows the rule of the level pointed at or focused, else of the chosen one', () => {
    form({ label: { ...emptyLabel(), evidence: 4 } })
    expect(screen.getByText('4 Strong:').parentElement).toHaveTextContent('The passage states the claim directly and fully.')
    const weak = screen.getByRole('radio', { name: '2 · Weak' })
    fireEvent.mouseEnter(weak)
    expect(screen.getByText('2 Weak:')).toBeInTheDocument()
    fireEvent.mouseLeave(weak)
    fireEvent.focus(screen.getByRole('radio', { name: '1 · No support' }))
    expect(screen.getByText('1 No support:')).toBeInTheDocument()
    fireEvent.blur(screen.getByRole('radio', { name: '1 · No support' }))
    expect(screen.getByText('4 Strong:')).toBeInTheDocument()
  })

  it('invites pointing at a level when none is chosen', () => {
    form()
    expect(screen.getByText('Point at a level to read what it means.')).toBeInTheDocument()
  })
})

describe('no control inside another', () => {
  it('nests no interactive element inside a button in the decision, the level form or the save bar', () => {
    const { container } = render(
      <>
        <ClaimDecision claim={claim('c1', 'Original.')} position={1} count={1} draft={emptyDraft()} onChange={vi.fn()} />
        <LabelForm tag="[7]" title="Ref B" active label={emptyLabel()} others={[]} onChange={vi.fn()} />
        <SaveBar left={['a', 'b']} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} />
      </>,
    )
    const inner = 'button, a[href], input, select, textarea, [role="radio"], [role="radiogroup"], [tabindex]'
    for (const button of container.querySelectorAll('button')) expect(button.querySelector(inner)).toBeNull()
  })
})

describe('SaveBar', () => {
  const bar = (over: Partial<Parameters<typeof SaveBar>[0]> = {}) => {
    const props = { left: [], dirty: true, saving: false, error: null, savedRows: null, hasNext: true, onSave: vi.fn(), claimNumber: 3, ...over }
    render(<SaveBar {...props} />)
    return props
  }

  it('lists what is left, shows the error, and saves with or without moving on', () => {
    const props = bar({ left: ['Give Ref B a level'], error: 'offline' })
    expect(screen.getByText('Give Ref B a level')).toHaveAttribute('title', 'Give Ref B a level')
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: offline')
    expect(screen.getByText('Unsaved · saves as not finished, still to do:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+$/ }))
    expect(props.onSave).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: /^Save claim \d+ and next$/ }))
    expect(props.onSave).toHaveBeenLastCalledWith(true)
  })

  it('fills a save button only when the claim is complete, so a partial save is never the obvious step', () => {
    const filled = () => screen.queryAllByRole('button', { name: /^Save claim/ }).filter((b) => b.classList.contains('bg-accent')).map((b) => b.textContent)
    const { unmount } = render(<SaveBar left={['Give Ref B a level']} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={3} />)
    expect(filled()).toEqual([])
    unmount()
    const again = render(<SaveBar left={[]} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={3} />)
    expect(filled()).toEqual(['Save claim 3 and next'])
    again.unmount()
    render(<SaveBar left={['Give Ref B a level']} dirty saving={false} error={null} savedRows={null} hasNext={false} onSave={vi.fn()} claimNumber={3} />)
    expect(filled()).toEqual([])
  })

  it('shows the shortcut when unsaved with nothing left', () => {
    bar()
    expect(screen.getByText('Unsaved · Ctrl/⌘+S')).toBeInTheDocument()
    expect(screen.getByText('Every decision made, not saved yet')).toBeInTheDocument()
  })

  it('disables both save buttons and says why when saving is blocked', () => {
    bar({ blocked: 'Reword the claim, or choose Keep', left: ['Give Ref B a level', 'Judge a passage'] })
    expect(screen.getByText('Reword the claim, or choose Keep')).toBeInTheDocument()
    expect(screen.queryByText('Give Ref B a level')).not.toBeInTheDocument()
    expect(screen.queryByText('and 1 more')).not.toBeInTheDocument()
    for (const name of ['Save claim 3', 'Save claim 3 and next']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Reword the claim, or choose Keep')
    }
  })

  it('says Saved when saved, and hides Save and next when there is no next claim', () => {
    bar({ dirty: false, savedRows: 1, hasNext: false })
    expect(screen.getByText('Every decision made')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save claim \d+ and next$/ })).not.toBeInTheDocument()
  })

  it('says a save with work left is not finished, and names what is left', () => {
    bar({ left: ['Give Ref B a level'], dirty: false, savedRows: 1 })
    expect(screen.getByText('Saved, not finished · still to do:')).toBeInTheDocument()
    expect(screen.getByText('Give Ref B a level')).toBeInTheDocument()
  })

  it('shows the first thing left and folds the rest under "and N more"', () => {
    bar({ left: ['Give Ref B a level', 'Give Ref B a confidence', 'Judge a passage'] })
    expect(screen.getByText('Give Ref B a level')).toBeInTheDocument()
    const more = screen.getByRole('button', { name: 'and 2 more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const list = document.getElementById(more.getAttribute('aria-controls') ?? '')
    // Expanded, every item is listed in full, the first included, and the cut one-line copy goes.
    expect(within(list as HTMLElement).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Give Ref B a level',
      'Give Ref B a confidence',
      'Judge a passage',
    ])
    expect(screen.getAllByText('Give Ref B a level')).toHaveLength(1)
    expect(more).toHaveTextContent('Show less')
    fireEvent.click(more)
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shows a blocked save as a hint until the labeler tries to save', () => {
    const { rerender } = render(<SaveBar left={[]} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={1} blocked="Can't save yet" />)
    expect(screen.getByText("Can't save yet")).toHaveClass('text-ink-muted')
    rerender(<SaveBar left={[]} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={1} blocked="Can't save yet" warn />)
    expect(screen.getByText("Can't save yet")).toHaveClass('text-refutes')
  })

  it('has no "and N more" when one thing is left', () => {
    bar({ left: ['Give Ref B a level'] })
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it('names the claim each button saves, and offers Save all from two unsaved claims', () => {
    const onSaveAll = vi.fn()
    const { rerender } = render(
      <SaveBar left={[]} dirty saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={7} unsavedCount={1} onSaveAll={onSaveAll} />,
    )
    expect(screen.getByRole('button', { name: 'Save claim 7' })).toHaveAttribute('aria-keyshortcuts', 'Control+S Meta+S')
    expect(screen.getByRole('button', { name: 'Save claim 7 and next' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save all/ })).not.toBeInTheDocument()
    rerender(
      <SaveBar left={[]} dirty={false} saving={false} error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={7} unsavedCount={4} onSaveAll={onSaveAll} />,
    )
    // Enabled on a claim with no changes of its own, since others have some.
    const all = screen.getByRole('button', { name: 'Save all unsaved (4)' })
    expect(all).toBeEnabled()
    expect(all).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+S Meta+Shift+S')
    fireEvent.click(all)
    expect(onSaveAll).toHaveBeenCalledOnce()
    rerender(
      <SaveBar left={[]} dirty={false} saving error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={7} unsavedCount={4} onSaveAll={onSaveAll} />,
    )
    expect(screen.getByRole('button', { name: 'Save all unsaved (4)' })).toBeDisabled()
  })

  it('says Nothing changed when clean and disables Save', () => {
    render(<SaveBar left={[]} dirty={false} saving error={null} savedRows={null} hasNext onSave={vi.fn()} claimNumber={1} />)
    expect(screen.getByText('Nothing changed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save claim \d+$/ })).toBeDisabled()
  })
})

describe('SelectionBar', () => {
  const handlers = () => ({ onEvidence: vi.fn(), onClaimWording: vi.fn(), onNewClaim: vi.fn(), onClear: vi.fn() })

  it('shortens a long selection from the paper and offers the claim actions', () => {
    const h = handlers()
    render(<SelectionBar picked={{ side: 'paper', file: 'p.pdf', text: 'x'.repeat(300), page: 3 }} blocked={null} {...h} />)
    expect(screen.getByText(`${'x'.repeat(240)}…`)).toBeInTheDocument()
    expect(screen.getByText('Selected in the paper, page 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Use as this claim's wording" }))
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new claim' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }))
    expect(h.onClaimWording).toHaveBeenCalled()
    expect(h.onNewClaim).toHaveBeenCalled()
    expect(h.onClear).toHaveBeenCalled()
  })

  it('adds evidence from the reference, or says why it cannot yet', () => {
    const h = handlers()
    const { unmount } = render(<SelectionBar picked={{ side: 'reference', file: 'r.pdf', text: 'short', page: null }} blocked={null} {...h} />)
    expect(screen.getByText('Selected in the reference')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add as evidence' }))
    expect(h.onEvidence).toHaveBeenCalled()
    unmount()
    render(<SelectionBar picked={{ side: 'reference', file: 'r.pdf', text: 'short', page: null }} blocked="Pick a claim first" {...h} />)
    expect(screen.getByRole('button', { name: 'Add as evidence' })).toBeDisabled()
    expect(screen.getByText('Pick a claim first')).toBeInTheDocument()
  })
})

describe('TeamTopics', () => {
  const pool = (over: Partial<Pool> = {}): Pool => ({ topics: ['CV', 'ZZ'], me: 'Chanya', people: [{ name: 'Chanya', topic: 'CV' }, { name: 'Ann', topic: '' }], papers: [], ...over })

  it('summarises who labels what and sets a topic', () => {
    withQuery(<TeamTopics pool={pool()} />)
    expect(screen.getByText('CV 1 · no topic 1 · you: CV')).toBeInTheDocument()
    expect(screen.getByText(/CV Computer Vision · ZZ\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'CV', checked: true })) // already chosen: nothing to save
    fireEvent.click(within_row('Ann').getByRole('radio', { name: 'No topic', checked: true }))
  })

  it('opens for someone with no topic and says when a save fails', async () => {
    withQuery(<TeamTopics pool={pool({ me: 'Nobody', people: [{ name: 'Ann', topic: '' }] })} />)
    expect(screen.getByText('no topic 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'CV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Labels cannot be saved yet.')
  })
})

function within_row(name: string) {
  const group = screen.getByRole('radiogroup', { name: `Topic for ${name}` })
  return {
    getByRole: (role: string, options: Parameters<typeof screen.getByRole>[1]) => {
      const found = screen.getAllByRole(role, options).find((el) => group.contains(el))
      if (!found) throw new Error(`no ${role} in ${name}`)
      return found
    },
  }
}

describe('TopicSelect', () => {
  it('names a known topic and shows an unknown one as it is', () => {
    const onChange = vi.fn()
    render(<TopicSelect label="Topic" value="" topics={['NLP', 'XX']} empty="Choose" onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'NLP · Natural Language Processing' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'XX' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Topic' }), { target: { value: 'XX' } })
    expect(onChange).toHaveBeenCalledWith('XX')
  })
})

describe('UploadPdfButton', () => {
  const pdf = new File(['x'], 'paper.pdf', { type: 'application/pdf' })
  const input = () => document.querySelector('input[type="file"]') as HTMLInputElement

  it('hands over the PDF the person picks, and ignores a cancelled picker', () => {
    const onFile = vi.fn()
    render(<UploadPdfButton title="Paper" busy={false} onFile={onFile} />)
    const click = vi.spyOn(input(), 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Upload the PDF of Paper' }))
    expect(click).toHaveBeenCalled()

    fireEvent.change(input(), { target: { files: [] } })
    expect(onFile).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { files: [pdf] } })
    expect(onFile).toHaveBeenCalledWith(pdf)
  })

  it('says Uploading and turns the button off while busy', () => {
    render(<UploadPdfButton title="Paper" busy onFile={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Uploading of Paper' })).toBeDisabled()
  })

  it('turns the button off while another action runs', () => {
    render(<UploadPdfButton title="Paper" busy={false} disabled onFile={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Upload the PDF of Paper' })).toBeDisabled()
  })
})

describe('VenueRankBadge', () => {
  it('shows nothing without a rank', () => {
    const { container } = render(<VenueRankBadge value="" source="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says a venue is unranked', () => {
    render(<VenueRankBadge value="unranked" source="" />)
    expect(screen.getByText('Venue unranked')).toBeInTheDocument()
  })

  it('shows the rank with or without where it comes from', () => {
    const { unmount } = render(<VenueRankBadge value="Q1" source="CiteScore 2025" />)
    expect(screen.getByTitle('Venue rank Q1, CiteScore 2025')).toHaveTextContent('Q1· CiteScore 2025')
    unmount()
    render(<VenueRankBadge value="A*" source="" />)
    expect(screen.getByTitle('Venue rank A*')).toHaveTextContent('A*')
  })
})
