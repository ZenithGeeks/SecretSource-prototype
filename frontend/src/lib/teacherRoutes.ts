/** URL-backed destinations owned by the teacher role. */

export type TeacherScreen =
  | 'home'
  | 'classes'
  | 'add-class-connect'
  | 'add-class-course'
  | 'add-class-review'
  | 'class-overview'
  | 'classwork'
  | 'people'
  | 'assignment-detail'
  | 'essay-check'
  | 'reading-questions'
  | 'settings'
  | 'graph'

export type TeacherNavKey = 'home' | 'classes' | 'library' | 'graph' | 'settings'

export type TeacherRoute = {
  screen: TeacherScreen
  courseId?: string
  assignmentId?: string
  studentId?: string
  paperId?: string
}

export const TEACHER_NAV_KEYS: readonly TeacherNavKey[] = ['home', 'classes', 'library', 'graph', 'settings']

const SCREENS: readonly TeacherScreen[] = [
  'home',
  'classes',
  'add-class-connect',
  'add-class-course',
  'add-class-review',
  'class-overview',
  'classwork',
  'people',
  'assignment-detail',
  'essay-check',
  'reading-questions',
  'settings',
  'graph',
]

function isTeacherScreen(value: string | null): value is TeacherScreen {
  return value !== null && SCREENS.includes(value as TeacherScreen)
}

function valueOrUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function fromPath(input: string): TeacherRoute | null {
  const parts = input.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length === 0) return null

  const screen = parts[0]
  if (!isTeacherScreen(screen)) {
    if (screen === 'classroom' && parts[1] === 'course' && parts[3] === 'assignment') {
      return {
        screen: 'assignment-detail',
        courseId: parts[2],
        assignmentId: parts[4],
      }
    }
    if (screen === 'classroom' && parts[1] && parts[2] === 'assignment') {
      return {
        screen: 'assignment-detail',
        courseId: parts[1],
        assignmentId: parts[3],
      }
    }
    return null
  }

  switch (screen) {
    case 'essay-check':
      return parts[1] && parts[2]
        ? { screen, assignmentId: parts[1], studentId: parts[2] }
        : { screen }
    case 'assignment-detail':
      return parts[1] && parts[2]
        ? { screen, courseId: parts[1], assignmentId: parts[2] }
        : { screen }
    case 'reading-questions':
      return parts[1] ? { screen, paperId: parts[1] } : { screen }
    case 'add-class-review':
      return parts[1] ? { screen, courseId: parts[1] } : { screen }
    case 'class-overview':
    case 'classwork':
    case 'people':
      return parts[1] ? { screen, courseId: parts[1] } : { screen }
    default:
      return { screen }
  }
}

/**
 * Parse either the role query string used by the app or a compact route path used by tests and
 * links. Invalid destinations intentionally fall back to the safe teacher home screen.
 */
export function parseTeacherRoute(input: string): TeacherRoute {
  if (!input || (!input.includes('=') && !input.startsWith('?'))) {
    return fromPath(input) ?? { screen: 'home' }
  }

  const params = new URLSearchParams(input.startsWith('?') ? input : `?${input}`)
  const screen = params.get('screen')
  if (!isTeacherScreen(screen)) return { screen: 'home' }

  switch (screen) {
    case 'add-class-course':
    case 'add-class-review':
    case 'class-overview':
    case 'classwork':
    case 'people':
      return params.get('courseId')
        ? { screen, courseId: valueOrUndefined(params.get('courseId')) }
        : { screen }
    case 'assignment-detail':
      {
        const route: TeacherRoute = { screen }
        const courseId = valueOrUndefined(params.get('courseId'))
        const assignmentId = valueOrUndefined(params.get('assignmentId'))
        const studentId = valueOrUndefined(params.get('studentId'))
        if (courseId) route.courseId = courseId
        if (assignmentId) route.assignmentId = assignmentId
        if (studentId) route.studentId = studentId
        return route
      }
    case 'essay-check':
      {
        const route: TeacherRoute = { screen }
        const courseId = valueOrUndefined(params.get('courseId'))
        const assignmentId = valueOrUndefined(params.get('assignmentId') ?? params.get('courseWorkId'))
        const studentId = valueOrUndefined(params.get('studentId'))
        if (courseId) route.courseId = courseId
        if (assignmentId) route.assignmentId = assignmentId
        if (studentId) route.studentId = studentId
        return route
      }
    case 'reading-questions':
      return { screen, paperId: valueOrUndefined(params.get('paperId')) }
    default:
      return { screen }
  }
}

function consumedContext(screen: TeacherScreen): (keyof Omit<TeacherRoute, 'screen'>)[] {
  switch (screen) {
    case 'add-class-review':
    case 'add-class-course':
    case 'class-overview':
    case 'classwork':
    case 'people':
      return ['courseId']
    case 'assignment-detail':
      return ['courseId', 'assignmentId', 'studentId']
    case 'essay-check':
      return ['courseId', 'assignmentId', 'studentId']
    case 'reading-questions':
      return ['paperId']
    default:
      return []
  }
}

/** Serialize a teacher route while removing stale detail context from the current query. */
export function serializeTeacherRoute(route: TeacherRoute, search?: string): string {
  const params = new URLSearchParams(search?.startsWith('?') ? search : search ? `?${search}` : '')
  params.set('role', 'teacher')
  params.set('screen', route.screen)

  const keys: (keyof Omit<TeacherRoute, 'screen'>)[] = ['courseId', 'assignmentId', 'studentId', 'paperId']
  const consumed = new Set(consumedContext(route.screen))
  for (const key of keys) {
    const value = consumed.has(key) ? route[key] : undefined
    if (value) params.set(key, value)
    else params.delete(key)
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function teacherRouteForNav(key: TeacherNavKey): TeacherRoute {
  switch (key) {
    case 'library':
      return { screen: 'reading-questions' }
    default:
      return { screen: key }
  }
}

export function teacherNavForScreen(screen: TeacherScreen): TeacherNavKey | null {
  switch (screen) {
    case 'home':
      return 'home'
    case 'classes':
      return 'classes'
    case 'reading-questions':
      return 'library'
    case 'graph':
      return 'graph'
    case 'settings':
      return 'settings'
    default:
      return screen === 'add-class-connect' || screen === 'add-class-course' || screen === 'add-class-review'
        ? 'classes'
        : screen === 'assignment-detail' || screen === 'essay-check' || screen === 'class-overview' || screen === 'classwork' || screen === 'people'
          ? 'classes'
          : null
  }
}
