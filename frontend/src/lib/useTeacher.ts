/** TanStack Query hooks that keep teacher screens independent of the mock data source. */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  READING_QUESTIONS_KEY,
  TEACHER_CLASSES_KEY,
  TEACHER_HOME_KEY,
  TEACHER_HISTORY_KEY,
  teacherApi,
  teacherAssignmentKey,
  teacherClassImportKey,
  teacherCourseWorkKey,
  teacherEssayCheckKey,
  teacherReadingQuestionsKey,
  teacherWorkspaceKey,
  type EssayCheck,
  type AnalyzeTeacherSubmissionRequest,
  type PrepareTeacherEssayChecksRequest,
  type TeacherAssignmentDetail,
  type TeacherCourseWork,
  type TeacherReadingQuestionsPage,
  type TeacherWorkspace,
  type UpdateProfessorReviewRequest,
} from './teacher'

export function useTeacherHome() {
  return useQuery({ queryKey: TEACHER_HOME_KEY, queryFn: teacherApi.getHome })
}

export function useTeacherHistory() {
  return useQuery({
    queryKey: TEACHER_HISTORY_KEY,
    queryFn: teacherApi.getHistory,
  })
}

export function useTeacherClasses(enabled = true) {
  return useQuery({ queryKey: TEACHER_CLASSES_KEY, queryFn: teacherApi.getClasses, enabled })
}

export function useTeacherImportableClasses() {
  return useQuery({ queryKey: ['teacher', 'importable-classes'], queryFn: teacherApi.getImportableClasses })
}

export function useTeacherClassImportPreview(courseId: string) {
  return useQuery({
    queryKey: teacherClassImportKey(courseId),
    queryFn: () => teacherApi.getClassImportPreview(courseId),
    enabled: Boolean(courseId),
  })
}

export function useImportTeacherClass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => teacherApi.importClass(courseId),
    onSuccess: (_course, courseId) => {
      queryClient.invalidateQueries({ queryKey: TEACHER_CLASSES_KEY })
      queryClient.invalidateQueries({ queryKey: teacherWorkspaceKey(courseId) })
    },
  })
}

export function useTeacherWorkspace(courseId: string) {
  return useQuery<TeacherWorkspace | null>({
    queryKey: teacherWorkspaceKey(courseId),
    queryFn: () => teacherApi.getWorkspace(courseId),
    enabled: Boolean(courseId),
  })
}

export function useTeacherAssignmentDetail(courseId: string, assignmentId: string) {
  return useQuery<TeacherAssignmentDetail | null>({
    queryKey: teacherAssignmentKey(courseId, assignmentId),
    queryFn: () => teacherApi.getAssignmentDetail(courseId, assignmentId),
    enabled: Boolean(courseId && assignmentId),
  })
}

export function useTeacherEssayCheck(courseId: string, assignmentId: string, studentId: string) {
  const queryClient = useQueryClient()
  const query = useQuery<EssayCheck | null>({
    queryKey: teacherEssayCheckKey(courseId, assignmentId, studentId),
    queryFn: () => teacherApi.getEssayCheck(assignmentId, studentId, courseId),
    enabled: Boolean(courseId && assignmentId && studentId),
    refetchInterval: (query) => query.state.data?.analysis?.status === 'running' ? 2000 : false,
  })
  useEffect(() => {
    if (query.data?.analysis?.status === 'done') {
      void queryClient.invalidateQueries({ queryKey: TEACHER_HISTORY_KEY })
    }
  }, [query.data?.analysis?.id, query.data?.analysis?.status, queryClient])
  return query
}

export function useRefreshTeacherClass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => teacherApi.refreshClass(courseId),
    onSuccess: (workspace, courseId) => {
      if (workspace) queryClient.setQueryData(teacherWorkspaceKey(courseId), workspace)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teacher', 'assignment', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['teacher', 'essay-check', courseId] }),
      ])
    },
  })
}

export function useTeacherGoogleConnection() {
  return useQuery({
    queryKey: ['teacher', 'google-connection'],
    queryFn: ({ signal }) => {
      const timeout = AbortSignal.timeout(10_000)
      const requestSignal = typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeout])
        : timeout
      return teacherApi.getGoogleConnection(requestSignal)
    },
    retry: false,
  })
}

function updateEssayCache(queryClient: ReturnType<typeof useQueryClient>, essay: EssayCheck, courseId: string) {
  queryClient.setQueryData(teacherEssayCheckKey(courseId, essay.assignment.assignmentId, essay.student.id), essay)
}

export function useUpdateProfessorReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProfessorReviewRequest) => teacherApi.updateProfessorReview(input),
    onSuccess: (essay, input) => {
      updateEssayCache(queryClient, essay, input.courseId ?? essay.assignment.courseId)
      return queryClient.invalidateQueries({ queryKey: TEACHER_HISTORY_KEY })
    },
  })
}

export function useAnalyzeTeacherSubmission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AnalyzeTeacherSubmissionRequest) => teacherApi.analyzeSubmission(input),
    onSuccess: (_result, input) => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: TEACHER_HOME_KEY }),
        queryClient.invalidateQueries({ queryKey: TEACHER_HISTORY_KEY }),
        queryClient.invalidateQueries({
          queryKey: teacherEssayCheckKey(input.courseId, input.assignmentId, input.studentId),
        }),
      ])
    },
  })
}

export function usePrepareTeacherEssayChecks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PrepareTeacherEssayChecksRequest) => teacherApi.prepareEssayChecks(input),
    onSuccess: (_result, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: TEACHER_HOME_KEY }),
      queryClient.invalidateQueries({ queryKey: teacherWorkspaceKey(input.courseId) }),
    ]),
  })
}

export function useSaveTeacherFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { courseId: string; assignmentId: string; studentId: string; body: string; citationIds: string[]; sharingOptions?: import('./teacherFeedbackExport').FeedbackSharingByCitation }) =>
      teacherApi.saveFeedback(input),
    onSuccess: (essay, input) => {
      updateEssayCache(queryClient, essay, input.courseId)
      return queryClient.invalidateQueries({ queryKey: TEACHER_HISTORY_KEY })
    },
  })
}

export function useSendTeacherFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: teacherApi.sendFeedback,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEACHER_HISTORY_KEY }),
  })
}

export function useResetMockTeacherData() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: teacherApi.resetMockTeacherData,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teacher'] }),
  })
}

export function useTeacherReadingQuestions(paperId?: string) {
  return useQuery<TeacherReadingQuestionsPage>({
    queryKey: teacherReadingQuestionsKey(paperId),
    queryFn: () => teacherApi.getReadingQuestions(paperId),
  })
}

export function useRegenerateReadingQuestions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: teacherApi.regenerateReadingQuestions,
    onSuccess: (page) => {
      queryClient.setQueryData(teacherReadingQuestionsKey(page.paper.id), page)
      queryClient.setQueryData(teacherReadingQuestionsKey(), page)
    },
  })
}

export function useUpdateReadingQuestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: teacherApi.updateReadingQuestion,
    onSuccess: (question) => {
      queryClient.setQueryData<TeacherReadingQuestionsPage>(
        teacherReadingQuestionsKey(question.paperId),
        (page) => page && { ...page, questions: page.questions.map((item) => item.id === question.id ? question : item) },
      )
      queryClient.setQueryData<TeacherReadingQuestionsPage>(
        teacherReadingQuestionsKey(),
        (page) => page && { ...page, questions: page.questions.map((item) => item.id === question.id ? question : item) },
      )
    },
  })
}

export function useDeleteReadingQuestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: teacherApi.deleteReadingQuestion,
    onSuccess: (_result, questionId) => {
      queryClient.setQueryData<TeacherReadingQuestionsPage>(
        teacherReadingQuestionsKey(),
        (page) => page && { ...page, questions: page.questions.filter((question) => question.id !== questionId) },
      )
      void queryClient.invalidateQueries({ queryKey: READING_QUESTIONS_KEY })
    },
  })
}

// Compatibility hooks for the legacy classwork screen during the route migration.
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
        items?.map((item) => item.id === updated.id ? updated : item),
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
        items?.map((item) => queuedIds.has(item.id) ? { ...item, analysisStatus: 'queued' } : item),
      )
    },
  })
}
