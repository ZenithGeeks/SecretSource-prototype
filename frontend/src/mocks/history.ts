import type { Paper } from '../types'

/**
 * Past check runs, newest first. Backs the sidebar's "History" nav item, which has no
 * route yet (see AppRouter) — kept here so the service layer is ready when it does.
 */
export const mockHistory: Paper[] = [
  { id: 'p1', fileName: 'colbertv2.pdf', summary: '6 claims · 1 contradicted · checked 2h ago' },
  { id: 'p2', fileName: '2112.01488.pdf', summary: '6 claims · all checked · checked yesterday' },
  { id: 'p6', fileName: 'attention-is-all-you-need.pdf', summary: '9 claims · all checked · checked 4 days ago' },
]
