/**
 * Typed client for teacher-role data.
 *
 * The teacher gateway is not available yet, so these methods return the reference-shaped
 * fixtures from `src/mocks/teacher.ts`. Keeping the request boundary here means the screen
 * will not need to change when the database-backed endpoints arrive.
 */

import {
  MOCK_ESSAY_CHECK,
  MOCK_ESSAY_CHECKS,
  MOCK_TEACHER_HOME,
  MOCK_TEACHER_READING_QUESTIONS,
  createMockReadingQuestions,
} from '../mocks/teacher'

/** The reader-facing standing shown beside a student's citation. */
export type TeacherStanding = 'supports' | 'refutes' | 'insufficient' | 'unchecked'

export type TeacherSubmission = {
  id: string
  initial: string
  student: string
  summary: string
  standing: TeacherStanding
}

export type ClassPaper = {
  id: string
  title: string
  citation: string
  note: string
}

export type MostMisusedSource = {
  title: string
  detail: string
}

/** Data contract for the prototype teacher overview that owns the essay-check action. */
export type TeacherHome = {
  user: string
  course: string
  checkedEssays: number
  totalEssays: number
  citationsNeedingAttention: number
  assignment: string
  submissions: TeacherSubmission[]
  library: {
    paperCount: number
    visibility: string
    papers: ClassPaper[]
  }
  mostMisusedSource: MostMisusedSource | null
}

export type EssayReview = {
  id: string
  standing: TeacherStanding
  citation: string
  claim: string
  sourceQuote: string
  sourceLocation: string
  explanation?: string
}

export type StudentNavigation = {
  id: string
  name: string
}

export type FeedbackDraft = {
  body: string
  preview: string
  citedPages: string[]
  citationIds: string[]
}

export type EssayCheck = {
  assignment: {
    course: string
    name: string
  }
  student: {
    id: string
    name: string
    fileName: string
  }
  citationSummary: {
    total: number
    contradicted: number
    silent: number
    backed: number
  }
  reviews: EssayReview[]
  feedback: FeedbackDraft
  navigation: {
    previous?: StudentNavigation
    next?: StudentNavigation
  }
}

export type SendFeedbackRequest = {
  studentId: string
  body: string
  citationIds: string[]
}

export type FeedbackDelivery = {
  studentId: string
  status: 'sent'
  sentAt: string
}

/** The audience levels exposed by the reference screen's level filters. */
export type ReadingQuestionLevel = 'undergrad' | 'graduate'

/** The question formats exposed by the reference screen's type filters. */
export type ReadingQuestionType = 'comprehension' | 'critique' | 'discussion'

export type ReadingQuestionPaper = {
  id: string
  title: string
  citation: string
  fileName: string
  verifiedClaims: number
}

export type TeacherReadingQuestion = {
  id: string
  paperId: string
  level: ReadingQuestionLevel
  type: ReadingQuestionType
  prompt: string
  anchor: string
  page: number
  excerpt: string | null
  answer: string | null
}

/** Everything the screen needs to render one generated question worksheet. */
export type TeacherReadingQuestionsPage = {
  paper: ReadingQuestionPaper
  questions: TeacherReadingQuestion[]
}

export type RegenerateReadingQuestionsInput = {
  paperId: string
  paperTitle: string
  level: ReadingQuestionLevel
  types: ReadingQuestionType[]
}

export type UpdateReadingQuestionInput = {
  id: string
  prompt: string
  answer: string
}

export const READING_QUESTIONS_KEY = ['teacher', 'reading-questions'] as const

/**
 * The mock keeps the same shape and mutation semantics as the future service. Cloning at
 * this boundary prevents an edit from changing the fixture imported by another screen.
 */
function copyReadingQuestionsPage(page: TeacherReadingQuestionsPage): TeacherReadingQuestionsPage {
  return {
    paper: { ...page.paper },
    questions: page.questions.map((question) => ({ ...question })),
  }
}

let currentReadingQuestions = copyReadingQuestionsPage(MOCK_TEACHER_READING_QUESTIONS)

export const teacherApi = {
  // TODO gateway: GET /teacher/home, scoped by the authenticated teacher and active class.
  getHome: async (): Promise<TeacherHome> => MOCK_TEACHER_HOME,

  // TODO gateway: GET /teacher/assignments/{assignmentId}/submissions/{studentId}/essay-check
  getEssayCheck: async (studentId: string): Promise<EssayCheck> =>
    MOCK_ESSAY_CHECKS[studentId] ?? MOCK_ESSAY_CHECK,

  // TODO gateway: POST /teacher/submissions/{studentId}/feedback
  sendFeedback: async ({ studentId }: SendFeedbackRequest): Promise<FeedbackDelivery> => ({
    studentId,
    status: 'sent',
    sentAt: new Date().toISOString(),
  }),

  // TODO gateway: GET /teacher/reading-questions, scoped by the authenticated teacher/class.
  getReadingQuestions: async (): Promise<TeacherReadingQuestionsPage> =>
    copyReadingQuestionsPage(currentReadingQuestions),

  // TODO gateway: POST /teacher/reading-questions/regenerate with { paperId, level, types }.
  regenerateReadingQuestions: async (
    input: RegenerateReadingQuestionsInput,
  ): Promise<TeacherReadingQuestionsPage> => {
    if (currentReadingQuestions.paper.id !== input.paperId) throw new Error('That paper could not be found.')

    // Regeneration replaces this worksheet while preserving the selected paper metadata.
    currentReadingQuestions = {
      ...currentReadingQuestions,
      questions: createMockReadingQuestions(input),
    }
    return copyReadingQuestionsPage(currentReadingQuestions)
  },

  // TODO gateway: PATCH /teacher/reading-questions/{questionId} with { prompt, answer }.
  updateReadingQuestion: async (input: UpdateReadingQuestionInput): Promise<TeacherReadingQuestion> => {
    const question = currentReadingQuestions.questions.find((candidate) => candidate.id === input.id)
    if (!question) throw new Error('That reading question could not be found.')

    question.prompt = input.prompt
    question.answer = input.answer
    return { ...question }
  },

  // TODO gateway: DELETE /teacher/reading-questions/{questionId}.
  deleteReadingQuestion: async (questionId: string): Promise<{ deleted: string }> => {
    const exists = currentReadingQuestions.questions.some((question) => question.id === questionId)
    if (!exists) throw new Error('That reading question could not be found.')

    currentReadingQuestions = {
      ...currentReadingQuestions,
      questions: currentReadingQuestions.questions.filter((question) => question.id !== questionId),
    }
    return { deleted: questionId }
  },
}
