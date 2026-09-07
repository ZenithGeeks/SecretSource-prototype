/**
 * Typed client for the teacher-role data.
 *
 * The teacher gateway endpoint is not available yet, so the client is mock-backed for this
 * screen. Once the backend contract is ready, replace `getHome` with a request to
 * `/teacher/home`; the types, hook, and screen should not need to change.
 */

import { MOCK_TEACHER_HOME } from '../mocks/teacher'

/** The reader-facing standing shown beside each student's checked essay. */
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

export const teacherApi = {
  // TODO gateway: GET /teacher/home, scoped by the authenticated teacher and active class.
  getHome: async (): Promise<TeacherHome> => MOCK_TEACHER_HOME,
}
