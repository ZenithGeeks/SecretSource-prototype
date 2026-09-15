/**
 * Typed client for teacher-role data.
 *
 * The teacher gateway is not available yet, so these methods return the reference-shaped
 * fixtures from `src/mocks/teacher.ts`. Keeping the request boundary here means the screen
 * will not need to change when the database-backed endpoints arrive.
 */

import { MOCK_TEACHER_HOME } from '../mocks/teacher'
import { store } from './teacherStore'

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
  /** Read-only sources selected by the application to help the professor verify the claim. */
  supportingUrls: SupportingUrl[]
  professorReview: ProfessorReview
}

/** An application-provided source the professor can open while manually checking a claim. */
export type SupportingUrl = {
  id: string
  url: string
  title?: string
  excerpt?: string
  location?: string
}

export type ProfessorReviewOutcome = 'not-reviewed' | 'supports' | 'contradicts' | 'inconclusive'

export type ProfessorReview = {
  outcome: ProfessorReviewOutcome
  note: string
}

/** Read-only course data modeled on the Google Classroom Course resource. */
export type TeacherCourse = {
  id: string
  name: string
  section: string
  room: string
  teacher: string
  studentCount: number
}

export type ClassroomMaterial = {
  id: string
  kind: 'driveFile' | 'link' | 'youtubeVideo' | 'form'
  title: string
  url: string
  description?: string
}

export type ClassroomSubmissionState =
  | 'NEW'
  | 'CREATED'
  | 'TURNED_IN'
  | 'RETURNED'
  | 'RECLAIMED_BY_STUDENT'

export type ClassroomAttachment = {
  id: string
  title: string
  mimeType: string
  url: string
}

/** Read-only coursework and submission fields follow Google Classroom resource names. */
export type TeacherCourseWork = {
  id: string
  courseId: string
  title: string
  description: string
  dueAt: string
  materials: ClassroomMaterial[]
  submissions: ClassroomStudentSubmission[]
  /** App-owned prototype state; this is not written to Google Classroom. */
  analysisSelected: boolean
  /** App-owned queue indicator for the prototype; no analysis service is called. */
  analysisStatus: 'not-queued' | 'queued'
}

export type ClassroomStudentSubmission = {
  id: string
  studentId: string
  studentName: string
  state: ClassroomSubmissionState
  alternateLink: string
  submittedAt?: string
  attachments: ClassroomAttachment[]
}

export type UpdateProfessorReviewRequest = {
  courseWorkId: string
  studentId: string
  reviewId: string
  outcome: ProfessorReviewOutcome
  note: string
}

export type QueueCourseWorkResult = {
  queued: string[]
  skipped: { id: string; reason: string }[]
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
    courseWorkId: string
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
  courseWorkId: string
  studentId: string
  body: string
  citationIds: string[]
}

export type FeedbackDelivery = {
  courseWorkId: string
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
  level: ReadingQuestionLevel
  types: ReadingQuestionType[]
}

export type UpdateReadingQuestionInput = {
  id: string
  prompt: string
  answer: string
}

export const READING_QUESTIONS_KEY = ['teacher', 'reading-questions'] as const

export const TEACHER_CLASSES_KEY = ['teacher', 'classes'] as const

export const teacherCourseWorkKey = (courseId: string) => ['teacher', 'coursework', courseId] as const

export const teacherEssayCheckKey = (courseWorkId: string, studentId: string) =>
  ['teacher', 'essay-check', courseWorkId, studentId] as const

export const teacherApi = {
  // TODO gateway: GET /teacher/home, scoped by the authenticated teacher and active class.
  getHome: async (): Promise<TeacherHome> => MOCK_TEACHER_HOME,

  // TODO gateway: GET /teacher/assignments/{assignmentId}/submissions/{studentId}/essay-check
  getEssayCheck: async (courseWorkId: string, studentId: string): Promise<EssayCheck | null> =>
    store.getEssayCheck(courseWorkId, studentId),

  // TODO gateway: PATCH /teacher/assignments/{courseWorkId}/submissions/{studentId}/claims/{reviewId}/professor-review
  updateProfessorReview: async (input: UpdateProfessorReviewRequest): Promise<EssayCheck> =>
    store.updateProfessorReview(input),

  // TODO gateway: POST /teacher/assignments/{courseWorkId}/submissions/{studentId}/feedback
  sendFeedback: async ({ courseWorkId, studentId }: SendFeedbackRequest): Promise<FeedbackDelivery> => ({
    courseWorkId,
    studentId,
    status: 'sent',
    sentAt: new Date().toISOString(),
  }),

  // TODO gateway: GET /classroom/courses (read-only Classroom API data).
  getClasses: async (): Promise<TeacherCourse[]> => store.getClasses(),

  // TODO gateway: GET /classroom/courses/{courseId}/courseWork with student submissions.
  getCourseWork: async (courseId: string): Promise<TeacherCourseWork[]> =>
    store.getCourseWork(courseId),

  // App-owned prototype state only; no mutation is sent to Classroom.
  setCourseWorkAnalysisSelected: async (
    courseWorkId: string,
    selected: boolean,
  ): Promise<TeacherCourseWork> => store.setCourseWorkAnalysisSelected(courseWorkId, selected),

  // App-owned queue demo. Only assignments with at least one submitted attachment are queued.
  queueSelectedCourseWork: async (courseId: string): Promise<QueueCourseWorkResult> =>
    store.queueSelectedCourseWork(courseId),

  // TODO gateway: GET /teacher/reading-questions, scoped by the authenticated teacher/class.
  getReadingQuestions: async (): Promise<TeacherReadingQuestionsPage> =>
    store.getReadingQuestions(),

  // TODO gateway: POST /teacher/reading-questions/regenerate with { paperId, level, types }.
  regenerateReadingQuestions: async (
    input: RegenerateReadingQuestionsInput,
  ): Promise<TeacherReadingQuestionsPage> => store.regenerateReadingQuestions(input),

  // TODO gateway: PATCH /teacher/reading-questions/{questionId} with { prompt, answer }.
  updateReadingQuestion: async (input: UpdateReadingQuestionInput): Promise<TeacherReadingQuestion> =>
    store.updateReadingQuestion(input),

  // TODO gateway: DELETE /teacher/reading-questions/{questionId}.
  deleteReadingQuestion: async (questionId: string): Promise<{ deleted: string }> =>
    store.deleteReadingQuestion(questionId),
}
