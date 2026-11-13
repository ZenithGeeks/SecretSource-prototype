/**
 * 05 Onboarding: the role picker. It shows on a first visit and from the role "change" link; after
 * that Root opens the last role directly (lib/lastRole.ts). The left list picks a role, the
 * right panel plays a short loop of how SecretSource works for that role.
 */

import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { ArrowRight, FileText } from 'lucide-react'
import type { KeyboardEvent, Ref } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Brand } from '../components/Brand'
import { Mascot } from '../components/Mascot'
import { Badge, Button, VerdictBadge } from '../components/ui'
import { ROLE_INFO } from '../lib/roles'
import type { Role } from '../lib/roles'
import { cn } from '../lib/utils'

type RoleStory = {
  id: Role
  desc: string
  /** The three steps the demo panel walks through, in order. */
  steps: [string, string, string]
  /** The claim sentence highlighted in the demo paper. */
  claim: string
  verdict: 'supports' | 'refutes' | 'insufficient'
}

const ROLE_STORIES: RoleStory[] = [
  {
    id: 'researcher',
    desc: 'Map a field, check what papers claim about each other.',
    steps: [
      'Add a paper by PDF or DOI',
      'Each claim is matched to the paper it cites',
      'Every claim gets a verdict and the quote behind it',
    ],
    claim: 'Retrieval cuts hallucination by 40% [12]',
    verdict: 'supports',
  },
  {
    id: 'writer',
    desc: 'Cite with confidence before you submit.',
    steps: [
      'Paste your draft',
      'Every citation is checked against its source',
      'Fix what is flagged, export the reference list',
    ],
    claim: 'Prior work shows no effect of scale [4]',
    verdict: 'refutes',
  },
  {
    id: 'teacher',
    desc: 'Turn papers into lessons, check student work.',
    steps: [
      'Add a student essay or a reading',
      'The sources it cites are checked',
      'See which claims hold up, get reading questions',
    ],
    claim: 'Screen time harms sleep in all teens [2]',
    verdict: 'insufficient',
  },
  {
    id: 'labeler',
    desc: 'Build the labeled dataset the optimizer and evaluation use.',
    steps: [
      'Open a claim and its reference side by side',
      'The AI suggests a label',
      'You decide; the label saves to the team database',
    ],
    claim: 'The model was trained on 1.2M pairs [7]',
    verdict: 'supports',
  },
]

/** The demo loop: beats 0-2 light steps 1-3, the last beat holds the finished state. */
const BEAT_MS = 1600
const FINISHED_BEAT = 3
const EASE_OUT = [0.16, 1, 0.3, 1] as const

export function Onboarding({
  lastRole,
  onContinue,
}: {
  lastRole?: Role | null
  onContinue: (role: Role) => void
}) {
  const remembered = ROLE_STORIES.find((r) => r.id === lastRole)
  const [selected, setSelected] = useState<Role>(remembered?.id ?? 'researcher')
  const story = ROLE_STORIES.find((r) => r.id === selected) ?? ROLE_STORIES[0]
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Arrow keys move through the list like a native radio group.
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (!move) return
    event.preventDefault()
    const index = (ROLE_STORIES.findIndex((r) => r.id === selected) + move + ROLE_STORIES.length) % ROLE_STORIES.length
    setSelected(ROLE_STORIES[index].id)
    optionRefs.current[index]?.focus()
  }

  return (
    <div className="onboarding-app flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12 sm:px-6">
      <div className="w-full max-w-5xl">
        <header className="flex flex-col items-center text-center">
          <Brand hero />
          <h1 className="type-display mt-8 text-balance text-ink">What do you mostly do?</h1>
          <p className="mt-3 text-sm text-ink-muted">
            We open this role next time you visit. Switch any time in settings.
          </p>
        </header>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div role="radiogroup" aria-label="Role" onKeyDown={onListKeyDown} className="flex flex-col gap-2">
            {ROLE_STORIES.map(({ id, desc }, index) => (
              <RoleOption
                key={id}
                ref={(el) => {
                  optionRefs.current[index] = el
                }}
                role={id}
                desc={desc}
                isSelected={selected === id}
                isLastUsed={remembered?.id === id}
                onSelect={() => setSelected(id)}
                onChoose={() => onContinue(id)}
              />
            ))}
          </div>

          {/* Quip perches on the panel's top edge and swaps with the role. Inline styles keep
              these one-off offsets out of the CSS bundle, which is at its size budget. */}
          <div style={{ position: 'relative' }}>
            <AnimatePresence initial={false}>
              <m.div
                key={story.id}
                style={{ position: 'absolute', top: -62, right: 20, zIndex: 1 }}
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
              >
                <Mascot role={story.id} size={96} animated />
              </m.div>
            </AnimatePresence>
            <HowItWorks key={story.id} story={story} />
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <Button type="button" onClick={() => onContinue(selected)} className="group px-5 py-2.5">
            Continue as {ROLE_INFO[selected].label}
            <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/** One row of the role list: a radio that picks the role, and a double click that opens it. */
function RoleOption({
  ref,
  role,
  desc,
  isSelected,
  isLastUsed,
  onSelect,
  onChoose,
}: {
  ref: Ref<HTMLButtonElement>
  role: Role
  desc: string
  isSelected: boolean
  isLastUsed: boolean
  onSelect: () => void
  onChoose: () => void
}) {
  const { label, icon: Icon } = ROLE_INFO[role]
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={onChoose}
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        isSelected ? 'border-accent bg-surface' : 'border-transparent hover:border-border-subtle hover:bg-surface',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
          isSelected ? 'bg-accent text-canvas' : 'bg-accent-soft text-accent',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-serif text-lg font-semibold tracking-tight text-ink">{label}</span>
          {isLastUsed && <Badge tone="accent">Last used</Badge>}
        </span>
        <span className="text-[13px] leading-snug text-ink-muted">{desc}</span>
      </span>
    </button>
  )
}

/** A looping sketch of one check: a claim lights up, links to its source, gets a verdict. */
function HowItWorks({ story }: { story: RoleStory }) {
  const reduceMotion = useReducedMotion()
  // With reduced motion, show the finished state and do not loop. The parent keys this panel
  // by role, so picking another role restarts the loop from step 1.
  const [beat, setBeat] = useState(reduceMotion ? FINISHED_BEAT : 0)

  useEffect(() => {
    if (reduceMotion) return
    const timer = window.setInterval(() => setBeat((b) => (b + 1) % (FINISHED_BEAT + 1)), BEAT_MS)
    return () => window.clearInterval(timer)
  }, [reduceMotion])

  const isFinished = beat === FINISHED_BEAT
  const linked = beat >= 1
  const judged = beat >= 2

  return (
    <section
      aria-label={`How it works for a ${ROLE_INFO[story.id].label}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface"
    >
      <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-canvas p-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <FileText className="size-3.5" /> Your paper
          </span>
          <Line width="90%" />
          <m.span
            className="rounded bg-accent-soft px-1 py-0.5 text-[11px] leading-snug text-ink"
            initial={false}
            animate={{ boxShadow: linked ? 'inset 0 0 0 1px var(--color-accent)' : 'inset 0 0 0 1px rgba(0,0,0,0)' }}
            transition={{ duration: 0.3 }}
          >
            {story.claim}
          </m.span>
          <Line width="75%" />
          <Line width="60%" />
        </div>

        <svg viewBox="0 0 40 12" className="w-10 overflow-visible" aria-hidden="true">
          <m.path
            d="M2 6H36M31 1.5L36 6L31 10.5"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-accent"
            initial={false}
            animate={{ pathLength: linked ? 1 : 0, opacity: linked ? 1 : 0.2 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
          />
        </svg>

        <m.div
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-canvas p-3"
          initial={false}
          animate={{ opacity: linked ? 1 : 0.45, y: linked ? 0 : 4 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        >
          <span className="text-[11px] font-medium text-ink-muted">Cited source</span>
          <Line width="80%" />
          <Line width="95%" />
          <div className="h-6">
            <AnimatePresence>
              {judged && (
                <m.span
                  key={story.id}
                  className="inline-flex"
                  initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.35, ease: EASE_OUT }}
                >
                  <VerdictBadge verdict={story.verdict} />
                </m.span>
              )}
            </AnimatePresence>
          </div>
        </m.div>
      </div>

      <ol className="flex flex-col gap-1 border-t border-border-subtle px-5 py-4 sm:px-6">
        {story.steps.map((text, index) => {
          const lit = index <= beat || isFinished
          return (
            <li key={`${story.id}-${index}`} className="flex items-center gap-3 py-1">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200',
                  lit ? 'bg-accent text-canvas' : 'bg-accent-soft text-accent',
                )}
              >
                {index + 1}
              </span>
              <span className={cn('text-sm transition-colors duration-200', lit ? 'text-ink' : 'text-ink-muted')}>
                {text}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Line({ width }: { width: string }) {
  return <span className="block h-1.5 rounded-full bg-border-subtle" style={{ width }} />
}
