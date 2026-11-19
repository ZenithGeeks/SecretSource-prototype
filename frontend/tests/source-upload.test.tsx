/** The owner uploads a PDF for an unchecked citation, and the card follows the re-check (#986). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  getAnalysis: vi.fn(),
  uploadReferencePdf: vi.fn(),
  onStages: vi.fn(() => () => {}),
  findInPaper: vi.fn(),
  disputeVerdict: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  api: {
    getAnalysis: gateway.getAnalysis,
    uploadReferencePdf: gateway.uploadReferencePdf,
    onStages: gateway.onStages,
    findInPaper: gateway.findInPaper,
    disputeVerdict: gateway.disputeVerdict,
  },
}))
vi.mock('../src/lib/useAuthorizedUrl', () => ({ useAuthorizedUrl: () => ({ url: 'blob:img', failed: false }) }))
vi.mock('../src/components/PageViewer', () => ({ PageViewer: () => <div data-testid="viewer" /> }))

import { AnalysisView } from '../src/components/AnalysisView'
import { ClaimCard } from '../src/components/ClaimCard'
import type { Analysis, Citation, Claim, Stage, Verdict } from '../src/lib/api'
import { fromUploadedPdf, recheckStage, refsRechecking, sourceUploadMessage } from '../src/lib/sourceUpload'

const gmres: Citation = {
  title: 'GMRES', authors: ['Saad', 'Schultz'], year: '1986', doi: '', arxiv: '', url: '', ref: 'b13',
}
const other: Citation = {
  title: 'Another paper', authors: ['Ada'], year: '2020', doi: '10.1/other', arxiv: '', url: '', ref: 'b2',
}

const uncheckedClaim = (): Claim => ({
  claim: 'GMRES minimises the residual.',
  citations: [gmres],
  unchecked: [{ source: 'GMRES', reason: 'no-open-access', message: 'no open-access PDF' }],
})

const supports = (extra: Partial<Verdict> = {}): Verdict => ({
  verdict: 'supports',
  quote: 'The residual is minimised.',
  reasoning: 'Saad and Schultz show it.',
  source: 'gmres-abc.pdf',
  cited: 'GMRES',
  evidence: [],
  ...extra,
})

function analysis(extra: Partial<Analysis> = {}): Analysis {
  return {
    id: 'a1',
    paper: 'p.pdf',
    file: 'dir/mine.pdf',
    status: 'done',
    claims: [uncheckedClaim()],
    stages: [{ stage: 'done' }],
    ...extra,
  }
}

function checked(): Analysis {
  return analysis({
    pdfs: { b13: 'gmres-abc.pdf' },
    stages: [{ stage: 'done' }, { stage: 'rechecking', ref: 'b13' }, { stage: 'rechecked', ref: 'b13' }],
    claims: [{ ...uncheckedClaim(), unchecked: [], verdicts: [supports()] }],
  })
}

const pdf = () => new File(['%PDF-1.4'], 'gmres.pdf', { type: 'application/pdf' })

function clientWrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  gateway.findInPaper.mockResolvedValue({ page: null, boxes: [] })
  gateway.uploadReferencePdf.mockResolvedValue({ ref: 'b13', pdf: 'gmres-abc.pdf' })
})

describe('re-check stages', () => {
  const stage = (name: Stage['stage'], ref?: string): Stage => ({ stage: name, ref })

  it('keeps the latest stage for a reference and ignores the rest', () => {
    const stages = [
      stage('done'),
      stage('rechecking'),
      stage('rechecking', 'b2'),
      stage('rechecked', 'b2'),
      stage('rechecking', 'b13'),
      stage('verified'),
      stage('rechecked', 'b13'),
      stage('rechecking', 'b13'),
    ]
    expect(recheckStage(stages, 'b13')).toBe('rechecking')
    expect(recheckStage(stages, 'b2')).toBe('rechecked')
    expect(recheckStage(stages, 'b99')).toBeUndefined()
    expect(recheckStage([], 'b13')).toBeUndefined()
    expect(refsRechecking(stages)).toEqual(['b13'])
    expect(refsRechecking([stage('done'), stage('rechecked', 'b2')])).toEqual([])
  })
})

describe('whether a verdict came from an upload', () => {
  it('is true only when the citation’s ref is one the owner uploaded', () => {
    const pdfs = { b13: 'gmres-abc.pdf' }
    expect(fromUploadedPdf(pdfs, gmres)).toBe(true)
    expect(fromUploadedPdf(pdfs, other)).toBe(false)
    expect(fromUploadedPdf(undefined, gmres)).toBe(false)
    expect(fromUploadedPdf(pdfs)).toBe(false)
    expect(fromUploadedPdf(pdfs, { ...gmres, ref: '' })).toBe(false)
    expect(fromUploadedPdf(pdfs, { ...gmres, ref: undefined })).toBe(false)
  })
})

describe('upload error messages', () => {
  it('names a file that is too large or not a PDF, and stays general otherwise', () => {
    expect(sourceUploadMessage(new Error('413: {"detail":"the PDF must be 100 MB or smaller"}'))).toBe(
      'That PDF is over 100 MB. Choose a smaller file.',
    )
    expect(sourceUploadMessage(new Error('422: {"detail":"the file is not a PDF"}'))).toBe('That file is not a PDF.')
    expect(sourceUploadMessage(new Error('500: down'))).toBe('The PDF could not be uploaded. Try again.')
    expect(sourceUploadMessage('nope')).toBe('The PDF could not be uploaded. Try again.')
  })
})

describe('the upload action on a claim card', () => {
  function card(claim: Claim = uncheckedClaim(), props: Partial<React.ComponentProps<typeof ClaimCard>> = {}) {
    return clientWrap(
      <ClaimCard
        claim={claim}
        index={0}
        standing="unchecked"
        ownsAnalysis
        sourceUpload={{ analysisId: 'a1', onUploaded: async () => {} }}
        {...props}
      />,
    )
  }

  const input = () => screen.getByLabelText('Upload source PDF')

  it('shows the action on an unchecked citation and posts the chosen PDF', async () => {
    card()
    expect(screen.getByText(/no free copy published/)).toBeInTheDocument()
    fireEvent.change(input(), { target: { files: [] } })
    fireEvent.change(input(), { target: { files: null } })
    expect(gateway.uploadReferencePdf).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { files: [pdf()] } })
    await waitFor(() => expect(gateway.uploadReferencePdf).toHaveBeenCalledWith('a1', 'b13', expect.any(File)))
    expect(gateway.uploadReferencePdf.mock.calls[0][2]).toBeInstanceOf(File)
  })

  it('shows the citation as checking while the re-check runs, from the stages or from the upload itself', async () => {
    card(uncheckedClaim(), { stages: [{ stage: 'rechecking', ref: 'b13' }] })
    expect(screen.getByRole('status')).toHaveTextContent('Checking the uploaded PDF…')
    expect(screen.queryByLabelText('Upload source PDF')).not.toBeInTheDocument()
  })

  it('brings the action back when the re-check ends and the citation is still unchecked', async () => {
    let release: (value: { ref: string; pdf: string }) => void = () => {}
    gateway.uploadReferencePdf.mockReturnValue(new Promise((resolve) => { release = resolve }))
    function Harness() {
      const [stages, setStages] = useState<Stage[]>([{ stage: 'done' }])
      return (
        <ClaimCard
          claim={uncheckedClaim()}
          index={0}
          standing="unchecked"
          ownsAnalysis
          stages={stages}
          sourceUpload={{
            analysisId: 'a1',
            onUploaded: async () => setStages([
              { stage: 'done' },
              { stage: 'rechecking', ref: 'b13' },
              { stage: 'rechecked', ref: 'b2' },
              { stage: 'rechecked', ref: 'b13' },
            ]),
          }}
        />
      )
    }
    clientWrap(<Harness />)
    fireEvent.change(screen.getByLabelText('Upload source PDF'), { target: { files: [pdf()] } })
    expect(await screen.findByRole('status')).toHaveTextContent('Checking the uploaded PDF…')
    release({ ref: 'b13', pdf: 'gmres-abc.pdf' })
    expect(await screen.findByLabelText('Upload source PDF')).toBeInTheDocument()
  })

  it('stays on checking when the refetch after a successful upload fails', async () => {
    card(uncheckedClaim(), { sourceUpload: { analysisId: 'a1', onUploaded: async () => { throw new Error('refetch failed') } } })
    fireEvent.change(input(), { target: { files: [pdf()] } })
    expect(await screen.findByRole('status')).toHaveTextContent('Checking the uploaded PDF…')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when the file is over 100 MB or is not a PDF', async () => {
    gateway.uploadReferencePdf.mockRejectedValueOnce(new Error('413: {"detail":"the PDF must be 100 MB or smaller"}'))
    card()
    fireEvent.change(input(), { target: { files: [pdf()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That PDF is over 100 MB. Choose a smaller file.')

    gateway.uploadReferencePdf.mockRejectedValueOnce(new Error('422: {"detail":"the file is not a PDF"}'))
    fireEvent.change(input(), { target: { files: [new File(['<html>'], 'page.html', { type: 'text/html' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a PDF.')

    gateway.uploadReferencePdf.mockRejectedValueOnce('nope')
    fireEvent.change(input(), { target: { files: [pdf()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('The PDF could not be uploaded. Try again.')
  })

  it('offers no action without a ref, and says a second citation’s verdict came from the owner’s PDF', () => {
    const first = card({ ...uncheckedClaim(), citations: [{ ...gmres, ref: undefined }] })
    expect(screen.queryByLabelText('Upload source PDF')).not.toBeInTheDocument()
    first.unmount()

    const claim: Claim = {
      claim: 'Two sources.',
      citations: [other, gmres],
      verdicts: [
        supports({ verdict: 'refutes', cited: '10.1/other', source: 'other.pdf', quote: 'No.', reasoning: 'The other paper disagrees.' }),
        supports({ verdict: 'insufficient', quote: 'From the upload.', reasoning: 'Read from the upload.' }),
      ],
    }
    clientWrap(
      <ClaimCard claim={claim} index={1} standing="refutes" pdfs={{ b13: 'gmres-abc.pdf' }} ownsAnalysis={false} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /From the upload/ }))
    expect(screen.getByText('This verdict was read from a PDF the analysis owner uploaded.')).toBeInTheDocument()
  })
})

describe('the action in the analysis', () => {
  it('lets the owner upload, then shows the verdict from the refetched analysis', async () => {
    let uploaded = false
    gateway.getAnalysis.mockImplementation(async () => (uploaded ? checked() : analysis()))
    gateway.uploadReferencePdf.mockImplementation(async () => {
      uploaded = true
      return { ref: 'b13', pdf: 'gmres-abc.pdf' }
    })
    clientWrap(<AnalysisView id="a1" />)
    expect(await screen.findByLabelText('Upload source PDF')).toBeInTheDocument()

    const file = pdf()
    fireEvent.change(screen.getByLabelText('Upload source PDF'), { target: { files: [file] } })
    await waitFor(() => expect(gateway.uploadReferencePdf).toHaveBeenCalledWith('a1', 'b13', file))
    expect(await screen.findByText('Saad and Schultz show it.')).toBeInTheDocument()
    expect(screen.getByText('This verdict was read from a PDF you uploaded.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload source PDF')).not.toBeInTheDocument()
  })

  it('shows no action to someone who does not own the analysis', async () => {
    const owned = analysis({
      pdfs: { b13: 'gmres-abc.pdf' },
      claims: [{ ...uncheckedClaim(), unchecked: [], verdicts: [supports({ verdict: 'refutes', reasoning: 'Read from the owner’s PDF.' })] }],
    })
    gateway.getAnalysis.mockResolvedValue(owned)
    clientWrap(<AnalysisView id="a1" presentation="teacher" />)
    expect(await screen.findByText('Read from the owner’s PDF.')).toBeInTheDocument()
    expect(screen.getByText('This verdict was read from a PDF the analysis owner uploaded.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload source PDF')).not.toBeInTheDocument()
  })

  it('shows no action while the analysis is still running', async () => {
    gateway.getAnalysis.mockResolvedValue(analysis({ status: 'running', stages: [{ stage: 'verifying', claim: 0, source: 'GMRES' }] }))
    clientWrap(<AnalysisView id="a1" />)
    const row = await screen.findByRole('button', { name: /GMRES minimises the residual/ })
    fireEvent.click(row)
    expect(screen.getByText(/no free copy published/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload source PDF')).not.toBeInTheDocument()
  })
})
