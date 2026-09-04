/**
 * 05 Onboarding — the landing role picker. Selecting a role decides which home the app
 * opens. Only the researcher path is built so far; writer/teacher are placeholders their
 * owners will fill in.
 */

import { CheckCircle2, GraduationCap, Microscope, Pen } from 'lucide-react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import { Brand } from '../components/Brand'
import { cn } from '../lib/utils'

export type Role = 'researcher' | 'writer' | 'teacher'

type Icon = ComponentType<{ className?: string }>

const ROLES: { id: Role; title: string; desc: string; icon: Icon; bullets: string[] }[] = [
  {
    id: 'researcher',
    title: 'Researcher',
    desc: 'Map a field, check what papers claim about each other.',
    icon: Microscope,
    bullets: [
      'Literature map from your library',
      'Verify citations in any paper',
      'Related-work graph by meaning',
    ],
  },
  {
    id: 'writer',
    title: 'Writer',
    desc: 'Cite with confidence before you submit.',
    icon: Pen,
    bullets: [
      'Paste a draft, check every citation inline',
      'Find the source that actually says it',
      'Export a corrected reference list',
    ],
  },
  {
    id: 'teacher',
    title: 'Teacher',
    desc: 'Turn papers into lessons, check student work.',
    icon: GraduationCap,
    bullets: [
      'Verify sources in student essays',
      'Reading questions from any paper',
      'Class library, shared with students',
    ],
  },
]

export function Onboarding({
  onContinue,
  onSkip,
}: {
  onContinue: (role: Role) => void
  onSkip: () => void
}) {
  const [selected, setSelected] = useState<Role>('researcher')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <Brand hero />
        <h1 className="font-serif text-[28px] font-semibold tracking-tight text-ink">
          What do you mostly do?
        </h1>
        <p className="text-sm text-ink-muted">
          Picks your home screen and quick actions. Change it any time in settings.
        </p>
      </header>

      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start">
        {ROLES.map(({ id, title, desc, icon: Icon, bullets }) => {
          const active = selected === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelected(id)}
              onDoubleClick={() => onContinue(id)}
              aria-pressed={active}
              className={cn(
                'flex w-full flex-col items-start gap-3 rounded-xl p-6 text-left transition-colors sm:w-[300px]',
                active
                  ? 'border-2 border-accent bg-accent-soft'
                  : 'border border-border-subtle bg-surface hover:border-accent',
              )}
            >
              <span
                className={cn(
                  'flex rounded-[10px] p-2.5',
                  active ? 'bg-surface' : 'bg-canvas',
                )}
              >
                <Icon className="size-4 text-accent" />
              </span>
              <span className="font-serif text-lg font-semibold tracking-tight text-ink">{title}</span>
              <span className="text-sm text-ink-muted">{desc}</span>
              <span className="flex flex-col gap-1.5">
                {bullets.map((b) => (
                  <span key={b} className="flex items-start gap-2 text-[13px] text-ink">
                    <CheckCircle2 className="mt-px size-4 shrink-0 text-accent" />
                    {b}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onContinue(selected)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Continue as {selected}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
