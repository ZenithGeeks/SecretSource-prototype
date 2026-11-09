/** The small pieces of the labeler: filters, claim strip, label form, save bar and friends. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async () => {
    throw new Error('503: not set up')
  }),
}))

import { emptyDraft, emptyLabel, type Draft, type Pool, type WorkClaim } from '../src/lib/labeling'
import { ClaimDecision } from '../src/roles/labeler/components/ClaimDecision'
import { ClaimNav } from '../src/roles/labeler/components/ClaimNav'
import { LabelForm } from '../src/roles/labeler/components/LabelForm'
import { NoMatch, PaperFilters } from '../src/roles/labeler/components/PaperFilters'
import { SaveBar } from '../src/roles/labeler/components/SaveBar'
import { SelectionBar } from '../src/roles/labeler/components/SelectionBar'
import { TeamTopics } from '../src/roles/labeler/components/TeamTopics'
import { TopicSelect } from '../src/roles/labeler/components/TopicSelect'
import { UploadPdfButton } from '../src/roles/labeler/components/UploadPdfButton'
import { VenueRankBadge } from '../src/roles/labeler/components/VenueRankBadge'
import { NO_FILTERS, readFilters, valueLabel, writeFilters, type Paper } from '../src/roles/labeler/paperFilters'

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
    render(<ClaimNav {...props} />)
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
})

describe('ClaimDecision', () => {
  it('lets the person write the edited claim', () => {
    const onChange = vi.fn()
    render(<ClaimDecision claim={claim('c1', 'Original.')} position={1} count={2} draft={{ ...emptyDraft(), status: 'edited', edited: 'Mine' }} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'The claim, as it should read' }), { target: { value: 'Mine, better' } })
    expect(onChange).toHaveBeenCalledWith({ edited: 'Mine, better' })
  })
})

describe('LabelForm', () => {
  it('shows who else labeled the pair, and sends each change', () => {
    const onChange = vi.fn()
    render(<LabelForm title="Ref B" active label={{ ...emptyLabel(), evidence: 3 }} others={['Somchai', 'Ann']} onChange={onChange} />)
    expect(screen.getByText('Also labeled by Somchai, Ann. Label it yourself, without looking.')).toBeInTheDocument()
    expect(screen.getByText('Level 3, Clear: The passage backs the claim, with a gap in scope or detail.')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 3, rationale: 'because' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 3, confidence: 'high' })
    fireEvent.click(screen.getByRole('radio', { name: '4 · Strong' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyLabel(), evidence: 4 })
  })

  it('asks for a level when there is no label yet', () => {
    render(<LabelForm title="Ref B" active={false} label={undefined} others={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Pick 1–4, or press the number key.')).toBeInTheDocument()
  })
})

describe('SaveBar', () => {
  const bar = (over: Partial<Parameters<typeof SaveBar>[0]> = {}) => {
    const props = { left: [], dirty: true, saving: false, error: null, savedRows: null, hasNext: true, onSave: vi.fn(), ...over }
    render(<SaveBar {...props} />)
    return props
  }

  it('lists what is left, shows the error, and saves with or without moving on', () => {
    const props = bar({ left: ['Give Ref B a level'], error: 'offline' })
    expect(screen.getByText('• Give Ref B a level')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: offline')
    expect(screen.getByText('Unsaved changes · Ctrl/⌘+S saves')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save labels' }))
    expect(props.onSave).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save and next claim' }))
    expect(props.onSave).toHaveBeenLastCalledWith(true)
  })

  it('says how many rows were saved, in the singular too', () => {
    bar({ dirty: false, savedRows: 1, hasNext: false })
    expect(screen.getByText('Every decision for this claim is made.')).toBeInTheDocument()
    expect(screen.getByText('Saved 1 row')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and next claim' })).not.toBeInTheDocument()
  })

  it('says rows in the plural, and when nothing changed', () => {
    const { unmount } = render(<SaveBar left={[]} dirty={false} saving={false} error={null} savedRows={3} hasNext onSave={vi.fn()} />)
    expect(screen.getByText('Saved 3 rows')).toBeInTheDocument()
    unmount()
    render(<SaveBar left={[]} dirty={false} saving error={null} savedRows={null} hasNext onSave={vi.fn()} />)
    expect(screen.getByText('Nothing changed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save labels' })).toBeDisabled()
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
