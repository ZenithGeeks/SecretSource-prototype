/**
 * The frontend contract for the teacher role.
 *
 * The shapes intentionally resemble the updated Figma screens rather than a future HTTP
 * response. The mock adapter below is the only place screens need to change when a gateway is
 * introduced.
 */

import { store } from './teacherStore'
import { request } from './api'
import type { FeedbackSharingByCitation } from './teacherFeedbackExport'

export type TeacherStanding = 'supports' | 'refutes' | 'insufficient' | 'unchecked'

export type ClassroomMaterial = {
  id: string
  kind: 'driveFile' | 'link' | 'youtubeVideo' | 'form'
  title: string
  url: string
  description?: string
}

export type ClassroomAttachment = {
  id: string
  title: string
  mimeType: string
  url: string
}

export type TeacherClass = {
  id: string
  name: string
  section: string
  subject: string
  status: 'active'
  teacherName: string
  studentCount: number
  assignmentCount: number
  topicCount: number
  announcementCount: number
  linkedFileCount: number
  lastSyncedAt: string
}

export type TeacherSubmission = {
  id: string
  assignmentId: string
  studentId: string
  studentName: string
  studentEmail?: string
  fileName: string
  state: 'submitted' | 'missing' | 'returned'
  submittedAt?: string
  attachments: ClassroomAttachment[]
}

export type TeacherAssignment = {
  id: string
  courseId: string
  title: string
  dueAt: string
  enrolledCount: number
  submittedCount: number
  missingCount: number
  returnedCount: number
  pendingReviewCount: number
  status: 'returned' | 'pending' | 'not-started'
  materials: ClassroomMaterial[]
}

export type TeacherAssignmentDetail = {
  assignment: TeacherAssignment
  submissions: TeacherSubmission[]
}

export type TeacherRosterMember = {
  id: string
  name: string
  initials: string
  role: 'Teacher' | 'Student'
  isCourseOwner: boolean
}

export type TeacherWorkspace = {
  course: TeacherClass
  description: string
  assignments: TeacherAssignment[]
  /** A compact preview used by the Overview tab; detail screens load the full list. */
  submissions: TeacherSubmission[]
  people: TeacherRosterMember[]
  latestAnnouncement: { title: string; postedBy: string; postedAt: string; body: string } | null
  materials: { id: string; title: string; kind: 'drive-file' | 'link'; accessible: boolean }[]
  topics: { id: string; name: string; assignmentCount: number }[]
}

export type TeacherClassImportPreview = {
  course: TeacherClass
  resources: {
    key: 'course' | 'classwork' | 'people' | 'drive'
    label: string
    count: number
    detail: string
    warning?: boolean
  }[]
}

export type TeacherHomeSubmission = TeacherSubmission & {
  courseId?: string
  courseName?: string
  assignmentTitle?: string
  initial: string
  summary: string
  reviewStatus?: 'not-checked' | 'analysis-ready'
  standing?: TeacherStanding
}

export type TeacherHomeAssignment = TeacherAssignment & {
  courseName: string
  overdue: boolean
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

export type TeacherHome = {
  user: string
  course?: string
  courseId?: string
  checkedEssays: number
  totalEssays: number
  reviewQueueCount?: number
  assignment?: string
  assignmentId?: string
  submissions: TeacherHomeSubmission[]
  dueSoon?: TeacherHomeAssignment[]
  /** Deprecated mock fields retained while legacy fixtures are migrated. */
  citationsNeedingAttention?: number
  library?: { paperCount: number; visibility: string; papers: ClassPaper[] }
  mostMisusedSource?: MostMisusedSource | null
}

export type TeacherHistoryActivity = 'analysis' | 'professor-review' | 'feedback'

export type TeacherHistoryEntry = {
  id: string
  courseId: string
  courseName: string
  assignmentId: string
  assignmentTitle: string
  submissionId: string
  studentId: string
  studentName: string
  fileName: string
  checkedAt: string
  analysisId?: string | null
  activity: TeacherHistoryActivity[]
}

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

export type EssayReview = {
  id: string
  standing: TeacherStanding
  citation: string
  claim: string
  sourceQuote: string
  sourceLocation: string
  explanation?: string
  supportingUrls: SupportingUrl[]
  paperUrl?: string
  professorReview: ProfessorReview
}

export type FeedbackDraft = {
  body: string
  preview: string
  citedPages: string[]
  citationIds: string[]
  sharingOptions?: FeedbackSharingByCitation
}

export type StudentNavigation = { id: string; name: string }

export type EssayCheck = {
  assignment: {
    assignmentId: string
    courseId: string
    course: string
    name: string
    /** Kept for a short compatibility window with the retired screen. */
    courseWorkId?: string
  }
  student: { id: string; name: string; fileName: string; email?: string | null }
  citationSummary: { total: number; contradicted: number; silent: number; backed: number }
  reviews: EssayReview[]
  feedback: FeedbackDraft
  navigation: { previous?: StudentNavigation; next?: StudentNavigation }
  analysis?: { id: string | null; status: string; error?: string | null }
}

export type TeacherGoogleConnection = {
  connected: boolean
  email: string | null
  scopes?: string[]
  sync?: {
    status: string | null
    lastSyncedAt: string | null
    error?: string | null
  }
}

export type AnalyzeTeacherSubmissionRequest = {
  courseId: string
  assignmentId: string
  studentId: string
  force?: boolean
}

export type PrepareTeacherEssayChecksRequest = { courseId: string; assignmentIds: string[] }
export type PrepareTeacherEssayChecksResult = {
  prepared: { assignmentId: string; submissionId: string; studentId: string; studentName: string; analysisId: string; status: string }[]
  skipped: { assignmentId: string; submissionId?: string; studentId?: string; studentName?: string; reason: string }[]
  failed: { assignmentId: string; submissionId?: string; studentId?: string; studentName?: string; reason: string }[]
}

export type UpdateProfessorReviewRequest = {
  courseId?: string
  assignmentId?: string
  /** Legacy URL/query name; converted inside the adapter only. */
  courseWorkId?: string
  studentId: string
  reviewId: string
  outcome: ProfessorReviewOutcome
  note: string
}

export type SendFeedbackRequest = {
  courseId?: string
  assignmentId?: string
  courseWorkId?: string
  studentId: string
  body: string
  citationIds: string[]
  sharingOptions?: FeedbackSharingByCitation
  reportHtml?: string
}

export type FeedbackDelivery = {
  assignmentId: string
  studentId: string
  status: 'sent'
  sentAt: string
}

export type ReadingQuestionLevel = 'undergrad' | 'graduate'
export type ReadingQuestionType = 'comprehension' | 'critique' | 'discussion'

export type ReadingQuestionPaper = {
  id: string
  title: string
  citation: string
  fileName: string
  verifiedClaims: number
  paperUrl: string
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

// Retained while the old teacher screens are replaced one route at a time.
export type TeacherCourse = {
  id: string
  name: string
  section: string
  room: string
  teacher: string
  studentCount: number
}

export type ClassroomSubmissionState = 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT'

export type ClassroomStudentSubmission = {
  id: string
  studentId: string
  studentName: string
  state: ClassroomSubmissionState
  alternateLink: string
  submittedAt?: string
  attachments: ClassroomAttachment[]
}

export type TeacherCourseWork = {
  id: string
  courseId: string
  title: string
  description: string
  dueAt: string
  materials: ClassroomMaterial[]
  submissions: ClassroomStudentSubmission[]
  analysisSelected: boolean
  analysisStatus: 'not-queued' | 'queued'
}

export type QueueCourseWorkResult = { queued: string[]; skipped: { id: string; reason: string }[] }

export const TEACHER_HOME_KEY = ['teacher', 'home'] as const
export const TEACHER_HISTORY_KEY = ['teacher', 'history'] as const
export const TEACHER_CLASSES_KEY = ['teacher', 'classes'] as const
export const READING_QUESTIONS_KEY = ['teacher', 'reading-questions'] as const
export const teacherClassImportKey = (courseId: string) => ['teacher', 'class-import', courseId] as const
export const teacherWorkspaceKey = (courseId: string) => ['teacher', 'workspace', courseId] as const
export const teacherAssignmentKey = (courseId: string, assignmentId: string) =>
  ['teacher', 'assignment', courseId, assignmentId] as const
export const teacherEssayCheckKey = (courseId: string, assignmentId: string, studentId: string) =>
  ['teacher', 'essay-check', courseId, assignmentId, studentId] as const
export const teacherReadingQuestionsKey = (paperId?: string) =>
  ['teacher', 'reading-questions', paperId] as const

// Legacy cache key retained for older screens during the migration.
export const teacherCourseWorkKey = (courseId: string) => ['teacher', 'coursework', courseId] as const

function normalizedAssignmentId(input: { assignmentId?: string; courseWorkId?: string }): string {
  return input.assignmentId ?? input.courseWorkId ?? ''
}

const mockTeacherApi = {
  getHome: async (): Promise<TeacherHome> => store.getHome(),
  getHistory: async (): Promise<TeacherHistoryEntry[]> => store.getHistory(),
  getClasses: async (): Promise<TeacherClass[]> => store.getClasses(),
  getImportableClasses: async (): Promise<TeacherClass[]> => store.getImportableClasses(),
  getClassImportPreview: async (courseId: string): Promise<TeacherClassImportPreview | null> =>
    store.getClassImportPreview(courseId),
  importClass: async (courseId: string): Promise<TeacherClass> => store.importClass(courseId),
  getWorkspace: async (courseId: string): Promise<TeacherWorkspace | null> => store.getWorkspace(courseId),
  refreshClass: async (courseId: string): Promise<TeacherWorkspace | null> => store.getWorkspace(courseId),
  getAssignmentDetail: async (courseId: string, assignmentId: string): Promise<TeacherAssignmentDetail | null> =>
    store.getAssignmentDetail(courseId, assignmentId),
  analyzeSubmission: async (_input: AnalyzeTeacherSubmissionRequest) => {
    throw new Error('Essay analysis requires a connected Google Classroom account.')
  },
  prepareEssayChecks: async (_input: PrepareTeacherEssayChecksRequest): Promise<PrepareTeacherEssayChecksResult> => {
    throw new Error('Essay analysis requires a connected Google Classroom account.')
  },
  getEssayCheck: async (assignmentId: string, studentId: string, _courseId?: string): Promise<EssayCheck | null> =>
    store.getEssayCheck(normalizedAssignmentId({ assignmentId }), studentId),
  saveFeedback: async (input: { assignmentId: string; studentId: string; body: string; citationIds: string[]; sharingOptions?: FeedbackSharingByCitation }): Promise<EssayCheck> =>
    store.saveFeedback(input.assignmentId, input.studentId, {
      body: input.body,
      citationIds: input.citationIds,
      sharingOptions: input.sharingOptions,
    }),
  updateProfessorReview: async (input: UpdateProfessorReviewRequest): Promise<EssayCheck> =>
    store.updateProfessorReview({ ...input, assignmentId: normalizedAssignmentId(input) }),
  sendFeedback: async (input: SendFeedbackRequest): Promise<FeedbackDelivery> =>
    store.sendFeedback({ ...input, assignmentId: normalizedAssignmentId(input) }),
  getReadingQuestions: async (paperId?: string): Promise<TeacherReadingQuestionsPage> =>
    store.getReadingQuestions(paperId),
  regenerateReadingQuestions: async (
    input: RegenerateReadingQuestionsInput,
  ): Promise<TeacherReadingQuestionsPage> => store.regenerateReadingQuestions(input),
  updateReadingQuestion: async (input: UpdateReadingQuestionInput): Promise<TeacherReadingQuestion> =>
    store.updateReadingQuestion(input),
  deleteReadingQuestion: async (questionId: string): Promise<{ deleted: string }> =>
    store.deleteReadingQuestion(questionId),
  resetMockTeacherData: async (): Promise<void> => store.resetMockTeacherData(),

  // Compatibility methods for the legacy screens while their routes are replaced.
  getCourseWork: async (courseId: string): Promise<TeacherCourseWork[]> => store.getCourseWork(courseId),
  setCourseWorkAnalysisSelected: async (
    courseWorkId: string,
    selected: boolean,
  ): Promise<TeacherCourseWork> => store.setCourseWorkAnalysisSelected(courseWorkId, selected),
  queueSelectedCourseWork: async (courseId: string): Promise<QueueCourseWorkResult> =>
    store.queueSelectedCourseWork(courseId),
  getGoogleConnection: async (_signal?: AbortSignal): Promise<TeacherGoogleConnection> => ({ connected: false, email: null, scopes: [] }),
  startGoogleConnection: async (): Promise<{ authorizationUrl: string }> => {
    throw new Error('Google Classroom is unavailable in mock mode.')
  },
}

export const teacherRemoteEnabled = import.meta.env.VITE_TEACHER_BACKEND === 'remote'

export const createRemoteTeacherApi = () => ({
  ...mockTeacherApi,
  getHome: () => request<TeacherHome>('/teacher/home'),
  getHistory: () => request<TeacherHistoryEntry[]>('/teacher/history'),
  getClasses: () => request<TeacherClass[]>('/teacher/classes'),
  getImportableClasses: () => request<TeacherClass[]>('/teacher/classes/importable'),
  getClassImportPreview: (courseId: string) => request<TeacherClassImportPreview>(`/teacher/classes/importable/${encodeURIComponent(courseId)}/preview`),
  importClass: async (courseId: string) => (await request<{ course: TeacherClass }>(`/teacher/classes/${encodeURIComponent(courseId)}/import`, { method: 'POST' })).course,
  getWorkspace: (courseId: string) => request<TeacherWorkspace>(`/teacher/classes/${encodeURIComponent(courseId)}/workspace`),
  refreshClass: async (courseId: string) => (await request<{ workspace: TeacherWorkspace }>(`/teacher/classes/${encodeURIComponent(courseId)}/refresh`, { method: 'POST' })).workspace,
  getAssignmentDetail: (courseId: string, assignmentId: string) =>
    request<TeacherAssignmentDetail>(`/teacher/classes/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`),
  getEssayCheck: (assignmentId: string, studentId: string, courseId?: string) =>
    courseId
      ? request<EssayCheck>(`/teacher/classes/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/essay-check`)
      : Promise.resolve(null),
  analyzeSubmission: (input: AnalyzeTeacherSubmissionRequest) =>
    request<{ id: string; status: string; submission_id: string }>(
      `/teacher/classes/${encodeURIComponent(input.courseId)}/assignments/${encodeURIComponent(input.assignmentId)}/students/${encodeURIComponent(input.studentId)}/analyze${input.force ? '?force=true' : ''}`,
      { method: 'POST' },
    ),
  prepareEssayChecks: (input: PrepareTeacherEssayChecksRequest) =>
    request<PrepareTeacherEssayChecksResult>(`/teacher/classes/${encodeURIComponent(input.courseId)}/essay-checks:prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentIds: input.assignmentIds }),
    }),
  updateProfessorReview: (input: UpdateProfessorReviewRequest) => {
    if (!input.courseId) throw new Error('courseId is required for a remote professor review')
    const assignmentId = normalizedAssignmentId(input)
    return request<EssayCheck>(
      `/teacher/classes/${encodeURIComponent(input.courseId)}/assignments/${encodeURIComponent(assignmentId)}/essay-check/reviews/${encodeURIComponent(input.reviewId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: input.studentId, outcome: input.outcome, note: input.note }),
      },
    )
  },
  saveFeedback: (input: { courseId: string; assignmentId: string; studentId: string; body: string; citationIds: string[]; sharingOptions?: FeedbackSharingByCitation }) =>
    request<EssayCheck>(
      `/teacher/classes/${encodeURIComponent(input.courseId)}/assignments/${encodeURIComponent(input.assignmentId)}/essay-check/feedback`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: input.studentId, body: input.body, citationIds: input.citationIds, sharingOptions: input.sharingOptions }),
      },
    ),
  sendFeedback: (input: SendFeedbackRequest) => {
    if (!input.courseId) throw new Error('courseId is required for remote feedback')
    const assignmentId = normalizedAssignmentId(input)
    return request<FeedbackDelivery>(
      `/teacher/classes/${encodeURIComponent(input.courseId)}/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(input.studentId)}/essay-check/feedback/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: input.studentId, body: input.body, citationIds: input.citationIds, sharingOptions: input.sharingOptions, reportHtml: input.reportHtml }),
      },
    )
  },
  getGoogleConnection: (signal?: AbortSignal) => request<TeacherGoogleConnection>('/teacher/google/status', { signal }),
  startGoogleConnection: (email?: string, switchAccount = false) => request<{ authorizationUrl: string }>(`/teacher/google/connect?${new URLSearchParams({ ...(email ? { loginHint: email } : {}), ...(switchAccount ? { switch: 'true' } : {}) })}`),
})

const remoteTeacherApi = createRemoteTeacherApi()

export const teacherApi = teacherRemoteEnabled ? remoteTeacherApi : mockTeacherApi
