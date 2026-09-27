import { ArrowUpRight, ChevronRight, FileCheck2, FileText, GraduationCap, Sparkles } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { homeRouteForAction } from '../../../lib/teacherSelectors'
import type { TeacherHomeSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { useTeacherGoogleConnection, useTeacherHome } from '../../../lib/useTeacher'
import { InitialAvatar, LoadingState, StatusPill } from '../components/TeacherUi'

export function Home({ onOpen }: { onOpen: (route: TeacherRoute) => void }) {
  const home = useTeacherHome()
  const connection = useTeacherGoogleConnection()
  if (home.isPending) return <LoadingState label="Loading your teaching overview..." />
  if (home.isError || !home.data) return <Empty title="Your overview could not load" hint="Refresh the page to reload the local teacher data." />

  const data = home.data
  return (
    <div className="space-y-[22px]">
      <header className="space-y-1">
        <h1 className="font-serif text-[20px] font-semibold leading-6 text-ink">Good morning, {data.user}</h1>
        <p className="text-[12px] leading-[18px] text-ink-muted">{data.course} | {data.checkedEssays} of {data.totalEssays} essays checked | {data.citationsNeedingAttention} cite sources that do not say that.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Quick actions">
        <QuickAction icon={FileCheck2} title="Check student essays" detail="Upload a batch, get a verdict per citation" onClick={() => onOpen(homeRouteForAction('check-essays', data))} />
        <QuickAction icon={Sparkles} title="Make reading questions" detail="From any paper in the class library" onClick={() => onOpen(homeRouteForAction('reading-questions', data))} />
        <QuickAction icon={GraduationCap} title="Class library" detail="Papers you assigned, and what students open" />
      </section>

      {connection.data && !connection.data.connected && (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <GraduationCap className="mt-0.5 size-5 shrink-0 text-accent" />
            <div>
              <h2 className="text-[14px] font-semibold">Connect Google Classroom</h2>
              <p className="mt-1 text-[12px] leading-[18px] text-ink-muted">Connect your account to bring your Classroom courses into SecretSource.</p>
            </div>
          </div>
          <Button type="button" onClick={() => onOpen({ screen: 'classes' })}>Connect Google Classroom</Button>
        </Card>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <h2 className="text-[14px] font-semibold">Essays to review</h2>
            <span className="text-[11px] text-accent">{data.course} | {data.assignment}</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {data.submissions.length === 0
              ? <div className="p-5"><Empty title="Nothing to review" hint="Submitted essays will appear here." /></div>
              : data.submissions.map((submission) => (
                <ReviewRow
                  key={submission.id}
                  submission={submission}
                  onOpen={() => onOpen(submission.state === 'submitted'
                    ? { screen: 'essay-check', courseId: data.courseId, assignmentId: data.assignmentId, studentId: submission.studentId }
                    : { screen: 'assignment-detail', courseId: data.courseId, assignmentId: data.assignmentId })}
                />
              ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold">Class library</h2>
              <span className="text-[11px] text-accent">{data.library.paperCount} papers | {data.library.visibility}</span>
            </div>
            <div className="mt-2 divide-y divide-border-subtle">
              {data.library.papers.map((paper) => (
                <div key={paper.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <FileText className="size-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{paper.title}</span>
                    <span className="block text-[11px] text-ink-muted">{paper.citation} | {paper.note}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          {data.mostMisusedSource && (
            <Card className="space-y-2 p-4">
              <h2 className="text-[14px] font-semibold">Most misused source this week</h2>
              <p className="text-[12px] leading-[18px] text-ink-muted">{data.mostMisusedSource.detail}</p>
              <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted"><ArrowUpRight className="size-3.5" />Turn into a class note</span>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickAction({ icon: Icon, title, detail, onClick }: { icon: typeof FileCheck2; title: string; detail: string; onClick?: () => void }) {
  const content = <><Icon className="size-4 text-accent" /><span className="mt-2 block text-[14px] font-medium text-ink">{title}</span><span className="mt-2 block text-[12px] leading-[18px] text-ink-muted">{detail}</span></>
  return onClick
    ? <button type="button" onClick={onClick} className="min-h-[107px] rounded-[12px] border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent">{content}</button>
    : <div className="min-h-[107px] rounded-[12px] border border-border-subtle bg-surface p-4">{content}</div>
}

function ReviewRow({ submission, onOpen }: { submission: TeacherHomeSubmission; onOpen: () => void }) {
  const tone = submission.standing === 'supports' ? 'success' : submission.standing === 'refutes' ? 'danger' : submission.standing === 'insufficient' ? 'warning' : 'neutral'
  const label = submission.standing === 'refutes' ? 'Source contradicts' : submission.standing === 'supports' ? 'Source backs it' : submission.standing === 'insufficient' ? 'Source is silent' : 'Not checked'
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-canvas">
      <InitialAvatar initials={submission.initial} className="size-7 text-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">{submission.studentName}</span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{submission.summary}</span>
      </span>
      <span className="hidden sm:block"><StatusPill label={label} tone={tone} /></span>
      <ChevronRight className="size-3.5 shrink-0 text-ink-muted" />
    </button>
  )
}
