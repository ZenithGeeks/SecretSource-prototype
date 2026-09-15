/** Deterministic, reference-shaped teacher data used by the frontend-only prototype. */

import type {
  ClassroomAttachment,
  ClassroomMaterial,
  EssayCheck,
  RegenerateReadingQuestionsInput,
  TeacherAssignment,
  TeacherAssignmentDetail,
  TeacherClass,
  TeacherClassImportPreview,
  TeacherCourseWork,
  TeacherHome,
  TeacherReadingQuestion,
  TeacherReadingQuestionsPage,
  TeacherRosterMember,
  TeacherSubmission,
  TeacherWorkspace,
} from '../lib/teacher'

const PAPER_COLBERT_URL = 'https://arxiv.org/pdf/2004.12832'

const driveMaterial = (id: string, title: string, url = 'https://drive.google.com/file/d/example/view'): ClassroomMaterial => ({
  id,
  kind: 'driveFile',
  title,
  url,
})

const linkMaterial = (id: string, title: string, url: string): ClassroomMaterial => ({
  id,
  kind: 'link',
  title,
  url,
})

export const MOCK_TEACHER_CLASSES: TeacherClass[] = [
  {
    id: 'class-literary-2b',
    name: 'Literary Analysis',
    section: '2B',
    subject: 'English · Undergraduate',
    status: 'active',
    teacherName: 'Wittawat S.',
    studentCount: 25,
    assignmentCount: 4,
    topicCount: 3,
    announcementCount: 1,
    linkedFileCount: 12,
    lastSyncedAt: 'Today, 9:42 AM',
  },
  {
    id: 'class-modern-writing-1a',
    name: 'Modern Writing',
    section: '1A',
    subject: 'English · Undergraduate',
    status: 'active',
    teacherName: 'Wittawat S.',
    studentCount: 22,
    assignmentCount: 3,
    topicCount: 2,
    announcementCount: 2,
    linkedFileCount: 8,
    lastSyncedAt: 'Yesterday, 4:18 PM',
  },
]

export const MOCK_TEACHER_IMPORT_COURSES: TeacherClass[] = [
  ...MOCK_TEACHER_CLASSES,
  {
    id: 'class-research-methods-3a',
    name: 'Research Methods',
    section: '3A',
    subject: 'Computer Engineering',
    status: 'active',
    teacherName: 'Wittawat S.',
    studentCount: 31,
    assignmentCount: 5,
    topicCount: 4,
    announcementCount: 0,
    linkedFileCount: 15,
    lastSyncedAt: 'Not imported yet',
  },
]

const essayMaterials: ClassroomMaterial[] = [
  driveMaterial('material-essay-brief', 'Assignment brief'),
  linkMaterial(
    'material-colbert',
    'ColBERT: Efficient and Effective Passage Search',
    PAPER_COLBERT_URL,
  ),
]

export const MOCK_TEACHER_ASSIGNMENTS: TeacherAssignment[] = [
  {
    id: 'assignment-essay',
    courseId: 'class-literary-2b',
    title: 'Assignment 2: Evidence-based essay',
    dueAt: 'Sep 18, 2026',
    enrolledCount: 25,
    submittedCount: 19,
    missingCount: 6,
    returnedCount: 0,
    pendingReviewCount: 5,
    status: 'pending',
    materials: essayMaterials,
  },
  {
    id: 'assignment-reading',
    courseId: 'class-literary-2b',
    title: 'Reading response: Retrieval systems',
    dueAt: 'Sep 22, 2026',
    enrolledCount: 18,
    submittedCount: 17,
    missingCount: 1,
    returnedCount: 0,
    pendingReviewCount: 0,
    status: 'pending',
    materials: [linkMaterial('material-dpr', 'Dense Passage Retrieval', 'https://arxiv.org/abs/2004.04906')],
  },
  {
    id: 'assignment-proposal',
    courseId: 'class-literary-2b',
    title: 'Research proposal',
    dueAt: 'Sep 10, 2026',
    enrolledCount: 12,
    submittedCount: 12,
    missingCount: 0,
    returnedCount: 4,
    pendingReviewCount: 0,
    status: 'returned',
    materials: [driveMaterial('material-proposal-template', 'Proposal template')],
  },
  {
    id: 'assignment-reflection',
    courseId: 'class-literary-2b',
    title: 'Final reflection',
    dueAt: 'Sep 30, 2026',
    enrolledCount: 11,
    submittedCount: 10,
    missingCount: 1,
    returnedCount: 4,
    pendingReviewCount: 0,
    status: 'returned',
    materials: [],
  },
  {
    id: 'assignment-modern-voice',
    courseId: 'class-modern-writing-1a',
    title: 'Finding your voice',
    dueAt: 'Sep 20, 2026',
    enrolledCount: 22,
    submittedCount: 15,
    missingCount: 7,
    returnedCount: 0,
    pendingReviewCount: 0,
    status: 'pending',
    materials: [driveMaterial('material-voice-brief', 'Voice and style brief')],
  },
  {
    id: 'assignment-modern-profile',
    courseId: 'class-modern-writing-1a',
    title: 'Profile feature',
    dueAt: 'Oct 2, 2026',
    enrolledCount: 22,
    submittedCount: 0,
    missingCount: 22,
    returnedCount: 0,
    pendingReviewCount: 0,
    status: 'not-started',
    materials: [],
  },
  {
    id: 'assignment-modern-revision',
    courseId: 'class-modern-writing-1a',
    title: 'Revision workshop',
    dueAt: 'Oct 8, 2026',
    enrolledCount: 22,
    submittedCount: 0,
    missingCount: 22,
    returnedCount: 0,
    pendingReviewCount: 0,
    status: 'not-started',
    materials: [],
  },
]

const attachment = (id: string, title: string, mimeType: string, url: string): ClassroomAttachment => ({
  id,
  title,
  mimeType,
  url,
})

const essaySubmissions: TeacherSubmission[] = [
  {
    id: 'submission-anan',
    assignmentId: 'assignment-essay',
    studentId: 'student-anan',
    studentName: 'Anan P.',
    fileName: 'essay-2.docx',
    state: 'submitted',
    submittedAt: 'Sep 12, 4:42 PM',
    attachments: [
      attachment(
        'attachment-anan',
        'essay-2.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'https://drive.google.com/file/d/anan-essay/view',
      ),
    ],
  },
  {
    id: 'submission-bee',
    assignmentId: 'assignment-essay',
    studentId: 'student-bee',
    studentName: 'Bee S.',
    fileName: 'evidence-review.pdf',
    state: 'submitted',
    submittedAt: 'Sep 13, 9:18 AM',
    attachments: [
      attachment('attachment-bee', 'evidence-review.pdf', 'application/pdf', 'https://drive.google.com/file/d/bee-essay/view'),
    ],
  },
  {
    id: 'submission-chai',
    assignmentId: 'assignment-essay',
    studentId: 'student-chai',
    studentName: 'Chai W.',
    fileName: 'essay-final.pdf',
    state: 'returned',
    submittedAt: 'Sep 11, 1:05 PM',
    attachments: [
      attachment('attachment-chai', 'essay-final.pdf', 'application/pdf', 'https://drive.google.com/file/d/chai-essay/view'),
    ],
  },
  {
    id: 'submission-dao',
    assignmentId: 'assignment-essay',
    studentId: 'student-dao',
    studentName: 'Dao K.',
    fileName: 'No file submitted',
    state: 'missing',
    attachments: [],
  },
]

const roster: TeacherRosterMember[] = [
  { id: 'teacher-wittawat', name: 'Wittawat S.', initials: 'WS', role: 'Teacher', isCourseOwner: true },
  { id: 'student-anan', name: 'Anan P.', initials: 'AP', role: 'Student', isCourseOwner: false },
  { id: 'student-bee', name: 'Bee S.', initials: 'BS', role: 'Student', isCourseOwner: false },
  { id: 'student-chai', name: 'Chai W.', initials: 'CW', role: 'Student', isCourseOwner: false },
  { id: 'student-dao', name: 'Dao K.', initials: 'DK', role: 'Student', isCourseOwner: false },
  { id: 'student-ela', name: 'Ela R.', initials: 'ER', role: 'Student', isCourseOwner: false },
]

const modernRoster: TeacherRosterMember[] = [
  { id: 'teacher-wittawat', name: 'Wittawat S.', initials: 'WS', role: 'Teacher', isCourseOwner: true },
  { id: 'student-min', name: 'Min J.', initials: 'MJ', role: 'Student', isCourseOwner: false },
  { id: 'student-nok', name: 'Nok T.', initials: 'NT', role: 'Student', isCourseOwner: false },
  { id: 'student-pat', name: 'Pat C.', initials: 'PC', role: 'Student', isCourseOwner: false },
]

const workspaceFor = (course: TeacherClass, people: TeacherRosterMember[], assignments: TeacherAssignment[]): TeacherWorkspace => ({
  course,
  description:
    course.id === 'class-literary-2b'
      ? 'Read closely, write clearly, and make evidence visible in every argument.'
      : 'A workshop space for clear, confident writing and thoughtful revision.',
  assignments,
  submissions: assignments.flatMap((item) => item.id === 'assignment-essay' ? essaySubmissions : []).slice(0, 4),
  people,
  latestAnnouncement:
    course.id === 'class-literary-2b'
      ? {
          title: 'Welcome to the new reading unit',
          postedBy: 'Wittawat S.',
          postedAt: 'Sep 14, 2026',
          body: 'Please bring one passage from this week\'s paper to our next discussion.',
        }
      : {
          title: 'Workshop groups are ready',
          postedBy: 'Wittawat S.',
          postedAt: 'Sep 12, 2026',
          body: 'Check your group before beginning the revision workshop.',
        },
  materials: [
    { id: 'workspace-material-1', title: 'Course syllabus', kind: 'drive-file', accessible: true },
    { id: 'workspace-material-2', title: 'Reading list', kind: 'drive-file', accessible: true },
    { id: 'workspace-material-3', title: 'Office hours', kind: 'link', accessible: false },
  ],
  topics: course.id === 'class-literary-2b'
    ? [
        { id: 'topic-evidence', name: 'Evidence and claims', assignmentCount: 2 },
        { id: 'topic-close-reading', name: 'Close reading', assignmentCount: 1 },
        { id: 'topic-reflection', name: 'Reflection', assignmentCount: 1 },
      ]
    : [
        { id: 'topic-voice', name: 'Voice and style', assignmentCount: 2 },
        { id: 'topic-revision', name: 'Revision', assignmentCount: 1 },
      ],
})

export const MOCK_TEACHER_WORKSPACES: Record<string, TeacherWorkspace> = {
  'class-literary-2b': workspaceFor(
    MOCK_TEACHER_CLASSES[0]!,
    roster,
    MOCK_TEACHER_ASSIGNMENTS.filter((assignment) => assignment.courseId === 'class-literary-2b'),
  ),
  'class-modern-writing-1a': workspaceFor(
    MOCK_TEACHER_CLASSES[1]!,
    modernRoster,
    MOCK_TEACHER_ASSIGNMENTS.filter((assignment) => assignment.courseId === 'class-modern-writing-1a'),
  ),
  'class-research-methods-3a': workspaceFor(
    MOCK_TEACHER_IMPORT_COURSES[2]!,
    roster,
    [],
  ),
}

export const MOCK_TEACHER_WORKSPACE = MOCK_TEACHER_WORKSPACES['class-literary-2b']!

export const MOCK_TEACHER_ASSIGNMENT_DETAILS: Record<string, TeacherAssignmentDetail> = {
  'class-literary-2b:assignment-essay': {
    assignment: MOCK_TEACHER_ASSIGNMENTS[0]!,
    submissions: essaySubmissions,
  },
}

const FEEDBACK_BODY = [
  'Two of your citations attribute results to papers that do not contain them:',
  '',
  '1. The 6-10x index reduction comes from ColBERTv2 (Santhanam et al., 2022), not ColBERT (2020) - see p.7 of the 2020 paper.',
  '',
  '2. DPR does not claim sparse retrieval is obsolete; p.6 recommends hybrid retrieval.',
  '',
  'Also: BEIR reports mixed results, so "proves ... best" overstates it.',
].join('\n')

const review = (
  id: string,
  standing: EssayCheck['reviews'][number]['standing'],
  citation: string,
  claim: string,
  sourceQuote: string,
  sourceLocation: string,
  explanation: string | undefined,
  supportingUrl: string,
  supportingTitle: string,
): EssayCheck['reviews'][number] => ({
  id,
  standing,
  citation,
  claim,
  sourceQuote,
  sourceLocation,
  explanation,
  supportingUrls: [
    {
      id: `${id}-support`,
      url: supportingUrl,
      title: supportingTitle,
      location: sourceLocation,
      excerpt: sourceQuote,
    },
  ],
  paperUrl: PAPER_COLBERT_URL,
  professorReview: { outcome: 'not-reviewed', note: '' },
})

export const MOCK_ESSAY_CHECK: EssayCheck = {
  assignment: {
    assignmentId: 'assignment-essay',
    courseId: 'class-literary-2b',
    course: 'Literary Analysis',
    name: 'Assignment 2',
    courseWorkId: 'assignment-essay',
  },
  student: { id: 'student-anan', name: 'Anan P.', fileName: 'essay-2.docx' },
  citationSummary: { total: 5, contradicted: 2, silent: 1, backed: 2 },
  reviews: [
    review(
      'review-colbert',
      'refutes',
      'Khattab & Zaharia (2020)',
      'ColBERT reduces index size by 6-10x compared to BERT-based rerankers (Khattab & Zaharia, 2020).',
      '"...we leave compression of the embeddings to future work."',
      'p.7',
      'The 6-10x result is from ColBERTv2 (2022). The cited paper reports an uncompressed 154 GiB index.',
      'https://arxiv.org/abs/2112.01488',
      'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction',
    ),
    review(
      'review-dpr',
      'refutes',
      'Karpukhin et al. (2020)',
      'DPR shows that sparse retrieval is obsolete for open-domain QA (Karpukhin et al., 2020).',
      '"...BM25 remains a strong baseline and hybrid retrieval improves further."',
      'p.6',
      'The paper argues dense complements sparse; it does not call sparse retrieval obsolete.',
      'https://arxiv.org/abs/2004.04906',
      'Dense Passage Retrieval for Open-Domain Question Answering',
    ),
    review(
      'review-beir',
      'insufficient',
      'Thakur et al. (2021)',
      'BEIR proves late interaction is the best zero-shot approach (Thakur et al., 2021).',
      '"...no single model dominates across all domains."',
      'p.9',
      'The paper never ranks late interaction as best; the result is mixed.',
      'https://arxiv.org/abs/2104.08663',
      'BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models',
    ),
    review(
      'review-ms-marco',
      'supports',
      'Nguyen et al. (2016)',
      'MS MARCO contains 8.8M passages (Nguyen et al., 2016).',
      '"...8,841,823 passages."',
      'p.3',
      undefined,
      'https://arxiv.org/abs/1611.09268',
      'MS MARCO: A Human Generated MAchine Reading COmprehension Dataset',
    ),
    review(
      'review-bert',
      'supports',
      'Devlin et al. (2019)',
      'BERT pre-training improves downstream language understanding tasks.',
      '"...pre-trained representations can be fine-tuned with just one additional output layer."',
      'p.1',
      undefined,
      'https://arxiv.org/abs/1810.04805',
      'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    ),
  ],
  feedback: {
    body: FEEDBACK_BODY,
    preview: '"Two of your citations attribute results to papers that do not contain them." - 7 lines, cites p.7, p.6, p.9',
    citedPages: ['p.7', 'p.6', 'p.9'],
    citationIds: ['review-colbert', 'review-dpr', 'review-beir'],
  },
  navigation: { next: { id: 'student-bee', name: 'Bee S.' } },
}

export const MOCK_ESSAY_CHECKS: Record<string, EssayCheck> = {
  'assignment-essay:student-anan': MOCK_ESSAY_CHECK,
  'assignment-essay:student-bee': {
    ...MOCK_ESSAY_CHECK,
    student: { ...MOCK_ESSAY_CHECK.student, id: 'student-bee', name: 'Bee S.', fileName: 'evidence-review.pdf' },
    navigation: { previous: { id: 'student-anan', name: 'Anan P.' } },
  },
}

export const MOCK_TEACHER_HOME: TeacherHome = {
  user: 'Vitawat',
  course: 'CPE 401',
  courseId: 'class-literary-2b',
  checkedEssays: 18,
  totalEssays: 24,
  citationsNeedingAttention: 5,
  assignment: 'Assignment 2',
  assignmentId: 'assignment-essay',
  submissions: [
    {
      ...essaySubmissions[0]!,
      initial: 'A',
      summary: '2 citations contradicted · 3 checked',
      standing: 'refutes',
    },
    {
      ...essaySubmissions[1]!,
      initial: 'B',
      summary: '1 source is silent · 4 checked',
      standing: 'insufficient',
    },
    {
      ...essaySubmissions[2]!,
      initial: 'C',
      summary: 'all sources back it · 5 checked',
      standing: 'supports',
    },
    {
      ...essaySubmissions[3]!,
      initial: 'D',
      summary: 'not submitted · -',
      standing: 'unchecked',
    },
  ],
  library: {
    paperCount: 6,
    visibility: 'Shared with your classes',
    papers: [
      { id: 'paper-bert', title: 'BERT', citation: 'Devlin et al., 2019', note: 'Reading questions ready' },
      { id: 'paper-colbert', title: 'ColBERT', citation: 'Khattab & Zaharia, 2020', note: '12 students opened' },
      { id: 'paper-dpr', title: 'DPR', citation: 'Karpukhin et al., 2020', note: 'Most cited in essays' },
    ],
  },
  mostMisusedSource: {
    title: 'Khattab & Zaharia (2020)',
    detail: '7 essays cite it for the 6-10x index reduction, which is a ColBERTv2 (2022) result.',
  },
}

export const MOCK_TEACHER_IMPORT_PREVIEWS: Record<string, TeacherClassImportPreview> = Object.fromEntries(
  MOCK_TEACHER_IMPORT_COURSES.map((course) => [
    course.id,
    {
      course,
      resources: [
        { key: 'course', label: 'Course details', count: 1, detail: 'Name, section, and description' },
        { key: 'classwork', label: 'Classwork', count: course.assignmentCount, detail: 'Assignments and due dates' },
        { key: 'people', label: 'People', count: course.studentCount, detail: 'Students and teachers' },
        { key: 'drive', label: 'Linked Drive files', count: course.linkedFileCount, detail: 'Files attached to this course' },
      ],
    } satisfies TeacherClassImportPreview,
  ]),
) as Record<string, TeacherClassImportPreview>

export const MOCK_TEACHER_READING_QUESTIONS: TeacherReadingQuestionsPage = {
  paper: {
    id: 'paper-colbert',
    title: 'ColBERT',
    citation: 'Khattab & Zaharia, 2020',
    fileName: 'colbert.pdf',
    verifiedClaims: 8,
    paperUrl: PAPER_COLBERT_URL,
  },
  questions: [
    {
      id: 'reading-question-1',
      paperId: 'paper-colbert',
      level: 'undergrad',
      type: 'comprehension',
      prompt: 'What is "late interaction", and how does it differ from scoring a query and document with a single vector each?',
      anchor: 'p.2 §3.1',
      page: 2,
      excerpt: '...MaxSim between query and document token embeddings...',
      answer: 'p.2 - MaxSim over token embeddings; single-vector scoring uses one dot product.',
    },
    {
      id: 'reading-question-2',
      paperId: 'paper-colbert',
      level: 'undergrad',
      type: 'comprehension',
      prompt: 'Why does ColBERT pre-compute document embeddings offline? What cost does this move from query time to index time?',
      anchor: 'p.4 §3.3',
      page: 4,
      excerpt: '...document representations are computed offline and stored...',
      answer: 'p.4 - Offline document encoding moves the cost to indexing.',
    },
    {
      id: 'reading-question-3',
      paperId: 'paper-colbert',
      level: 'undergrad',
      type: 'critique',
      prompt: 'The paper claims late interaction "generalizes better" zero-shot. What evidence is given, and is one benchmark enough to support it?',
      anchor: 'p.8 §5.2',
      page: 8,
      excerpt: '...in our zero-shot setting on TREC-CAR...',
      answer: 'p.8 - The claim relies on one benchmark, so the evidence is limited.',
    },
    {
      id: 'reading-question-4',
      paperId: 'paper-colbert',
      level: 'undergrad',
      type: 'critique',
      prompt: 'Students often cite this paper for a 6-10x smaller index. Find the passage on index size - what does it actually say, and which later paper reports the reduction?',
      anchor: 'p.7 §4.4',
      page: 7,
      excerpt: '...154 GiB... we leave compression to future work.',
      answer: 'p.7 - The index is 154 GiB; the reduction is reported by ColBERTv2 (2022).',
    },
    {
      id: 'reading-question-5',
      paperId: 'paper-colbert',
      level: 'undergrad',
      type: 'discussion',
      prompt: 'Given the 154 GiB index, would you deploy ColBERT in production? What trade-offs does the paper acknowledge?',
      anchor: 'p.7 §4.4',
      page: 7,
      excerpt: '...154 GiB... we leave compression of the embeddings to future work.',
      answer: 'p.7 - Weigh the index size and deferred compression against production requirements.',
    },
  ],
}

type MockQuestionTemplate = Omit<TeacherReadingQuestion, 'id' | 'paperId'> & { id: string }

const MOCK_GENERATED_QUESTION_TEMPLATES: MockQuestionTemplate[] = [
  {
    id: 'problem', level: 'undergrad', type: 'comprehension', prompt: 'Which central problem does {paper} address?', anchor: 'p.2 §1', page: 2,
    excerpt: '...the problem this work addresses...', answer: 'p.2 - Identify the paper\'s central problem and the method used to address it.',
  },
  {
    id: 'method', level: 'undergrad', type: 'comprehension', prompt: 'What is the main method introduced in {paper}?', anchor: 'p.3 §2', page: 3,
    excerpt: '...the proposed method...', answer: 'p.3 - Summarize the proposed method and the part of the pipeline it changes.',
  },
  {
    id: 'evidence', level: 'undergrad', type: 'critique', prompt: 'What evidence does {paper} provide for its main claim?', anchor: 'p.6 §4', page: 6,
    excerpt: '...the experimental results...', answer: 'p.6 - Connect the experiments and reported results to the paper\'s main claim.',
  },
  {
    id: 'limitation', level: 'undergrad', type: 'critique', prompt: 'Which limitation should a reader keep in mind when applying {paper} elsewhere?', anchor: 'p.8 §5', page: 8,
    excerpt: '...limitations and future work...', answer: 'p.8 - Check whether the data, assumptions, and evaluation setting match the new context.',
  },
  {
    id: 'follow-up', level: 'undergrad', type: 'discussion', prompt: 'What follow-up experiment would most clearly test the boundaries of {paper}\'s result?', anchor: 'p.8 §5', page: 8,
    excerpt: '...limitations and future work...', answer: 'p.8 - Use a stated limitation or future-work direction to frame the experiment.',
  },
  {
    id: 'graduate-problem', level: 'graduate', type: 'comprehension', prompt: 'What problem does {paper} formalize, and which retrieval assumption does its formulation challenge?', anchor: 'p.2 §1', page: 2,
    excerpt: '...the problem this work addresses...', answer: 'p.2 - Identify the formal problem and the retrieval assumption the paper changes.',
  },
  {
    id: 'graduate-method', level: 'graduate', type: 'comprehension', prompt: "How does {paper}'s method decompose representation and scoring, and where does each computation occur?", anchor: 'p.3 §2', page: 3,
    excerpt: '...the proposed method...', answer: 'p.3 - Trace representation and scoring stages and distinguish offline from query-time computation.',
  },
  {
    id: 'graduate-evidence', level: 'graduate', type: 'critique', prompt: 'Which empirical evidence in {paper} supports the central claim, and what alternative explanation remains?', anchor: 'p.6 §4', page: 6,
    excerpt: '...the experimental results...', answer: 'p.6 - Connect the experiments to the claim and identify an explanation the evidence does not rule out.',
  },
  {
    id: 'graduate-limitation', level: 'graduate', type: 'critique', prompt: "What limitation in {paper}'s evaluation or system design constrains generalization to another setting?", anchor: 'p.8 §5', page: 8,
    excerpt: '...limitations and future work...', answer: 'p.8 - Check whether the data, assumptions, and evaluation setting transfer.',
  },
  {
    id: 'graduate-follow-up', level: 'graduate', type: 'discussion', prompt: "Which follow-up experiment would most rigorously test the boundary of {paper}'s reported result?", anchor: 'p.8 §5', page: 8,
    excerpt: '...limitations and future work...', answer: 'p.8 - Define the experiment and its expected result from a stated limitation.',
  },
]

export function createMockReadingQuestions(input: RegenerateReadingQuestionsInput): TeacherReadingQuestion[] {
  const paperTitle = MOCK_TEACHER_READING_QUESTIONS.paper.title
  return MOCK_GENERATED_QUESTION_TEMPLATES
    .filter((template) => template.level === input.level && input.types.includes(template.type))
    .map((template) => ({
      id: `generated-${input.paperId}-${input.level}-${template.type}-${template.id}`,
      paperId: input.paperId,
      level: input.level,
      type: template.type,
      prompt: template.prompt.replace('{paper}', paperTitle),
      anchor: template.anchor,
      page: template.page,
      excerpt: template.excerpt,
      answer: template.answer,
    }))
}

// Legacy conversion for the retiring classwork components. New screens use TeacherClass directly.
export const MOCK_TEACHER_COURSEWORK: TeacherCourseWork[] = MOCK_TEACHER_ASSIGNMENTS.map((assignment) => ({
  id: assignment.id,
  courseId: assignment.courseId,
  title: assignment.title,
  description: 'Reference assignment data for the teacher prototype.',
  dueAt: assignment.dueAt,
  materials: assignment.materials,
  submissions: [],
  analysisSelected: false,
  analysisStatus: 'not-queued',
}))
