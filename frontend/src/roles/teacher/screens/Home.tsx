import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCheck2,
  GraduationCap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import { useAuth } from '../../../lib/useAuth'
import { useSettings } from '../../../lib/settings'
import type { MostMisusedSource, TeacherHomeAssignment, TeacherHomeSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { homeRouteForAction } from '../../../lib/teacherSelectors'
import { useTeacherGoogleConnection, useTeacherHome } from '../../../lib/useTeacher'
import { InitialAvatar, LoadingState, StatusPill } from '../components/TeacherUi'

const REVIEWS_PER_PAGE = 15
const COLLAPSED_REVIEW_LIMIT = 3

type ReviewSubmission = {
  submission: TeacherHomeSubmission
  courseId: string
  courseName: string
  dueAt: string | null
}

type CourseReviewGroup = {
  id: string
  courseName: string
  submissions: ReviewSubmission[]
}

export function Home({ onOpen }: { onOpen: (route: TeacherRoute) => void }) {
  const home = useTeacherHome()
  const connection = useTeacherGoogleConnection()
  const { session } = useAuth()
  const settings = useSettings()
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(() => new Set())
  const [coursePages, setCoursePages] = useState<Record<string, number>>({})

  if (home.isPending) return <LoadingState label="Loading your teaching overview..." />

  if (home.isError || !home.data) {
    return (
      <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-refutes" />
          <div>
            <h1 className="text-[14px] font-semibold">Your overview could not load</h1>
            <p className="mt-1 text-[12px] leading-[18px] text-ink-muted">The teacher dashboard could not reach its data service.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void home.refetch()}>Try again</Button>
          <Button type="button" variant="ghost" onClick={() => onOpen({ screen: 'add-class-connect' })}>
            Reconnect with Google Classroom
          </Button>
        </div>
      </Card>
    )
  }

  const data = home.data
  const submissions = data.submissions.filter((submission) =>
    submission.state === 'submitted' && submission.reviewStatus !== 'analysis-ready',
  )
  const reviewCount = data.reviewQueueCount ?? submissions.length
  const assignments = data.dueSoon ?? []
  const reviewGroups = groupSubmissionsByCourse(submissions, assignments, data.courseId, data.course)
  const metadata = session?.user.user_metadata ?? {}
  const authName = [metadata.full_name, metadata.name, metadata.display_name]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined
  const emailName = session?.user.email?.split('@')[0]?.replace(/[._-]+/g, ' ')
  const teacherName = authName?.trim() || (settings.displayName !== 'Alex' ? settings.displayName : '') || emailName || settings.displayName

  const openEssayCheck = (submission?: TeacherHomeSubmission) => {
    const target = submission ?? submissions[0]
    if (target?.courseId && target.assignmentId) {
      onOpen({ screen: 'assignment-detail', courseId: target.courseId, assignmentId: target.assignmentId })
      return
    }
    const dueAssignment = assignments[0]
    if (dueAssignment) {
      onOpen({ screen: 'assignment-detail', courseId: dueAssignment.courseId, assignmentId: dueAssignment.id })
      return
    }
    if (data.courseId && data.assignmentId) {
      onOpen({ screen: 'assignment-detail', courseId: data.courseId, assignmentId: data.assignmentId })
      return
    }
    onOpen({ screen: 'classes' })
  }

  const toggleCourse = (courseId: string, expanded: boolean) => {
    setExpandedCourseIds((current) => {
      const next = new Set(current)
      if (expanded) next.add(courseId)
      else next.delete(courseId)
      return next
    })
    setCoursePages((current) => ({ ...current, [courseId]: 0 }))
  }

  return (
    <div className="space-y-[22px]">
      <header className="space-y-1">
        <h1 className="font-serif text-[30px] font-semibold leading-[40px] tracking-tight text-ink">Good morning, {teacherName}</h1>
        <p className="text-[13px] leading-5 text-ink-muted">
          {reviewCount} {reviewCount === 1 ? 'essay' : 'essays'} awaiting review · {assignments.length} {assignments.length === 1 ? 'assignment' : 'assignments'} due soon
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Quick actions">
        <QuickAction icon={FileCheck2} title="Check student essays" detail="Review submitted work and citation checks" onClick={() => openEssayCheck()} />
        <QuickAction icon={BookOpen} title="Make reading questions" detail="Create questions from a research paper" onClick={() => onOpen(homeRouteForAction('reading-questions'))} />
        <QuickAction
          icon={CalendarClock}
          title="Due soon"
          detail={`${assignments.length} assignments · next 7 days and overdue`}
          onClick={() => assignments[0]
            ? onOpen({ screen: 'assignment-detail', courseId: assignments[0].courseId, assignmentId: assignments[0].id })
            : onOpen({ screen: 'classes' })}
        />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(260px,1fr)]" aria-label="Essay to review">
        <div className="space-y-3">
          {reviewGroups.length === 0 ? (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border-subtle px-4 py-3">
                <h2 className="text-[14px] font-semibold">Essay to review</h2>
              </div>
              <div className="p-5"><Empty title="Nothing to review" hint="New submitted essays will appear here." /></div>
            </Card>
          ) : reviewGroups.map((group) => {
            const expanded = expandedCourseIds.has(group.id)
            const pageCount = Math.ceil(group.submissions.length / REVIEWS_PER_PAGE)
            const page = Math.min(coursePages[group.id] ?? 0, Math.max(0, pageCount - 1))
            const first = expanded ? page * REVIEWS_PER_PAGE : 0
            const visibleSubmissions = expanded
              ? group.submissions.slice(first, first + REVIEWS_PER_PAGE)
              : group.submissions.slice(0, COLLAPSED_REVIEW_LIMIT)
            const listId = `teacher-review-${encodeURIComponent(group.id)}`
            const pageWindowStart = Math.max(0, Math.min(page - 2, pageCount - 5))
            const pageNumbers = Array.from(
              { length: Math.min(pageCount, 5) },
              (_, index) => pageWindowStart + index,
            )

            return (
              <Card key={group.id} className="overflow-hidden p-0">
                <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                  <h2 className="min-w-0 truncate text-[14px] font-semibold">{group.courseName}</h2>
                  {group.submissions.length > COLLAPSED_REVIEW_LIMIT ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={listId}
                      onClick={() => toggleCourse(group.id, !expanded)}
                      className="inline-flex shrink-0 items-center gap-1 rounded text-[11px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {expanded ? 'Show less' : `See all ${group.submissions.length}`}
                      {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-accent">
                      {group.submissions.length} {group.submissions.length === 1 ? 'submission' : 'submissions'}
                    </span>
                  )}
                </div>
                <div id={listId} className="divide-y divide-border-subtle">
                  {visibleSubmissions.map(({ submission, dueAt, courseId }) => (
                    <ReviewRow
                      key={submission.id}
                      submission={submission}
                      dueAt={dueAt}
                      onOpen={() => submission.assignmentId
                        ? onOpen({
                          screen: 'essay-check',
                          courseId,
                          assignmentId: submission.assignmentId,
                          studentId: submission.studentId,
                        })
                        : openEssayCheck(submission)}
                    />
                  ))}
                </div>
                {expanded && pageCount > 1 && (
                  <nav aria-label={`${group.courseName} submission pages`} className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] text-ink-muted">
                      Showing {first + 1}–{Math.min(first + REVIEWS_PER_PAGE, group.submissions.length)} of {group.submissions.length} · {REVIEWS_PER_PAGE} per page
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Previous page"
                        disabled={page === 0}
                        onClick={() => setCoursePages((current) => ({ ...current, [group.id]: page - 1 }))}
                        className="flex size-8 items-center justify-center rounded-lg border border-border-subtle text-ink-muted hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      {pageNumbers.map((pageNumber) => (
                        <button
                          key={pageNumber}
                          type="button"
                          aria-label={`Page ${pageNumber + 1}`}
                          aria-current={page === pageNumber ? 'page' : undefined}
                          onClick={() => setCoursePages((current) => ({ ...current, [group.id]: pageNumber }))}
                          className={`flex size-8 items-center justify-center rounded-lg border text-[11px] font-medium ${page === pageNumber ? 'border-accent bg-accent-soft text-accent' : 'border-border-subtle text-ink-muted hover:bg-accent-soft'}`}
                        >
                          {pageNumber + 1}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label="Next page"
                        disabled={page >= pageCount - 1}
                        onClick={() => setCoursePages((current) => ({ ...current, [group.id]: page + 1 }))}
                        className="flex size-8 items-center justify-center rounded-lg border border-border-subtle text-ink-muted hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </nav>
                )}
              </Card>
            )
          })}
        </div>

        <MostMisusedSourceCard source={data.mostMisusedSource} />
      </section>

      <ClassroomSync
        connected={connection.data?.connected ?? false}
        email={connection.data?.email ?? null}
        lastSyncedAt={connection.data?.sync?.lastSyncedAt ?? null}
        syncError={connection.data?.sync?.error ?? null}
        loading={connection.isPending}
        failed={connection.isError}
        onRetry={() => void connection.refetch()}
        onOpenClasses={() => onOpen({ screen: 'classes' })}
      />
    </div>
  )
}

function groupSubmissionsByCourse(
  submissions: TeacherHomeSubmission[],
  assignments: TeacherHomeAssignment[],
  fallbackCourseId?: string,
  fallbackCourseName?: string,
): CourseReviewGroup[] {
  const assignmentsByKey = new Map<string, TeacherHomeAssignment>()
  for (const assignment of assignments) {
    assignmentsByKey.set(`${assignment.courseId}:${assignment.id}`, assignment)
  }
  const groups = new Map<string, CourseReviewGroup>()

  for (const submission of submissions) {
    const courseId = submission.courseId ?? fallbackCourseId ?? ''
    const assignment = assignmentsByKey.get(`${courseId}:${submission.assignmentId}`)
    const courseName = submission.courseName ?? assignment?.courseName ?? fallbackCourseName ?? 'Your class'
    const groupId = courseId || `course-name:${courseName}`
    const entry: ReviewSubmission = {
      submission,
      courseId,
      courseName,
      dueAt: submission.dueAt ?? assignment?.dueAt ?? null,
    }
    const group = groups.get(groupId) ?? { id: groupId, courseName, submissions: [] }
    group.submissions.push(entry)
    groups.set(groupId, group)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      submissions: group.submissions.sort(compareReviewSubmissions),
    }))
    .sort((left, right) => {
      const dueOrder = compareDates(left.submissions[0]?.dueAt, right.submissions[0]?.dueAt)
      if (dueOrder !== 0) return dueOrder
      const firstLeft = left.submissions[0]
      const firstRight = right.submissions[0]
      const submittedOrder = firstLeft && firstRight
        ? compareSubmittedDates(firstLeft.submission, firstLeft.dueAt, firstRight.submission, firstRight.dueAt)
        : 0
      return submittedOrder || left.courseName.localeCompare(right.courseName)
    })
}

function compareReviewSubmissions(left: ReviewSubmission, right: ReviewSubmission): number {
  return compareDates(left.dueAt, right.dueAt)
    || compareSubmittedDates(left.submission, left.dueAt, right.submission, right.dueAt)
    || left.submission.studentName.localeCompare(right.submission.studentName)
}

function compareSubmittedDates(
  left: TeacherHomeSubmission,
  leftDueAt: string | null,
  right: TeacherHomeSubmission,
  rightDueAt: string | null,
): number {
  const leftDate = parseHomeDate(left.submittedAt, parseHomeDate(leftDueAt)?.getFullYear())
  const rightDate = parseHomeDate(right.submittedAt, parseHomeDate(rightDueAt)?.getFullYear())
  return compareTimestamps(leftDate?.getTime(), rightDate?.getTime())
}

function compareDates(left?: string | null, right?: string | null): number {
  return compareTimestamps(parseHomeDate(left)?.getTime(), parseHomeDate(right)?.getTime())
}

function compareTimestamps(left?: number, right?: number): number {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return left - right
}

function parseHomeDate(value?: string | null, fallbackYear?: number): Date | null {
  if (!value?.trim()) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.valueOf())) return direct
  const withYear = new Date(`${value} ${fallbackYear ?? new Date().getFullYear()}`)
  return Number.isNaN(withYear.valueOf()) ? null : withYear
}

function formatHomeDate(value?: string | null, fallbackYear?: number): string | null {
  const date = parseHomeDate(value, fallbackYear)
  return date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date) : null
}

function QuickAction({ icon: Icon, title, detail, onClick }: {
  icon: LucideIcon
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="min-h-[126px] rounded-[14px] border border-border-subtle bg-surface p-5 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <Icon className="size-5 text-accent" />
      <span className="mt-3 block text-[15px] font-medium text-ink">{title}</span>
      <span className="mt-2 block text-[12px] leading-[18px] text-ink-muted">{detail}</span>
    </button>
  )
}

function ReviewRow({ submission, dueAt, onOpen }: {
  submission: TeacherHomeSubmission
  dueAt: string | null
  onOpen: () => void
}) {
  const label = submission.reviewStatus === 'analysis-ready' ? 'Analysis on file' : 'Not checked'
  const tone = submission.reviewStatus === 'analysis-ready' ? 'success' : 'neutral'
  const fallbackYear = parseHomeDate(dueAt)?.getFullYear()
  const dueDate = formatHomeDate(dueAt)
  const submittedDate = formatHomeDate(submission.submittedAt, fallbackYear)
  const dates = [
    dueDate ? `Due ${dueDate}` : null,
    submittedDate ? `Submitted ${submittedDate}` : null,
  ].filter(Boolean).join(' · ')
  const details = dates || submission.assignmentTitle || 'Submission details unavailable'

  return (
    <button type="button" onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-accent">
      <InitialAvatar initials={submission.initial} className="size-7 text-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{submission.studentName}</span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{details}</span>
      </span>
      <span className="hidden sm:block"><StatusPill label={label} tone={tone} /></span>
      <ChevronRight className="size-3.5 shrink-0 text-ink-muted" />
    </button>
  )
}

function MostMisusedSourceCard({ source }: { source?: MostMisusedSource | null }) {
  return (
    <Card className="space-y-2.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-refutes">Most misused source</h2>
      {source ? (
        <>
          <h3 className="text-[14px] font-semibold text-ink">{source.title}</h3>
          <p className="text-[12px] leading-[18px] text-ink-muted">{source.detail}</p>
        </>
      ) : (
        <p className="text-[12px] leading-[18px] text-ink-muted">A frequently misused source will appear here when review data is available.</p>
      )}
    </Card>
  )
}

function ClassroomSync({
  connected,
  email,
  lastSyncedAt,
  syncError,
  loading,
  failed,
  onRetry,
  onOpenClasses,
}: {
  connected: boolean
  email: string | null
  lastSyncedAt: string | null
  syncError: string | null
  loading: boolean
  failed: boolean
  onRetry: () => void
  onOpenClasses: () => void
}) {
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold">Google Classroom sync</h2>
            {connected && <StatusPill label="Connected" tone="success" />}
          </div>
          <p className="mt-1 text-[12px] leading-[18px] text-ink-muted">
            {loading ? 'Checking your Classroom connection…'
              : failed ? 'Connection status could not load.'
                : connected ? [email, lastSyncedAt ? `Last synced ${formatSyncTime(lastSyncedAt)}` : 'No sync recorded yet', syncError ? `Sync issue: ${syncError}` : ''].filter(Boolean).join(' · ')
                  : 'Connect an account to bring your Classroom courses into SecretSource.'}
          </p>
        </div>
      </div>
      {failed
        ? <Button type="button" variant="ghost" onClick={onRetry}>Retry status</Button>
        : <Button type="button" variant={connected ? 'ghost' : 'solid'} onClick={onOpenClasses}>
          {connected ? <>View classes <ArrowUpRight className="size-3.5" /></> : 'Connect Google Classroom'}
        </Button>}
    </Card>
  )
}

function formatSyncTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
