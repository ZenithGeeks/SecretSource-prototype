import { ArrowUpRight, BookOpen, ChevronRight, FileCheck2, FileText, LibraryBig, Sparkles } from 'lucide-react'

import { Button, Card, Empty } from '../../../components/ui'
import { homeRouteForAction } from '../../../lib/teacherSelectors'
import type { TeacherHomeSubmission } from '../../../lib/teacher'
import type { TeacherRoute } from '../../../lib/teacherRoutes'
import { useTeacherHome } from '../../../lib/useTeacher'
import { InitialAvatar, LoadingState, PageHeading, StatusPill } from '../components/TeacherUi'

export function Home({ onOpen }: { onOpen: (route: TeacherRoute) => void }) {
  const home = useTeacherHome()
  if (home.isPending) return <LoadingState label="Loading your teaching overview..." />
  if (home.isError || !home.data) return <Empty title="Your overview could not load" hint="Refresh the page to reload the local teacher data." />

  const data = home.data
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Teacher home"
        title={`Good morning, ${data.user}`}
        description={`${data.course} · ${data.checkedEssays} of ${data.totalEssays} essays checked · ${data.citationsNeedingAttention} cite sources that do not say that.`}
      />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Quick actions">
        <QuickAction icon={FileCheck2} title="Check student essays" detail="Review citations and prepare feedback." onClick={() => onOpen(homeRouteForAction('check-essays', data))} />
        <QuickAction icon={Sparkles} title="Make reading questions" detail="Turn a paper into a class worksheet." onClick={() => onOpen(homeRouteForAction('reading-questions', data))} />
        <QuickAction icon={LibraryBig} title="Class library" detail="See the sources your classes are using." />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="p-0">
          <div className="flex items-start justify-between gap-4 border-b border-border-subtle p-5 sm:p-6"><div><h2 className="font-serif text-2xl font-semibold">Essays to review</h2><p className="mt-1 text-sm text-ink-muted">{data.assignment} · a local review queue</p></div><StatusPill label={`${data.citationsNeedingAttention} need attention`} tone="warning" /></div>
          <div className="divide-y divide-border-subtle">
            {data.submissions.length === 0 ? <div className="p-6"><Empty title="Nothing to review" hint="Submitted essays will appear here." /></div> : data.submissions.map((submission) => <ReviewRow key={submission.id} submission={submission} onOpen={() => onOpen(submission.state === 'submitted' ? { screen: 'essay-check', courseId: submissionCourse(submission, data), assignmentId: data.assignmentId, studentId: submission.studentId } : { screen: 'assignment-detail', courseId: submissionCourse(submission, data), assignmentId: data.assignmentId })} />)}
          </div>
          <div className="border-t border-border-subtle p-5 sm:p-6"><Button type="button" variant="ghost" onClick={() => onOpen({ screen: 'assignment-detail', courseId: data.courseId, assignmentId: data.assignmentId })}>Open assignment <ChevronRight className="size-4" /></Button></div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-2xl font-semibold">Class library</h2><p className="mt-1 text-sm text-ink-muted">{data.library.visibility}</p></div><BookOpen className="size-5 text-accent" /></div>
          <p className="mt-5 text-3xl font-semibold text-ink">{data.library.paperCount}<span className="ml-2 text-sm font-normal text-ink-muted">papers available</span></p>
          <div className="mt-5 space-y-3">
            {data.library.papers.map((paper) => <div key={paper.id} className="flex w-full items-center gap-3 rounded-lg p-2"><span className="flex size-8 items-center justify-center rounded-md bg-canvas text-accent"><FileText className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{paper.title}</span><span className="mt-0.5 block text-xs text-ink-muted">{paper.citation} · {paper.note}</span></span></div>)}
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-muted">The library card is informational in this frontend; no separate class-note page is created.</p>
        </Card>
      </div>

      {data.mostMisusedSource && <Card className="border-insufficient bg-insufficient-soft/35"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-insufficient">Most misused source</p><h2 className="mt-2 font-serif text-2xl font-semibold">{data.mostMisusedSource.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{data.mostMisusedSource.detail}</p></div><span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-accent">Turn into a class note <ArrowUpRight className="size-4" /></span></div></Card>}
    </div>
  )
}

function QuickAction({ icon: Icon, title, detail, onClick }: { icon: typeof FileCheck2; title: string; detail: string; onClick?: () => void }) {
  const content = <><span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="size-5" /></span><span className="mt-5 block font-serif text-xl font-semibold">{title}</span><span className="mt-1 block text-sm leading-6 text-ink-muted">{detail}</span><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">{onClick ? <>Open <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></> : 'Shared reference'}</span></>
  return onClick ? <button type="button" onClick={onClick} className="group rounded-xl border border-border-subtle bg-surface p-5 text-left transition-shadow hover:border-accent hover:shadow-md">{content}</button> : <div className="rounded-xl border border-border-subtle bg-surface p-5">{content}</div>
}

function ReviewRow({ submission, onOpen }: { submission: TeacherHomeSubmission; onOpen: () => void }) {
  const tone = submission.standing === 'supports' ? 'success' : submission.standing === 'refutes' ? 'danger' : submission.standing === 'insufficient' ? 'warning' : 'neutral'
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 p-5 text-left hover:bg-canvas sm:p-6"><InitialAvatar initials={submission.initial} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{submission.studentName}</span><span className="mt-1 block truncate text-xs text-ink-muted">{submission.fileName} · {submission.summary}</span></span><span className="hidden sm:block"><StatusPill label={submission.standing === 'refutes' ? 'Needs review' : submission.standing === 'supports' ? 'Backed' : submission.standing === 'insufficient' ? 'Silent' : 'Not checked'} tone={tone} /></span><ChevronRight className="size-4 shrink-0 text-ink-muted" /></button>
}

function submissionCourse(_submission: TeacherHomeSubmission, home: { courseId: string }): string {
  return home.courseId
}
