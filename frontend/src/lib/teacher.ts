/**
 * Typed client for teacher-role data.
 *
 * The teacher gateway is not available yet, so these methods return the reference-shaped
 * fixtures from `src/mocks/teacher.ts`. Keeping the request boundary here means the screen
 * will not need to change when the database-backed endpoints arrive.
 */

import { MOCK_ESSAY_CHECK, MOCK_ESSAY_CHECKS, MOCK_TEACHER_HOME } from '../mocks/teacher'

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
}
