/**
 * Query hooks for teacher screens.
 *
 * Screens depend on these hooks rather than importing the mock or client directly. Replacing
 * the mock client with the real gateway therefore stays a data-layer-only change.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  READING_QUESTIONS_KEY,
  TEACHER_CLASSES_KEY,
  teacherCourseWorkKey,
  teacherEssayCheckKey,
  teacherApi,
  type EssayCheck,
  type TeacherCourseWork,
  type UpdateProfessorReviewRequest,
} from './teacher'

export function useTeacherHome() {
  return useQuery({ queryKey: ['teacher', 'home'], queryFn: teacherApi.getHome })
}

export function useTeacherEssayCheck(courseWorkId: string, studentId: string) {
  return useQuery({
    queryKey: teacherEssayCheckKey(courseWorkId, studentId),
    queryFn: () => teacherApi.getEssayCheck(courseWorkId, studentId),
  })
}

export function useTeacherClasses() {
  return useQuery({ queryKey: TEACHER_CLASSES_KEY, queryFn: teacherApi.getClasses })
}

export function useTeacherCourseWork(courseId: string) {
  return useQuery({
    queryKey: teacherCourseWorkKey(courseId),
    queryFn: () => teacherApi.getCourseWork(courseId),
    enabled: Boolean(courseId),
  })
}

export function useSetCourseWorkAnalysisSelected() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ courseWorkId, selected }: { courseId: string; courseWorkId: string; selected: boolean }) =>
      teacherApi.setCourseWorkAnalysisSelected(courseWorkId, selected),
    onSuccess: (updated, { courseId }) => {
      queryClient.setQueryData<TeacherCourseWork[]>(teacherCourseWorkKey(courseId), (items) =>
        items?.map((item) => (item.id === updated.id ? updated : item)),
      )
    },
  })
}

export function useQueueSelectedCourseWork() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ courseId }: { courseId: string }) => teacherApi.queueSelectedCourseWork(courseId),
    onSuccess: (result, { courseId }) => {
      const queuedIds = new Set(result.queued)
      queryClient.setQueryData<TeacherCourseWork[]>(teacherCourseWorkKey(courseId), (items) =>
        items?.map((item) => (queuedIds.has(item.id) ? { ...item, analysisStatus: 'queued' } : item)),
      )
    },
  })
}

export function useSendTeacherFeedback() {
  return useMutation({ mutationFn: teacherApi.sendFeedback })
}

function updateEssayCache(queryClient: ReturnType<typeof useQueryClient>, essay: EssayCheck) {
  queryClient.setQueryData(teacherEssayCheckKey(essay.assignment.courseWorkId, essay.student.id), essay)
}

export function useUpdateProfessorReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProfessorReviewRequest) => teacherApi.updateProfessorReview(input),
    onSuccess: (essay) => updateEssayCache(queryClient, essay),
  })
}

export function useTeacherReadingQuestions() {
  return useQuery({
    queryKey: READING_QUESTIONS_KEY,
    queryFn: teacherApi.getReadingQuestions,
  })
}

/** Replace the selected paper's question set and refetch the authoritative store state. */
export function useRegenerateReadingQuestions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.regenerateReadingQuestions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: READING_QUESTIONS_KEY }),
  })
}

/** Save only editable content; lifecycle state and paper ownership remain server-owned. */
export function useUpdateReadingQuestion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.updateReadingQuestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: READING_QUESTIONS_KEY }),
  })
}

/** Remove one question and refetch the authoritative store state. */
export function useDeleteReadingQuestion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.deleteReadingQuestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: READING_QUESTIONS_KEY }),
  })
}
