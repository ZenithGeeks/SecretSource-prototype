import { csvText } from './csv'
import type {
  TeacherAssignment,
  TeacherClass,
  TeacherHome,
  TeacherReadingQuestion,
  TeacherReadingQuestionsPage,
  TeacherRosterMember,
  TeacherWorkspace,
  ReadingQuestionLevel,
  ReadingQuestionType,
} from './teacher'
import type { TeacherRoute } from './teacherRoutes'

export type WorkspaceTab = 'overview' | 'classwork' | 'people'

export function filterTeacherClasses(classes: TeacherClass[], query: string): TeacherClass[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return classes
  return classes.filter((course) =>
    [course.name, course.section, course.subject, course.teacherName].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  )
}

export function filterTeacherPeople(people: TeacherRosterMember[], query: string): TeacherRosterMember[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return people
  return people.filter((person) =>
    [person.name, person.role].some((value) => value.toLocaleLowerCase().includes(needle)),
  )
}

export function filterReadingQuestions(
  questions: TeacherReadingQuestion[],
  level: ReadingQuestionLevel,
  types: ReadingQuestionType[],
): TeacherReadingQuestion[] {
  return questions.filter((question) => question.level === level && types.includes(question.type))
}

export function feedbackPreview(body: string, citedPages: string[]): string {
  const match = body.split(/\r?\n/).join(' ').trim().match(/^.*?[.!?](?:\s|$)/)
  const firstSentence = match?.[0]?.trim() ?? (body.trim() || 'No feedback added yet.')
  const lines = body ? body.split(/\r?\n/).length : 0
  const citations = citedPages.length > 0 ? `, cites ${citedPages.join(', ')}` : ''
  return `“${firstSentence.replace(/^['“]|['”]$/g, '')}” — ${lines} lines${citations}`
}

export function worksheetText(page: TeacherReadingQuestionsPage, includeAnswers: boolean): string {
  const lines = [
    page.paper.title,
    page.paper.citation,
    page.paper.fileName,
    '',
  ]
  page.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.prompt}`)
    lines.push(`Source: ${question.anchor}`)
    if (question.excerpt) lines.push(`Passage: ${question.excerpt}`)
    if (includeAnswers && question.answer) lines.push(`Answer key: ${question.answer}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd() + '\n'
}

export function classResultsCsv(workspace: TeacherWorkspace): string {
  const rows: string[][] = [['Student', 'Role', 'Assignments', 'Submitted', 'Missing', 'Returned']]
  workspace.people
    .filter((person) => person.role === 'Student')
    .forEach((person) => {
      const submissions = workspace.submissions.filter((submission) => submission.studentId === person.id)
      rows.push([
        person.name,
        person.role,
        String(workspace.assignments.length),
        String(submissions.filter((submission) => submission.state !== 'missing').length),
        String(submissions.filter((submission) => submission.state === 'missing').length),
        String(submissions.filter((submission) => submission.state === 'returned').length),
      ])
    })
  return csvText(rows)
}

export function getTeacherWorkspaceTab(workspace: TeacherWorkspace, tab: WorkspaceTab): { title: string; count: number } {
  switch (tab) {
    case 'classwork':
      return { title: 'Classwork', count: workspace.assignments.length }
    case 'people':
      return { title: 'People', count: workspace.course.studentCount }
    default:
      return { title: 'Overview', count: 0 }
  }
}

export function getTeacherAssignmentSummary(assignment: TeacherAssignment): {
  submitted: number
  missing: number
  total: number
} {
  return {
    submitted: assignment.submittedCount,
    missing: assignment.missingCount,
    total: assignment.enrolledCount,
  }
}

export function workspaceStats(workspace: TeacherWorkspace): {
  classworkCount: number
  submissions: number
  returned: number
} {
  return {
    classworkCount: workspace.assignments.length,
    submissions: workspace.assignments.reduce((total, assignment) => total + assignment.enrolledCount, 0),
    returned: workspace.assignments.reduce((total, assignment) => total + assignment.returnedCount, 0),
  }
}

export function assignmentCanBeChecked(assignment: TeacherAssignment): boolean {
  return assignment.pendingReviewCount > 0 && assignment.submittedCount > 0
}

export function toggleFeedbackReview(ids: string[], reviewId: string): string[] {
  return ids.includes(reviewId) ? ids.filter((id) => id !== reviewId) : [...ids, reviewId]
}

export function homeRouteForAction(
  action: 'check-essays' | 'reading-questions',
  home: Pick<TeacherHome, 'courseId' | 'assignmentId'> = { courseId: 'class-literary-2b', assignmentId: 'assignment-essay' },
): TeacherRoute {
  return action === 'reading-questions'
    ? { screen: 'reading-questions', paperId: 'paper-colbert' }
    : { screen: 'assignment-detail', courseId: home.courseId, assignmentId: home.assignmentId }
}
