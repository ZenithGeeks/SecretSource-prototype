import type { Paper } from '../types'

export const mockPapers: Paper[] = [
  { id: 'p1', fileName: 'colbertv2.pdf', summary: '6 claims · 1 contradicted' },
  { id: 'p2', fileName: '2112.01488.pdf', summary: '6 claims · all checked' },
  { id: 'p3', fileName: 'bert.pdf', summary: 'indexed, not analyzed' },
  // edge case: a paper the extractor read but found nothing to check
  { id: 'p4', fileName: 'workshop-abstract.pdf', summary: '0 claims found' },
  {
    id: 'p5',
    fileName: 'a-comprehensive-survey-of-retrieval-augmented-generation-methods-for-large-language-models.pdf',
    summary: '14 claims · 3 need work',
  },
]
