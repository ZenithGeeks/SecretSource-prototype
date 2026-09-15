/** TanStack Query hooks that keep teacher screens independent of the mock data source. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  READING_QUESTIONS_KEY,
  TEACHER_CLASSES_KEY,
  TEACHER_HOME_KEY,
  teacherApi,
  teacherAssignmentKey,
  teacherClassImportKey,
  teacherCourseWorkKey,
  teacherEssayCheckKey,
  teacherReadingQuestionsKey,
  teacherWorkspaceKey,
  type EssayCheck,
  type TeacherAssignmentDetail,
  type TeacherCourseWork,
  type TeacherReadingQuestionsPage,
  type TeacherWorkspace,
  type UpdateProfessorReviewRequest,
} from './teacher'

export function useTeacherHome() {
  return useQuery({ queryKey: TEACHER_HOME_KEY, queryFn: teacherApi.getHome })
}

export function useTeacherClasses() {
  return useQuery({ queryKey: TEACHER_CLASSES_KEY, queryFn: teacherApi.getClasses })
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

export function useTeacherEssayCheck(assignmentId: string, studentId: string) {
  return useQuery<EssayCheck | null>({
    queryKey: teacherEssayCheckKey(assignmentId, studentId),
    queryFn: () => teacherApi.getEssayCheck(assignmentId, studentId),
    enabled: Boolean(assignmentId && studentId),
  })
}

function updateEssayCache(queryClient: ReturnType<typeof useQueryClient>, essay: EssayCheck) {
  queryClient.setQueryData(teacherEssayCheckKey(essay.assignment.assignmentId, essay.student.id), essay)
}

export function useUpdateProfessorReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProfessorReviewRequest) => teacherApi.updateProfessorReview(input),
    onSuccess: (essay) => updateEssayCache(queryClient, essay),
  })
}

export function useSaveTeacherFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { assignmentId: string; studentId: string; body: string; citationIds: string[] }) =>
      teacherApi.saveFeedback(input),
    onSuccess: (essay) => updateEssayCache(queryClient, essay),
  })
}

export function useSendTeacherFeedback() {
  return useMutation({ mutationFn: teacherApi.sendFeedback })
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
