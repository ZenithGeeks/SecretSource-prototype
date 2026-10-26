/** The Labeler's paper list marks each row so the screen agent can point at it and open it. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { ComponentProps } from 'react'

import { PaperTable } from '../src/roles/labeler/components/PaperTable'

const paper: ComponentProps<typeof PaperTable>['papers'][number] = {
  analysis_id: 'a1',
  title: 'ColBERTv2',
  topic: 'retrieval',
  claims: 2,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: true,
  added_by: 'me',
  subject: '',
  keywords: [],
  venue_rank: '',
  venue_rank_source: '',
}

it('marks each paper with paper:<id> for the screen agent', () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PaperTable papers={[paper]} me="me" myTopic="retrieval" onOpen={() => undefined} />
    </QueryClientProvider>,
  )
  expect(document.querySelector('[data-ask-target="paper:a1"]')).toBeInTheDocument()
})
