/**
 * Reference-shaped teacher data for the essay-check screen.
 *
 * This is a temporary development fixture, not a production fallback. It mirrors the two
 * supplied Figma states and stays outside the screen so the future gateway response can
 * replace it at one data-layer boundary.
 */

import type { EssayCheck, TeacherHome } from '../lib/teacher'

/** The prototype overview payload. It remains here so its Home action and this detail page
 * share the same teacher data boundary while the gateway is still being built. */
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

const FEEDBACK_BODY = [
  'Two of your citations attribute results to papers that do not contain them:',
  '',
  '1. The 6–10× index reduction comes from ColBERTv2 (Santhanam et al., 2022), not ColBERT (2020) — see p.7 of the 2020 paper.',
  '',
  '2. DPR does not claim sparse retrieval is obsolete; p.6 recommends hybrid retrieval.',
  '',
  'Also: BEIR reports mixed results, so “proves ... best” overstates it.',
].join('\n')

export const MOCK_ESSAY_CHECK: EssayCheck = {
  assignment: {
    course: 'CPE 401',
    name: 'Assignment 2',
  },
  student: {
    id: 'student-anan',
    name: 'Anan P.',
    fileName: 'essay-2.docx',
  },
  citationSummary: {
    total: 5,
    contradicted: 2,
    silent: 1,
    backed: 2,
  },
  reviews: [
    {
      id: 'review-colbert',
      standing: 'refutes',
      citation: 'Khattab & Zaharia (2020)',
      claim: 'ColBERT reduces index size by 6–10× compared to BERT-based rerankers (Khattab & Zaharia, 2020).',
      sourceQuote: '“...we leave compression of the embeddings to future work.”',
      sourceLocation: 'p.7',
      explanation:
        'The 6–10× result is from ColBERTv2 (2022). The cited paper reports an uncompressed 154 GiB index.',
    },
    {
      id: 'review-dpr',
      standing: 'refutes',
      citation: 'Karpukhin et al. (2020)',
      claim: 'DPR shows that sparse retrieval is obsolete for open-domain QA (Karpukhin et al., 2020).',
      sourceQuote: '“...BM25 remains a strong baseline and hybrid retrieval improves further.”',
      sourceLocation: 'p.6',
      explanation: 'Paper argues dense complements sparse, does not call it obsolete.',
    },
    {
      id: 'review-beir',
      standing: 'insufficient',
      citation: 'Thakur et al. (2021)',
      claim: 'BEIR proves late interaction is the best zero-shot approach (Thakur et al., 2021).',
      sourceQuote: '“...no single model dominates across all domains.”',
      sourceLocation: 'p.9',
      explanation: 'Paper never ranks late interaction as best; result is mixed.',
    },
    {
      id: 'review-ms-marco',
      standing: 'supports',
      citation: 'Nguyen et al. (2016)',
      claim: 'MS MARCO contains 8.8M passages (Nguyen et al., 2016).',
      sourceQuote: '“...8,841,823 passages.”',
      sourceLocation: 'p.3',
    },
  ],
  feedback: {
    body: FEEDBACK_BODY,
    preview: '“Two of your citations attribute results to papers that do not contain them.” — 4 lines, cites p.7, p.6, p.9',
    citedPages: ['p.7', 'p.6', 'p.9'],
    citationIds: ['review-colbert', 'review-dpr', 'review-beir'],
  },
  navigation: {
    previous: { id: 'student-dao', name: 'Dao K.' },
    next: { id: 'student-bee', name: 'Bee S.' },
  },
}

// A small navigation fixture keeps the Previous / Next controls demonstrable before the
// submission query exists. The real response will contain the selected student's records.
export const MOCK_ESSAY_CHECKS: Record<string, EssayCheck> = {
  'student-anan': MOCK_ESSAY_CHECK,
  'student-dao': {
    ...MOCK_ESSAY_CHECK,
    student: { ...MOCK_ESSAY_CHECK.student, id: 'student-dao', name: 'Dao K.' },
    navigation: { next: { id: 'student-anan', name: 'Anan P.' } },
  },
  'student-bee': {
    ...MOCK_ESSAY_CHECK,
    student: { ...MOCK_ESSAY_CHECK.student, id: 'student-bee', name: 'Bee S.' },
    navigation: { previous: { id: 'student-anan', name: 'Anan P.' } },
  },
}
