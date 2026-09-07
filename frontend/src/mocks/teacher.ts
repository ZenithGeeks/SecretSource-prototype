/**
 * Reference-shaped teacher data for the overview screen.
 *
 * This is a temporary development fixture, not a production fallback. It stays outside the
 * screen so the future gateway response can replace it at one data-layer boundary.
 */

import type { TeacherHome } from '../lib/teacher'

export const MOCK_TEACHER_HOME: TeacherHome = {
  user: 'Wittawat',
  course: 'CPE 401',
  checkedEssays: 18,
  totalEssays: 24,
  citationsNeedingAttention: 5,
  assignment: 'Assignment 2',
  submissions: [
    {
      id: 'submission-anan',
      initial: 'A',
      student: 'Anan P.',
      summary: '2 citations contradicted · 3 checked',
      standing: 'refutes',
    },
    {
      id: 'submission-bee',
      initial: 'B',
      student: 'Bee S.',
      summary: '1 source is silent · 4 checked',
      standing: 'insufficient',
    },
    {
      id: 'submission-chai',
      initial: 'C',
      student: 'Chai W.',
      summary: 'all sources back it · 5 checked',
      standing: 'supports',
    },
    {
      id: 'submission-dao',
      initial: 'D',
      student: 'Dao K.',
      summary: 'not submitted · —',
      standing: 'unchecked',
    },
  ],
  library: {
    paperCount: 6,
    visibility: 'shared',
    papers: [
      {
        id: 'paper-bert',
        title: 'BERT',
        citation: 'Devlin 2019',
        note: 'reading questions ready',
      },
      {
        id: 'paper-colbert',
        title: 'ColBERT',
        citation: 'Khattab 2020',
        note: '12 students opened',
      },
      {
        id: 'paper-dpr',
        title: 'DPR',
        citation: 'Karpukhin 2020',
        note: 'most cited in essays',
      },
    ],
  },
  mostMisusedSource: {
    title: 'Khattab & Zaharia (2020)',
    detail: '7 essays cite it for the 6–10× index reduction, which is a ColBERTv2 (2022) result.',
  },
}
