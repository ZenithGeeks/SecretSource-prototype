export const TEACHER_GOOGLE_RETURN_KEY = 'teacher-google-oauth-returned-at'

const MAX_RETURN_AGE_MS = 10 * 60 * 1000

export function markTeacherGoogleReturn() {
  try {
    window.sessionStorage.setItem(TEACHER_GOOGLE_RETURN_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable in restricted browser contexts; OAuth still completes.
  }
}

export function consumeTeacherGoogleReturn(): boolean {
  try {
    const value = window.sessionStorage.getItem(TEACHER_GOOGLE_RETURN_KEY)
    window.sessionStorage.removeItem(TEACHER_GOOGLE_RETURN_KEY)
    if (!value) return false
    const timestamp = Number(value)
    const age = Date.now() - timestamp
    return Number.isFinite(timestamp) && age >= 0 && age <= MAX_RETURN_AGE_MS
  } catch {
    return false
  }
}
