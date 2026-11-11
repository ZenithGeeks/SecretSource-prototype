/** ClaimCard: the collapsed row, the open card with its evidence panels, and the cited works. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ findInPaper: vi.fn() }))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  api: { findInPaper: gateway.findInPaper, disputeVerdict: vi.fn() },
}))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: () => ({ url: 'blob:img', failed: false }) }))

import { ClaimCard } from '../src/components/ClaimCard'
import type { Target } from '../src/components/PageViewer'
import type { Citation, Claim, Dispute, PaperFigure, Standing, Verdict } from '../src/lib/api'
import { standingOf } from '../src/lib/claims'

const cite = (extra: Partial<Citation> = {}): Citation => ({
  title: 'Batch Normalization',
  authors: ['Ioffe', 'Szegedy'],
  year: '2015',
  doi: '10.1/bn',
  arxiv: '',
  url: '',
  ...extra,
})

const verdict = (extra: Partial<Verdict> = {}): Verdict => ({
  verdict: 'supports',
  quote: '',
  reasoning: 'It agrees.',
  source: 'bn.pdf',
  cited: '10.1/bn',
  evidence: [],
  ...extra,
})

const location = { page: 4, boxes: [{ x0: 1, y0: 2, x1: 3, y1: 4 }], page_width: 100, page_height: 200 }

type Props = Partial<React.ComponentProps<typeof ClaimCard>>

function card(claim: Partial<Claim> = {}, props: Props = {}) {
  const full: Claim = { claim: 'Training is faster.', citations: [cite()], ...claim }
  const standing: Standing = props.standing ?? standingOf(full)
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ClaimCard claim={full} index={0} standing={standing} {...props} />
    </QueryClientProvider>,
  )
}

const open = () => fireEvent.click(screen.getByRole('button', { expanded: false }))

beforeEach(() => {
  vi.clearAllMocks()
  gateway.findInPaper.mockResolvedValue({ page: null, boxes: [] })
})

describe('the collapsed row', () => {
  it('starts collapsed for a claim that needs no reading and shows what it cites', () => {
    card({ verdicts: [verdict()] })
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Training is faster.')
    expect(screen.getByText('Ioffe et al. 2015')).toBeInTheDocument()
  })

  it('says when nothing is cited', () => {
    card({ citations: [] })
    expect(screen.getByText('Nothing cited for this claim')).toBeInTheDocument()
  })

  it('stays collapsed on request, whatever the verdict', () => {
    card({ verdicts: [verdict({ verdict: 'refutes' })] }, { startCollapsed: true })
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  it('names a cited work by its title, its arXiv id or as untitled, and omits a missing year', () => {
    card({
      citations: [
        cite({ authors: [], title: 'Only a title' }),
        cite({ authors: [], title: '', arxiv: '1502.03167', year: '' }),
        cite({ authors: [], title: '', year: '' }),
        cite({ authors: ['Solo'], year: '' }),
      ],
    }, { startCollapsed: true })
    expect(screen.getByRole('button')).toHaveTextContent('Only a title 2015 · arXiv:1502.03167 · Untitled · Solo')
  })

  it('names a work that has no title by its venue, as the card did before (#937)', () => {
    const journal = 'Journal of Instrumentation'
    card({ citations: [cite({ authors: [], title: '', venue: journal, year: '2008', doi: '' })] }, { startCollapsed: true })
    expect(screen.getByRole('button')).toHaveTextContent(`${journal} 2008`)
    expect(screen.getByRole('button')).not.toHaveTextContent('Untitled')
  })

  it('tells the owner which claim was opened', () => {
    const onSelect = vi.fn()
    card({ verdicts: [verdict()] }, { onSelect })
    open()
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

describe('the open card', () => {
  it('shows the section and page, and the claim when it paraphrases the sentence', () => {
    card(
      { sentence: 'Batch norm trains networks much faster.', source: location },
      { section: 'Section 3.3 · Representation' },
    )
    expect(screen.getByText('§3.3 Representation · page 4')).toBeInTheDocument()
    expect(screen.getByText('Training is faster.')).toBeInTheDocument()
    expect(screen.getByText('This paper · page 4')).toBeInTheDocument()
  })

  it('leaves the claim out when it is the sentence word for word', () => {
    card({ claim: 'Training is faster!', sentence: 'training is   faster' })
    expect(screen.queryByText('Training is faster!')).not.toBeInTheDocument()
    expect(screen.getByText('This paper')).toBeInTheDocument()
  })

  it('shows the claim alone when there is no sentence and no answer', () => {
    card({ citations: [cite()], named: [] })
    expect(screen.getByText('Training is faster.')).toBeInTheDocument()
    expect(screen.getByText('Not checked — verification did not run.')).toBeInTheDocument()
  })

  it('says a claim that cites nothing cites nothing', () => {
    card({ citations: [] })
    open()
    expect(screen.getByText(/cites nothing, so there is no source to check it/)).toBeInTheDocument()
  })

  it('shows teacher controls under the claim', () => {
    card({ citations: [] }, { actions: <button>Professor result</button> })
    open()
    expect(screen.getByRole('button', { name: 'Professor result' })).toBeInTheDocument()
  })

  it('writes the sentence as the paper prints it, with its reference numbers', () => {
    card(
      {
        sentence: 'Faster training [b1] [b2] and fewer steps [b9].',
        citations: [cite({ ref: 'b1', label: '13' })],
      },
      { references: { b2: cite({ ref: 'b2', label: '14' }) } },
    )
    expect(screen.getByText(/Faster training \[13, 14\] and fewer steps\./)).toBeInTheDocument()
  })

  it('opens the paper at the claim from the paper panel', () => {
    const onShow = vi.fn<(target: Target) => void>()
    card({ sentence: 'It is faster.', source: location }, { paper: 'mine.pdf', onShow })
    fireEvent.click(screen.getByRole('button', { name: /Show in paper/ }))
    expect(onShow).toHaveBeenCalledWith({
      paper: 'mine.pdf',
      label: 'Claim 1 in this paper',
      quote: 'It is faster.',
      source: location,
    })
  })

  it('offers no way to open the paper without a viewer, a paper or a location', () => {
    card({ sentence: 'It is faster.', source: location }, { paper: 'mine.pdf' })
    expect(screen.queryByRole('button', { name: /Show in paper/ })).not.toBeInTheDocument()
  })
})

describe('the sentence and its figures', () => {
  const figures: PaperFigure[] = [
    { label: 'Figure 2', page: 5, caption: 'Figure 2: Accuracy.', image: 'figures/x/figure-2.png' },
    { label: 'Figure 3', page: 6, caption: 'Figure 3: Loss.', image: 'figures/x/figure-3.png' },
  ]
  const sentence = 'See Figure 2, then Fig. 2 again, and Fig 4 and figure 3b.'

  it('links each figure the paper has and leaves other mentions as text', () => {
    const onShow = vi.fn<(target: Target) => void>()
    card({ sentence }, { paper: 'mine.pdf', figures, onShow })
    fireEvent.click(screen.getByRole('button', { name: 'Figure 2' }))
    expect(onShow).toHaveBeenCalledWith({ paper: 'mine.pdf', label: 'Figure 2 in this paper', source: null, page: 5 })
    expect(screen.getByRole('button', { name: 'Fig. 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fig 4' })).not.toBeInTheDocument()
  })

  it('shows each named figure once, with its caption', () => {
    card({ sentence }, { paper: 'mine.pdf', figures, onShow: vi.fn() })
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByTitle('Figure 2: Accuracy.')).toBeInTheDocument()
  })

  it('opens the figure from its picture', () => {
    const onShow = vi.fn<(target: Target) => void>()
    card({ sentence: 'See Figure 3.' }, { paper: 'mine.pdf', figures, onShow })
    fireEvent.click(screen.getByRole('img').closest('button') as HTMLElement)
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ page: 6 }))
  })

  it('shows the figure but cannot open it without a viewer', () => {
    card({ sentence: 'See Figure 3.' }, { paper: 'mine.pdf', figures })
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Figure 3/ })).toBeDisabled()
  })

  it('shows plain text without a paper or without figures', () => {
    card({ sentence: 'See Figure 2.' }, { figures })
    expect(screen.getByText(/See Figure 2\./)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('the answer a claim leads with', () => {
  it('shows the deciding quote with its page, and looks it up in the cited paper', async () => {
    const onShow = vi.fn<(target: Target) => void>()
    gateway.findInPaper.mockResolvedValue({ ...location, page: 7 })
    card(
      {
        verdicts: [
          verdict({
            verdict: 'refutes',
            quote: 'Normalisation hurts.',
            evidence: [{ text: 'On page 7: normalisation   HURTS. More', page: 7, start: 0, end: 5, score: 1 }],
          }),
        ],
      },
      { onShow },
    )
    expect(screen.getByText('Ioffe et al. 2015 · page 7')).toBeInTheDocument()
    expect(screen.getByText('Why it doesn’t hold')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(onShow).toHaveBeenCalled())
    expect(gateway.findInPaper).toHaveBeenCalledWith('bn.pdf', 'Normalisation hurts.', 7)
    expect(onShow).toHaveBeenCalledWith(
      expect.objectContaining({ paper: 'bn.pdf', page: 7, verdict: 'refutes', source: expect.objectContaining({ page: 7 }) }),
    )
  })

  it('looks through the whole paper when the quote is not on the passage page, and shows the page when still not found', async () => {
    const onShow = vi.fn<(target: Target) => void>()
    gateway.findInPaper.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ page: null, boxes: [] })
    card(
      { verdicts: [verdict({ quote: 'q', evidence: [{ text: 'q', page: 3, start: 0, end: 1, score: 1 }] })] },
      { onShow, startCollapsed: false, standing: 'insufficient' },
    )
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(onShow).toHaveBeenCalled())
    expect(gateway.findInPaper).toHaveBeenNthCalledWith(1, 'bn.pdf', 'q', 3)
    expect(gateway.findInPaper).toHaveBeenNthCalledWith(2, 'bn.pdf', 'q')
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ source: null, page: 3 }))
  })

  it('shows the page when the lookup fails altogether and there is no page to fall back to', async () => {
    const onShow = vi.fn<(target: Target) => void>()
    gateway.findInPaper.mockRejectedValue(new Error('down'))
    card({ verdicts: [verdict({ quote: 'q' })] }, { onShow, startCollapsed: false, standing: 'insufficient' })
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(onShow).toHaveBeenCalled())
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ source: null, page: undefined }))
  })

  it('shows the page when the whole-paper search fails too', async () => {
    const onShow = vi.fn<(target: Target) => void>()
    gateway.findInPaper.mockResolvedValueOnce({ page: null, boxes: [] }).mockRejectedValueOnce(new Error('down'))
    card(
      { verdicts: [verdict({ quote: 'q', evidence: [{ text: 'q', page: 3, start: 0, end: 1, score: 1 }] })] },
      { onShow, standing: 'insufficient' },
    )
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(onShow).toHaveBeenCalled())
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ source: null, page: 3 }))
  })

  it('finds no page for a quote of only spaces', () => {
    card({ verdicts: [verdict({ quote: '   ', evidence: [{ text: 'a', page: 3, start: 0, end: 1, score: 1 }] })] }, { standing: 'insufficient' })
    expect(screen.getByText('Ioffe et al. 2015')).toBeInTheDocument()
  })

  it('does not look anything up when there is no viewer', async () => {
    card({ verdicts: [verdict({ quote: 'q' })] }, { standing: 'insufficient' })
    expect(screen.queryByRole('button', { name: /Show in cited paper/ })).not.toBeInTheDocument()
  })

  it('says no passage matched when the verdict has no quote', () => {
    card({ verdicts: [verdict({ verdict: 'insufficient' })] })
    expect(screen.getByText('No passage in the cited paper matched this claim.')).toBeInTheDocument()
    expect(screen.getByText('Why it isn’t settled')).toBeInTheDocument()
  })

  it('names the source by its file when the claim holds no matching citation', () => {
    card({ citations: [], verdicts: [verdict({ verdict: 'insufficient', cited: undefined })] })
    expect(screen.getAllByText(/bn\.pdf/).length).toBeGreaterThan(0)
  })

  it('folds a long explanation behind Read all', () => {
    card({ verdicts: [verdict({ verdict: 'insufficient', reasoning: 'long '.repeat(80) })] })
    const toggle = screen.getByRole('button', { name: 'Read all' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Read all' })).toBeInTheDocument()
  })

  it('says when the verdict was read off the arXiv copy', () => {
    card({ verdicts: [verdict({ verdict: 'insufficient', source_version: 'preprint', arxiv: '1502.03167' })] })
    expect(screen.getByText(/Checked against the arXiv preprint 1502\.03167\. Its wording/)).toBeInTheDocument()
  })

  it('says it without an id when the copy has none', () => {
    card({ verdicts: [verdict({ verdict: 'insufficient', source_version: 'preprint' })] })
    expect(screen.getByText(/Checked against the arXiv preprint\. Its wording/)).toBeInTheDocument()
  })

  it('lets the owner dispute the verdict they were shown', () => {
    const disputes: Dispute[] = [
      { claim: 1, source: 'bn.pdf', note: 'other claim', at: 1 },
      { claim: 0, source: 'bn.pdf', note: 'wrong page', at: 1 },
    ]
    card({ verdicts: [verdict({ verdict: 'insufficient' })] }, { analysisId: 'a1', disputes })
    expect(screen.getByText('You disagreed: “wrong page”')).toBeInTheDocument()
  })

  it('offers no dispute without an analysis id', () => {
    card({ verdicts: [verdict({ verdict: 'insufficient' })] })
    expect(screen.queryByText(/Checked by an AI judge/)).not.toBeInTheDocument()
  })
})

describe('pages, crops and passages of the leading answer', () => {
  const pages = [
    { page: 3, score: 1, kind: 'page' as const },
    { page: 8, score: 1, kind: 'table' as const, label: '  ', image: 'f/table-3.png', region: location },
    { page: 9, score: 1, kind: 'figure' as const, label: 'Figure 4', caption: 'Figure 4: A graph.', image: 'f/figure-4.png' },
    { page: 10, score: 1, label: 'Figure 5', caption: 'A graph of loss.', image: 'f/figure-5.png' },
    { page: 11, score: 1, label: 'Figure 6', image: 'f/figure-6.png' },
  ]
  const evidence = [{ text: 'A passage.', page: 2, start: 0, end: 1, score: 1 }]
  const onShow = vi.fn<(target: Target) => void>()

  beforeEach(() => onShow.mockClear())

  it('opens a page chip at its page with the located crop box', () => {
    card({ verdicts: [verdict({ pages, page_model: 'vidore/colqwen2-v1.0' })] }, { onShow, standing: 'supports', startCollapsed: false })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Page 8 in the cited paper' }))
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ page: 8, source: location, label: 'page 8 of bn.pdf' }))
    expect(screen.getByRole('button', { name: 'Figure 4 in the cited paper' })).toHaveAttribute(
      'title',
      'Found by searching page images with ColQwen2 v1.0',
    )
  })

  it('names the model by its checkpoint when it has no repo path', () => {
    card({ verdicts: [verdict({ pages, page_model: 'colpali' })] }, { onShow })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('button', { name: 'Figure 4 in the cited paper' })).toHaveAttribute('title', 'Found by searching page images with ColPali')
  })

  it('shows chips as plain labels without a viewer', () => {
    card({ verdicts: [verdict({ pages })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Figure 4 in the cited paper')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Figure 4 in the cited paper' })).not.toBeInTheDocument()
  })

  it('shows the crops of figures and tables, not of whole pages, with a stutter-free caption', () => {
    card({ verdicts: [verdict({ pages })] }, { onShow })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByText('Figure 4: A graph.')).toBeInTheDocument()
    expect(screen.getByText('Figure 5: A graph of loss.')).toBeInTheDocument()
    expect(screen.getByText('Figure 6')).toBeInTheDocument()
    expect(screen.getByText('page 8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show Figure 4 on its page in bn.pdf' }))
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ page: 9 }))
  })

  it('shows crops without buttons when there is no viewer', () => {
    card({ verdicts: [verdict({ pages })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByRole('button', { name: /on its page in/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(4)
  })

  it('says a table the verdict rests on is a table, and a crop without a kind a figure', () => {
    card({ verdicts: [verdict({ pages, verdict_from: 'figure', judged_figure: 'table-3.png' })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('The verdict rests on this table')).toBeInTheDocument()
  })

  it('says a kind-less crop is a figure', () => {
    card({ verdicts: [verdict({ pages, verdict_from: 'figure', judged_figure: 'figure-5.png' })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('The verdict rests on this figure')).toBeInTheDocument()
  })

  it('has no judged crop unless the judge named a figure', () => {
    card({ verdicts: [verdict({ pages, verdict_from: 'figure' })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByText(/The verdict rests on/)).not.toBeInTheDocument()
  })

  it('shows no crops for pages without images', () => {
    card({ verdicts: [verdict({ pages: [pages[0]] })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('lists the retrieved passages on request and opens one in the cited paper', async () => {
    gateway.findInPaper.mockResolvedValue({ ...location, page: 2 })
    card({ verdicts: [verdict({ evidence })] }, { onShow })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const toggle = screen.getByRole('button', { name: '1 more passages' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'p. 2' }))
    await waitFor(() => expect(onShow).toHaveBeenCalled())
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ label: 'Passage in bn.pdf', quote: 'A passage.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide passages' }))
    expect(screen.queryByText('A passage.')).not.toBeInTheDocument()
  })

  it('lists passages with a plain page number when there is no viewer', () => {
    card({ verdicts: [verdict({ evidence })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: '1 more passages' }))
    expect(screen.getByText('p. 2')).toBeInTheDocument()
    expect(screen.getByText('A passage.')).toBeInTheDocument()
  })
})

describe('the other cited works', () => {
  const second = cite({ title: 'Layer Norm', doi: '10.1/ln', authors: ['Ba'], year: '2016', label: '7', url: '' })
  const third = cite({ title: 'Web page', doi: '', arxiv: '', url: 'https://example.org/p', authors: [], year: '' })

  it('shows a one-line answer that opens to the quote, the reasoning and the pages', () => {
    const onShow = vi.fn<(target: Target) => void>()
    card(
      {
        citations: [cite(), second],
        verdicts: [
          verdict({ verdict: 'refutes', reasoning: 'Main.' }),
          verdict({
            cited: '10.1/ln',
            source: 'ln.pdf',
            quote: 'Layer norm helps.',
            reasoning: 'Second reasoning.',
            evidence: [{ text: 'Layer norm helps.', page: 5, start: 0, end: 1, score: 1 }],
            pages: [{ page: 5, score: 1 }],
          }),
        ],
      },
      { onShow },
    )
    expect(screen.getByText('[7]')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Layer norm helps\./ })
    fireEvent.click(row)
    expect(screen.getByText('What the cited paper says · page 5')).toBeInTheDocument()
    expect(screen.getByText('Second reasoning.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Page 5 in the cited paper' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 more passages' }))
    expect(screen.getByText('p. 5')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { expanded: true })[1])
    expect(screen.getByRole('button', { name: /Layer norm helps\./ })).toBeInTheDocument()
  })

  it('opens an answer that has no quote straight to its reasoning', () => {
    card({
      citations: [cite(), second],
      verdicts: [verdict({ verdict: 'refutes' }), verdict({ cited: '10.1/ln', source: 'ln.pdf', verdict: 'insufficient', reasoning: 'Silent here.' })],
    })
    fireEvent.click(screen.getByRole('button', { name: /Silent here\./ }))
    expect(screen.getByText('Why it isn’t settled')).toBeInTheDocument()
    expect(screen.queryByText(/What the cited paper says/)).not.toBeInTheDocument()
  })

  it('looks up the deciding quote of an opened answer when there is a viewer, and offers nothing without one', async () => {
    const onShow = vi.fn<(target: Target) => void>()
    const claim = {
      citations: [cite(), second],
      verdicts: [verdict({ verdict: 'refutes' }), verdict({ cited: '10.1/ln', source: 'ln.pdf', quote: 'qq' })],
    }
    const { unmount } = card(claim, { onShow })
    fireEvent.click(screen.getByRole('button', { name: /qq/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show in cited paper/ }))
    await waitFor(() => expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ paper: 'ln.pdf', quote: 'qq' })))
    unmount()
    card(claim)
    fireEvent.click(screen.getByRole('button', { name: /qq/ }))
    expect(screen.queryByRole('button', { name: /Show in cited paper/ })).not.toBeInTheDocument()
  })

  it('shows a failure with the server message, or without one', () => {
    card({
      citations: [cite(), second],
      unchecked: [
        { source: '10.1/bn', reason: 'withdrawn', message: '' },
        { source: '10.1/ln', reason: 'no-open-access', message: 'HTTP 403' },
      ],
    })
    expect(screen.getByText('— withdrawn by its authors on arXiv')).toBeInTheDocument()
    expect(screen.getByText('HTTP 403')).toBeInTheDocument()
  })

  it('links a work by its DOI, or by its url, or not at all', () => {
    card({ citations: [cite(), third, cite({ title: 'No link', doi: '', url: '' })] })
    expect(screen.getByRole('link', { name: /Ioffe et al\. \(2015\)/ })).toHaveAttribute('href', 'https://doi.org/10.1/bn')
    expect(screen.getByRole('link', { name: /Web page/ })).toHaveAttribute('href', 'https://example.org/p')
    expect(screen.queryByRole('link', { name: /No link/ })).not.toBeInTheDocument()
  })

  it('says a work only named by the claim was not checked', () => {
    card({ citations: [cite()], named: ['10.1/bn'] })
    open()
    expect(screen.getByText('Not checked — the claim only names this as something the paper used.')).toBeInTheDocument()
  })

  it('shows answers and failures that name no citation the claim holds', () => {
    card({
      citations: [cite()],
      verdicts: [verdict({ verdict: 'refutes' }), verdict({ verdict: 'insufficient', cited: 'stray', source: 'stray.pdf', reasoning: 'Stray reasoning.' })],
      unchecked: [{ source: 'lost', reason: 'failed', message: '' }],
    })
    const loose = screen.getByTitle('stray.pdf').parentElement as HTMLElement
    fireEvent.click(within(loose).getByRole('button'))
    expect(screen.getByText('Stray reasoning.')).toBeInTheDocument()
    expect(screen.getByTitle('lost')).toBeInTheDocument()
  })
})
