/**
 * Query hooks for teacher screens.
 *
 * Screens depend on these hooks rather than importing the mock or client directly. Replacing
 * the mock client with the real gateway therefore stays a data-layer-only change.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  READING_QUESTIONS_KEY,
  teacherApi,
  type TeacherReadingQuestionsPage,
} from './teacher'

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

export function useTeacherReadingQuestions() {
  return useQuery({
    queryKey: READING_QUESTIONS_KEY,
    queryFn: teacherApi.getReadingQuestions,
  })
}

/** Replace the selected paper's question set and keep the screen cache authoritative. */
export function useRegenerateReadingQuestions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.regenerateReadingQuestions,
    onSuccess: (page) => queryClient.setQueryData(READING_QUESTIONS_KEY, page),
  })
}

/** Save only editable content; lifecycle state and paper ownership remain server-owned. */
export function useUpdateReadingQuestion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.updateReadingQuestion,
    onSuccess: (updatedQuestion) => {
      queryClient.setQueryData<TeacherReadingQuestionsPage>(READING_QUESTIONS_KEY, (page) => {
        if (!page) return page
        return {
          ...page,
          questions: page.questions.map((question) =>
            question.id === updatedQuestion.id ? updatedQuestion : question,
          ),
        }
      })
    },
  })
}

/** Remove one question and update the cached page without a second request. */
export function useDeleteReadingQuestion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: teacherApi.deleteReadingQuestion,
    onSuccess: (_result, questionId) => {
      queryClient.setQueryData<TeacherReadingQuestionsPage>(READING_QUESTIONS_KEY, (page) => {
        if (!page) return page
        return {
          ...page,
          questions: page.questions.filter((question) => question.id !== questionId),
        }
      })
    },
  })
}
