/**
 * In-session mutable store for teacher screens. It is seeded from the mocks and owns the
 * prototype mutations until the teacher gateway is available, so the API client stays a
 * thin request-shaped boundary.
 */

import {
  MOCK_ESSAY_CHECKS,
  MOCK_TEACHER_CLASSES,
  MOCK_TEACHER_COURSEWORK,
  MOCK_TEACHER_READING_QUESTIONS,
  createMockReadingQuestions,
} from '../mocks/teacher'
import type {
  EssayCheck,
  QueueCourseWorkResult,
  RegenerateReadingQuestionsInput,
  TeacherCourse,
  TeacherCourseWork,
  TeacherReadingQuestion,
  TeacherReadingQuestionsPage,
  UpdateProfessorReviewRequest,
  UpdateReadingQuestionInput,
} from './teacher'

/** Deep clone so callers cannot mutate the fixture or the in-session database directly. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const essayCheckKey = (courseWorkId: string, studentId: string) => `${courseWorkId}:${studentId}`

const db = {
  essayChecks: clone(MOCK_ESSAY_CHECKS) as Record<string, EssayCheck>,
  courseWork: clone(MOCK_TEACHER_COURSEWORK) as TeacherCourseWork[],
  readingQuestions: clone(MOCK_TEACHER_READING_QUESTIONS) as TeacherReadingQuestionsPage,
}

export const store = {
  getClasses: (): TeacherCourse[] => clone(MOCK_TEACHER_CLASSES),

  getEssayCheck(courseWorkId: string, studentId: string): EssayCheck | null {
    const essay = db.essayChecks[essayCheckKey(courseWorkId, studentId)]
    return essay ? clone(essay) : null
  },

  updateProfessorReview({
    courseWorkId,
    studentId,
    reviewId,
    outcome,
    note,
  }: UpdateProfessorReviewRequest): EssayCheck {
    const essay = db.essayChecks[essayCheckKey(courseWorkId, studentId)]
    const review = essay?.reviews.find((candidate) => candidate.id === reviewId)
    if (!essay || !review) throw new Error('That claim could not be found.')

    review.professorReview = { outcome, note }
    return clone(essay)
  },

  getCourseWork(courseId: string): TeacherCourseWork[] {
    return db.courseWork.filter((item) => item.courseId === courseId).map((item) => clone(item))
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

  getReadingQuestions(): TeacherReadingQuestionsPage {
    return clone(db.readingQuestions)
  },

  regenerateReadingQuestions(input: RegenerateReadingQuestionsInput): TeacherReadingQuestionsPage {
    if (db.readingQuestions.paper.id !== input.paperId) throw new Error('That paper could not be found.')

    db.readingQuestions = {
      ...db.readingQuestions,
      questions: createMockReadingQuestions(input),
    }
    return clone(db.readingQuestions)
  },

  updateReadingQuestion(input: UpdateReadingQuestionInput): TeacherReadingQuestion {
    const question = db.readingQuestions.questions.find((candidate) => candidate.id === input.id)
    if (!question) throw new Error('That reading question could not be found.')

    question.prompt = input.prompt
    question.answer = input.answer
    return clone(question)
  },

  deleteReadingQuestion(questionId: string): { deleted: string } {
    const exists = db.readingQuestions.questions.some((question) => question.id === questionId)
    if (!exists) throw new Error('That reading question could not be found.')

    db.readingQuestions = {
      ...db.readingQuestions,
      questions: db.readingQuestions.questions.filter((question) => question.id !== questionId),
    }
    return { deleted: questionId }
  },
}
