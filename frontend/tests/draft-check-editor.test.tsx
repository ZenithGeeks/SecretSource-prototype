/** Phase 0, docs/draft-editor-assessment.md: DraftCheck's draft view now renders through a
 * read-only TipTap/ProseMirror editor instead of the old per-word DraftParagraph. This covers
 * what a user should see unchanged (words, verdict colors, legend) and what's new (claimId
 * on the rendered marks). This branch predates #209 (ClaimCheckCard/POST /checks) — that's
 * a separate, still-open PR, not part of this diff. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'

import { DraftCheck } from '../src/roles/writer/screens/DraftCheck'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

test('renders the mocked draft as prose, with the same words and no editing affordances', async () => {
  renderWithQuery(<DraftCheck onReplaceCitation={() => {}} />)

  expect(await screen.findByText(/Late interaction retrievers encode queries/)).toBeInTheDocument()
  expect(screen.getByText(/MS MARCO contains 8\.8M passages/)).toBeInTheDocument()

  // Read-only: no toolbar, and the editor root must not be contenteditable.
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  const editorRoot = document.querySelector('.ProseMirror')
  expect(editorRoot).not.toBeNull()
  expect(editorRoot).toHaveAttribute('contenteditable', 'false')

  // Legend is unrelated to the editor swap and must be untouched. ("source contradicts" also
  // appears in the active issue's StandingBadge, hence getAllByText here.)
  expect(screen.getAllByText('source backs it').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('source contradicts').length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByText('source is silent').length).toBeGreaterThanOrEqual(1)
})

test('verdict marks carry data-verdict, and the ones matching a real claim carry its claimId', async () => {
  renderWithQuery(<DraftCheck onReplaceCitation={() => {}} />)
  await screen.findByText(/Late interaction retrievers encode queries/)
  // The doc is first built with claims still loading (draftCheck and the separate
  // useDraftClaims query settle a tick apart), so wait for the claim-linked re-render
  // rather than reading marks off the first pass.
  await waitFor(() => expect(document.querySelector('mark[data-claim-id="c1"]')).not.toBeNull())

  const marks = [...document.querySelectorAll('.ProseMirror mark')].map((el) => ({
    verdict: el.getAttribute('data-verdict'),
    claimId: el.getAttribute('data-claim-id'),
    text: el.textContent,
  }))

  expect(marks).toContainEqual({
    verdict: 'refutes',
    claimId: 'c1',
    text: 'reduces index size by 6–10× while matching retrieval quality [Khattab & Zaharia, 2020].',
  })
  expect(marks).toContainEqual({
    verdict: 'insufficient',
    claimId: 'c2',
    text: 'outperform single-vector retrievers on BEIR [Thakur et al., 2021].',
  })
  expect(marks).toContainEqual({ verdict: 'supports', claimId: 'c3', text: '[Nguyen et al., 2016].' })

  // The two decorative citation mentions never had a tracked claim behind them and stay unlinked.
  const decorative = marks.filter((m) => m.verdict === 'supports' && m.claimId === null)
  expect(decorative).toHaveLength(2)
})

test('no missing spaces at mark boundaries in the rendered text', async () => {
  renderWithQuery(<DraftCheck onReplaceCitation={() => {}} />)
  const paragraph = await screen.findByText(/Late interaction retrievers encode queries/)

  // Each text node is its own run (word-run or space-run); regressions here look like
  // "2020].ColBERTv2" or "furtherreduces" — the run boundary silently swallowing the space.
  expect(paragraph.textContent).toContain('MaxSim [Khattab & Zaharia, 2020]. ColBERTv2 further reduces')
  expect(paragraph.textContent).toContain('quality [Khattab & Zaharia, 2020]. On out-of-domain data these models outperform')
  expect(paragraph.textContent).not.toContain('].ColBERTv2')
  expect(paragraph.textContent).not.toContain('furtherreduces')
  expect(paragraph.textContent).not.toContain('modelsoutperform')
})
