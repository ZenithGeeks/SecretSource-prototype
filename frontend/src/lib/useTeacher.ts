/**
 * Query hooks for teacher screens.
 *
 * Screens depend on these hooks rather than importing the mock or client directly. Replacing
 * the mock client with the real gateway therefore stays a data-layer-only change.
 */

import { useMutation, useQuery } from '@tanstack/react-query'

import { teacherApi } from './teacher'

export function useTeacherHome() {
  return useQuery({ queryKey: ['teacher', 'home'], queryFn: teacherApi.getHome })
}

export function useTeacherEssayCheck(studentId: string) {
  return useQuery({
    queryKey: ['teacher', 'essay-check', studentId],
    queryFn: () => teacherApi.getEssayCheck(studentId),
  })
}

export function useSendTeacherFeedback() {
  return useMutation({ mutationFn: teacherApi.sendFeedback })
}
