/**
 * Session-local mock database for the teacher role.
 *
 * Every read and write crosses a clone boundary. Screens can therefore behave like they are
 * talking to an API without being able to mutate the fixtures or another screen's cache.
 */

import {
  MOCK_ESSAY_CHECKS,
  MOCK_TEACHER_ASSIGNMENT_DETAILS,
  MOCK_TEACHER_ASSIGNMENTS,
  MOCK_TEACHER_CLASSES,
  MOCK_TEACHER_COURSEWORK,
  MOCK_TEACHER_HOME,
  MOCK_TEACHER_IMPORT_COURSES,
  MOCK_TEACHER_IMPORT_PREVIEWS,
  MOCK_TEACHER_READING_QUESTIONS,
  MOCK_TEACHER_WORKSPACES,
  createMockReadingQuestions,
} from '../mocks/teacher'
import type {
  EssayCheck,
  QueueCourseWorkResult,
  RegenerateReadingQuestionsInput,
  TeacherAssignment,
  TeacherAssignmentDetail,
  TeacherClass,
  TeacherClassImportPreview,
  TeacherCourseWork,
  TeacherHome,
  TeacherHistoryEntry,
  TeacherReadingQuestion,
  TeacherReadingQuestionsPage,
  TeacherWorkspace,
  UpdateProfessorReviewRequest,
  UpdateReadingQuestionInput,
  SendFeedbackRequest,
} from './teacher'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type TeacherDb = {
  home: TeacherHome
  history: TeacherHistoryEntry[]
  classes: TeacherClass[]
  workspaces: Record<string, TeacherWorkspace>
  assignments: TeacherAssignment[]
  assignmentDetails: Record<string, TeacherAssignmentDetail>
  essayChecks: Record<string, EssayCheck>
  readingQuestions: TeacherReadingQuestionsPage
  courseWork: TeacherCourseWork[]
}

const initialDb = (): TeacherDb => ({
  home: clone(MOCK_TEACHER_HOME),
  history: clone(MOCK_TEACHER_HOME.submissions
    .filter((item) => item.reviewStatus === 'analysis-ready' && item.courseId && item.assignmentId)
    .map((item) => ({
      id: `${item.courseId}:${item.assignmentId}:${item.studentId}`,
      courseId: item.courseId!,
      courseName: item.courseName ?? '',
      assignmentId: item.assignmentId,
      assignmentTitle: item.assignmentTitle ?? item.assignmentId,
      submissionId: item.id,
      studentId: item.studentId,
      studentName: item.studentName,
      fileName: item.fileName,
      checkedAt: item.submittedAt ?? '',
      activity: ['analysis'],
    } satisfies TeacherHistoryEntry))),
  classes: clone(MOCK_TEACHER_CLASSES),
  workspaces: clone(MOCK_TEACHER_WORKSPACES),
  assignments: clone(MOCK_TEACHER_ASSIGNMENTS),
  assignmentDetails: clone(MOCK_TEACHER_ASSIGNMENT_DETAILS),
  essayChecks: clone(MOCK_ESSAY_CHECKS),
  readingQuestions: clone(MOCK_TEACHER_READING_QUESTIONS),
  courseWork: clone(MOCK_TEACHER_COURSEWORK),
})

let db = initialDb()

function resolveAssignmentId(id: string): string {
  return id === 'coursework-assignment-2' ? 'assignment-essay' : id
}

function essayKey(assignmentId: string, studentId: string): string {
  return `${resolveAssignmentId(assignmentId)}:${studentId}`
}

function assignmentDetailKey(courseId: string, assignmentId: string): string {
  return `${courseId}:${resolveAssignmentId(assignmentId)}`
}

function feedbackPreview(body: string, citedPages: string[]): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'No feedback added yet.'
  const sentence = firstLine.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? firstLine
  const lines = body ? body.split(/\r?\n/).length : 0
  const pages = citedPages.length > 0 ? `, cites ${citedPages.join(', ')}` : ''
  return `"${sentence.replace(/^['"]|['"]$/g, '')}" - ${lines} lines${pages}`
}

function touchHistory(essay: EssayCheck, activity: TeacherHistoryEntry['activity'][number]) {
  const courseId = essay.assignment.courseId
  const assignmentId = essay.assignment.assignmentId
  const studentId = essay.student.id
  const id = `${courseId}:${assignmentId}:${studentId}`
  const existing = db.history.find((entry) => entry.id === id)
  const activities = new Set(existing?.activity ?? [])
  activities.add(activity)
  db.history = [
    {
      id,
      courseId,
      courseName: essay.assignment.course,
      assignmentId,
      assignmentTitle: essay.assignment.name,
      submissionId: existing?.submissionId ?? studentId,
      studentId,
      studentName: essay.student.name,
      fileName: essay.student.fileName,
      checkedAt: new Date().toISOString(),
      analysisId: essay.analysis?.id,
      activity: (['analysis', 'professor-review', 'feedback'] as const).filter((item) => activities.has(item)),
    },
    ...db.history.filter((entry) => entry.id !== id),
  ]
}

export const teacherStore = {
  async getHome(): Promise<TeacherHome> {
    return clone(db.home)
  },

  async getHistory(): Promise<TeacherHistoryEntry[]> {
    return clone(db.history)
  },

  async getClasses(): Promise<TeacherClass[]> {
    return clone(db.classes)
  },

  async getImportableClasses(): Promise<TeacherClass[]> {
    return clone(MOCK_TEACHER_IMPORT_COURSES)
  },

  async getClassImportPreview(courseId: string): Promise<TeacherClassImportPreview | null> {
    const preview = MOCK_TEACHER_IMPORT_PREVIEWS[courseId]
    return preview ? clone(preview) : null
  },

  async importClass(courseId: string): Promise<TeacherClass> {
    const course = MOCK_TEACHER_IMPORT_COURSES.find((candidate) => candidate.id === courseId)
    if (!course) throw new Error('That class could not be found in the available courses.')

    if (!db.classes.some((candidate) => candidate.id === courseId)) {
      db.classes.push(clone(course))
    }
    if (!db.workspaces[courseId]) {
      const workspace = MOCK_TEACHER_WORKSPACES[courseId]
      if (workspace) db.workspaces[courseId] = clone(workspace)
    }
    return clone(course)
  },

  async getWorkspace(courseId: string): Promise<TeacherWorkspace | null> {
    const workspace = db.workspaces[courseId]
    return workspace ? clone(workspace) : null
  },

  async getAssignments(courseId: string): Promise<TeacherAssignment[]> {
    return db.assignments.filter((assignment) => assignment.courseId === courseId).map(clone)
  },

  async getAssignmentDetail(courseId: string, assignmentId: string): Promise<TeacherAssignmentDetail | null> {
    const detail = db.assignmentDetails[assignmentDetailKey(courseId, assignmentId)]
    if (detail) return clone(detail)

    const assignment = db.assignments.find(
      (candidate) => candidate.courseId === courseId && candidate.id === resolveAssignmentId(assignmentId),
    )
    return assignment ? { assignment: clone(assignment), submissions: [] } : null
  },

  async getEssayCheck(assignmentId: string, studentId: string): Promise<EssayCheck | null> {
    const essay = db.essayChecks[essayKey(assignmentId, studentId)]
    return essay ? clone(essay) : null
  },

  async updateProfessorReview(input: UpdateProfessorReviewRequest & { assignmentId: string }): Promise<EssayCheck> {
    const assignmentId = resolveAssignmentId(input.assignmentId)
    const essay = db.essayChecks[essayKey(assignmentId, input.studentId)]
    const review = essay?.reviews.find((candidate) => candidate.id === input.reviewId)
    if (!essay || !review) throw new Error('That citation could not be found.')

    review.professorReview = { outcome: input.outcome, note: input.note }
    touchHistory(essay, 'professor-review')
    return clone(essay)
  },

  async saveFeedback(
    assignmentId: string,
    studentId: string,
    input: { body: string; subject?: string; citationIds: string[]; sharingOptions?: EssayCheck['feedback']['sharingOptions'] },
  ): Promise<EssayCheck> {
    const essay = db.essayChecks[essayKey(assignmentId, studentId)]
    if (!essay) throw new Error('That essay could not be found.')
    const citedPages = essay.reviews
      .filter((review) => input.citationIds.includes(review.id))
      .map((review) => review.sourceLocation)

    essay.feedback = {
      ...essay.feedback,
      body: input.body,
      subject: input.subject ?? essay.feedback.subject,
      citationIds: [...new Set(input.citationIds)],
      sharingOptions: input.sharingOptions ?? {},
      citedPages,
      preview: feedbackPreview(input.body, citedPages),
    }
    if (input.body.trim()) touchHistory(essay, 'feedback')
    return clone(essay)
  },

  async sendFeedback(input: SendFeedbackRequest & { assignmentId: string }): Promise<{
    assignmentId: string
    studentId: string
    status: 'sent'
    sentAt: string
  }> {
    await this.saveFeedback(input.assignmentId, input.studentId, {
      body: input.body,
      subject: input.subject,
      citationIds: input.citationIds,
      sharingOptions: input.sharingOptions ?? {},
    })
    return {
      assignmentId: resolveAssignmentId(input.assignmentId),
      studentId: input.studentId,
      status: 'sent',
      sentAt: new Date().toISOString(),
    }
  },

  getReadingQuestions(paperId = 'paper-colbert'): TeacherReadingQuestionsPage {
    if (paperId !== db.readingQuestions.paper.id) throw new Error('That paper could not be found.')
    return clone(db.readingQuestions)
  },

  async regenerateReadingQuestions(input: RegenerateReadingQuestionsInput): Promise<TeacherReadingQuestionsPage> {
    if (db.readingQuestions.paper.id !== input.paperId) throw new Error('That paper could not be found.')
    db.readingQuestions = { ...db.readingQuestions, questions: createMockReadingQuestions(input) }
    return clone(db.readingQuestions)
  },

  async updateReadingQuestion(input: UpdateReadingQuestionInput): Promise<TeacherReadingQuestion> {
    const question = db.readingQuestions.questions.find((candidate) => candidate.id === input.id)
    if (!question) throw new Error('That reading question could not be found.')
    question.prompt = input.prompt
    question.answer = input.answer
    return clone(question)
  },

  async deleteReadingQuestion(questionId: string): Promise<{ deleted: string }> {
    const exists = db.readingQuestions.questions.some((question) => question.id === questionId)
    if (!exists) throw new Error('That reading question could not be found.')
    db.readingQuestions = {
      ...db.readingQuestions,
      questions: db.readingQuestions.questions.filter((question) => question.id !== questionId),
    }
    return { deleted: questionId }
  },

  async resetMockTeacherData(): Promise<void> {
    db = initialDb()
  },

  // Compatibility methods for the old classwork screen until that route is replaced.
  getCourseWork(courseId: string): TeacherCourseWork[] {
    return db.courseWork.filter((item) => item.courseId === courseId).map(clone)
  },

  setCourseWorkAnalysisSelected(courseWorkId: string, selected: boolean): TeacherCourseWork {
    const item = db.courseWork.find((candidate) => candidate.id === courseWorkId)
    if (!item) throw new Error('That assignment could not be found.')
    item.analysisSelected = selected
    return clone(item)
  },

  queueSelectedCourseWork(courseId: string): QueueCourseWorkResult {
    const selected = db.courseWork.filter((item) => item.courseId === courseId && item.analysisSelected)
    const result: QueueCourseWorkResult = { queued: [], skipped: [] }
    for (const item of selected) {
      const eligible = item.submissions.some(
        (submission) => submission.state === 'TURNED_IN' && submission.attachments.length > 0,
      )
      if (!eligible) {
        result.skipped.push({ id: item.id, reason: 'No turned-in submission has an attachment.' })
        continue
      }
      item.analysisStatus = 'queued'
      result.queued.push(item.id)
    }
    return result
  },
}

/** Public alias used by tests and the Settings reset action. */
export const store = teacherStore
export const resetTeacherStore = () => {
  db = initialDb()
}
