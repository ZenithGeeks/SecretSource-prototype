/**
 * 12 Home (Teacher) — teaching overview with essay review, class-library activity, and the
 * most-misused-source insight. Data comes through useTeacherHome so the screen remains ready
 * for the future teacher gateway endpoint.
 */

import { FileText, GraduationCap, ListChecks, Loader2, Pen, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'

import { Button, Card, Empty, StandingBadge } from '../../../components/ui'
import type { TeacherScreen } from '../TeacherApp'
import { useTeacherHome } from '../../../lib/useTeacher'

type Icon = ComponentType<{ className?: string }>

const QUICK_ACTIONS: { title: string; hint: string; icon: Icon; to: TeacherScreen }[] = [
  {
    title: 'Check student essays',
    hint: 'Upload a batch, get a verdict per citation',
    icon: ListChecks,
    to: 'essay-check',
  },
  {
    title: 'Make reading questions',
    hint: 'From any paper in the class library',
    icon: Sparkles,
    to: 'reading-questions',
  },
  {
    title: 'Class library',
    hint: 'Papers you assigned, and what students open',
    icon: GraduationCap,
    to: 'class-library',
  },
]

export function Home({ onOpen }: { onOpen: (screen: TeacherScreen) => void }) {
  const home = useTeacherHome()

  if (home.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading your teaching workspace…
      </p>
    )
  }

  if (home.isError) {
    return (
      <Card className="border-refutes text-refutes">
        Could not load your teaching workspace: {(home.error as Error).message}
      </Card>
    )
  }

  if (!home.data) return null

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">
          Good morning, {home.data.user}
        </h1>
        <p className="text-sm text-ink-muted">
          {home.data.course} · {home.data.checkedEssays} of {home.data.totalEssays} essays checked ·{' '}
          {home.data.citationsNeedingAttention} cite sources that do not say that.
        </p>
      </header>

      {/* The three actions are destinations only; their future workflows are not part of Home. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {QUICK_ACTIONS.map(({ title, hint, icon: Icon, to }) => (
          <Button
            key={title}
            type="button"
            variant="ghost"
            onClick={() => onOpen(to)}
            className="flex flex-1 flex-col items-start justify-start gap-2.5 rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-surface"
          >
            <Icon className="size-4 text-accent" />
            <p className="text-sm font-medium text-ink">{title}</p>
            <p className="text-xs text-ink-muted">{hint}</p>
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <Card className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Essays to review</h2>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpen('essay-check')}
              className="shrink-0 rounded-md p-0 text-xs text-accent hover:bg-transparent hover:text-accent"
            >
              {home.data.course} · {home.data.assignment}
            </Button>
          </div>

          {home.data.submissions.length === 0 ? (
            <div className="mt-2">
              <Empty title="No essays to review" hint="Submitted student essays will appear here." />
            </div>
          ) : (
            <ul>
              {home.data.submissions.map((submission) => (
                <li
                  key={submission.id}
                  className="flex items-center gap-2.5 border-t border-border-subtle py-3.5 first:mt-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent">
                    {submission.initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{submission.student}</p>
                    <p className="text-xs text-ink-muted">{submission.summary}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap">
                    <StandingBadge standing={submission.standing} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">Class library</h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpen('class-library')}
                className="shrink-0 rounded-md p-0 text-xs text-accent hover:bg-transparent hover:text-accent"
              >
                {home.data.library.paperCount} papers · {home.data.library.visibility}
              </Button>
            </div>

            {home.data.library.papers.length === 0 ? (
              <div className="mt-3">
                <Empty title="No papers yet" hint="Assigned papers will appear in the class library." />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {home.data.library.papers.map((paper) => (
                  <li key={paper.id} className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        {paper.title} <span className="text-ink-muted">({paper.citation})</span>
                      </p>
                      <p className="text-xs text-ink-muted">{paper.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink">Most misused source this week</h2>
            {home.data.mostMisusedSource ? (
              <>
                <p className="mt-3 text-sm leading-5 text-ink-muted">
                  <span className="text-ink">{home.data.mostMisusedSource.title}</span> —{' '}
                  {home.data.mostMisusedSource.detail}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpen('class-note')}
                  className="mt-3 rounded-md p-0 text-sm text-ink-muted hover:bg-transparent hover:text-ink"
                >
                  <Pen className="size-4" />
                  Turn into a class note
                </Button>
              </>
            ) : (
              <div className="mt-3">
                <Empty title="No source insight yet" hint="Source activity will be summarized here." />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
