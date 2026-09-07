/** Query hooks for teacher screens. Screens read data only through these hooks so the mock
 * can later be replaced by the gateway without changing UI composition. */

import { useQuery } from '@tanstack/react-query'

import { teacherApi } from './teacher'

export function useTeacherHome() {
  return useQuery({ queryKey: ['teacher', 'home'], queryFn: teacherApi.getHome })
}
