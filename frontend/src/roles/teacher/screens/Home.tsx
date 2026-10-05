import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  FileCheck2,
  GraduationCap,
  ListChecks,
} from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { useAuth } from '../../../lib/useAuth'
import { useSettings } from '../../../lib/settings'
import { homeRouteForAction } from '../../../lib/teacherSelectors'
import type { TeacherHomeAssignment, TeacherHomeSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { useTeacherGoogleConnection, useTeacherHome } from '../../../lib/useTeacher'
import { InitialAvatar, LoadingState, StatusPill } from '../components/TeacherUi'

export function Home({ onOpen }: { onOpen: (route: TeacherRoute) => void }) {
  const home = useTeacherHome()
  const connection = useTeacherGoogleConnection()
  const { session } = useAuth()
  const settings = useSettings()

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
        <Button type="button" onClick={() => void home.refetch()}>Try again</Button>
      </Card>
    )
  }

  const data = home.data
  const submissions = data.submissions.filter((submission) => submission.state === 'submitted')
  const reviewCount = data.reviewQueueCount ?? submissions.length
  const assignments = data.dueSoon ?? []
  const metadata = session?.user.user_metadata ?? {}
  const authName = [metadata.full_name, metadata.name, metadata.display_name]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined
  const emailName = session?.user.email?.split('@')[0]?.replace(/[._-]+/g, ' ')
  const teacherName = authName?.trim() || (settings.displayName !== 'Alex' ? settings.displayName : '') || emailName || settings.displayName

  const openEssayCheck = (submission?: TeacherHomeSubmission) => {
    const target = submission ?? submissions[0]
    if (target?.courseId) {
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

  const openReviewQueue = () => {
    const submission = submissions[0]
    if (submission?.courseId) {
      onOpen({ screen: 'essay-check', courseId: submission.courseId, assignmentId: submission.assignmentId, studentId: submission.studentId })
    } else if (submission) {
      openEssayCheck(submission)
    } else {
      onOpen({ screen: 'classes' })
    }
  }

  return (
    <div className="space-y-[22px]">
      <header className="space-y-1">
        <h1 className="font-serif text-[22px] font-semibold leading-[30px] tracking-tight text-ink">Good morning, {teacherName}</h1>
        <p className="text-[12px] leading-[18px] text-ink-muted">
          {reviewCount} {reviewCount === 1 ? 'essay' : 'essays'} awaiting review · {assignments.length} {assignments.length === 1 ? 'assignment' : 'assignments'} due soon
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Quick actions">
        <QuickAction icon={FileCheck2} title="Check student essays" detail="Review submitted work and citation checks" onClick={() => openEssayCheck()} />
        <QuickAction icon={ListChecks} title="Review queue" detail={`${reviewCount} ${reviewCount === 1 ? 'submission' : 'submissions'} waiting for review`} onClick={openReviewQueue} />
        <QuickAction icon={CalendarClock} title="Due soon" detail={`${assignments.length} assignments · next 7 days and overdue`} onClick={() => assignments[0] ? onOpen({ screen: 'assignment-detail', courseId: assignments[0].courseId, assignmentId: assignments[0].id }) : onOpen({ screen: 'classes' })} />
        <QuickAction icon={BookOpen} title="Make reading questions" detail="Create questions from a research paper" onClick={() => onOpen(homeRouteForAction('reading-questions'))} />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <h2 className="text-[14px] font-semibold">Review queue</h2>
            <span className="text-[11px] text-accent">{reviewCount} waiting</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {submissions.length === 0
              ? <div className="p-5"><Empty title="Nothing to review" hint="New submitted essays will appear here." /></div>
              : submissions.map((submission) => (
                <ReviewRow
                  key={submission.id}
                  submission={submission}
                  onOpen={() => submission.courseId
                    ? onOpen({ screen: 'essay-check', courseId: submission.courseId, assignmentId: submission.assignmentId, studentId: submission.studentId })
                    : openEssayCheck(submission)}
                />
              ))}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <h2 className="text-[14px] font-semibold">Due soon</h2>
            <span className="text-[11px] text-accent">Next 7 days and overdue</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {assignments.length === 0
              ? <div className="p-5"><Empty title="No upcoming assignments" hint="Assignments due in the next 7 days or awaiting work after their due date will appear here." /></div>
              : assignments.map((assignment) => (
                <DueSoonRow
                  key={`${assignment.courseId}-${assignment.id}`}
                  assignment={assignment}
                  onOpen={() => onOpen({ screen: 'assignment-detail', courseId: assignment.courseId, assignmentId: assignment.id })}
                />
              ))}
          </div>
        </Card>
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

function QuickAction({ icon: Icon, title, detail, onClick }: { icon: typeof FileCheck2; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[107px] rounded-[12px] border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <Icon className="size-4 text-accent" />
      <span className="mt-2 block text-[14px] font-medium text-ink">{title}</span>
      <span className="mt-2 block text-[12px] leading-[18px] text-ink-muted">{detail}</span>
    </button>
  )
}

function ReviewRow({ submission, onOpen }: { submission: TeacherHomeSubmission; onOpen: () => void }) {
  const label = submission.reviewStatus === 'analysis-ready' ? 'Analysis on file' : 'Not checked'
  const tone = submission.reviewStatus === 'analysis-ready' ? 'success' : 'neutral'
  const details = [submission.courseName, submission.assignmentTitle, submission.reviewStatus === 'analysis-ready' ? 'Analysis on file' : 'Not checked']
    .filter(Boolean)
    .join(' · ')
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

function DueSoonRow({ assignment, onOpen }: { assignment: TeacherHomeAssignment; onOpen: () => void }) {
  const date = assignment.dueAt ? new Date(assignment.dueAt) : null
  const dueLabel = date && !Number.isNaN(date.valueOf())
    ? `${assignment.overdue ? 'Overdue · ' : 'Due '}${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)}`
    : 'Due date unavailable'
  const detail = `${assignment.courseName} · ${assignment.pendingReviewCount} to review · ${assignment.missingCount} missing`
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[62px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-accent">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${assignment.overdue ? 'bg-refutes-soft text-refutes' : 'bg-accent-soft text-accent'}`}>
        <CalendarClock className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{assignment.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{detail}</span>
      </span>
      <span className={`shrink-0 text-[11px] font-medium ${assignment.overdue ? 'text-refutes' : 'text-ink-muted'}`}>{dueLabel}</span>
      <ChevronRight className="size-3.5 shrink-0 text-ink-muted" />
    </button>
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
