/**
 * The empty Ask panel (components/AssistantPanel): Quip floating over a soft glow, then one card
 * that says how Ask answers and offers a few questions to start from.
 */

import { m } from 'framer-motion'

import type { Role } from '../lib/roles'
import type { AskAbout } from './AssistantPanel'
import { Mascot } from './Mascot'

const SPRING = { type: 'spring', stiffness: 260, damping: 20 } as const

export function AskWelcome({
  role,
  about,
  canNarrow,
  onAsk,
}: {
  role: Role
  about: AskAbout
  /** Whether the role can open a paper or a graph node, so the card says how to narrow a question. */
  canNarrow: boolean
  onAsk: (question: string) => void
}) {
  return (
    <div className="m-auto flex w-full max-w-sm flex-col items-center gap-5 py-6">
      <m.div
        initial={{ y: -16, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={SPRING}
        className="relative flex items-center justify-center"
      >
        <span aria-hidden="true" className="absolute top-1/2 size-28 -translate-y-1/3 rounded-full bg-accent-soft blur-2xl" />
        <Mascot role={role} size={96} animated className="relative drop-shadow-lg" />
      </m.div>

      <m.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut', delay: 0.08 }}
        className="flex w-full flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 text-center shadow-md"
      >
        <h3 className="text-[15px] font-semibold text-ink">
          {about.kind === 'library' ? 'Ask about the papers in your library' : `Ask about ${about.label}`}
        </h3>
        <p className="text-[13px] leading-5 text-ink-muted">
          Answers come back as short statements. Each one cites a passage and is checked by the judge before it
          counts.{about.kind === 'library' && canNarrow && ' Open a paper or select a graph node first to ask about that one only.'}
        </p>
        <div className="mt-1 flex flex-col gap-2">
          {starters(about).map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onAsk(question)}
              className="min-h-10 rounded-xl border border-border-subtle px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
            >
              {question}
            </button>
          ))}
        </div>
      </m.div>
    </div>
  )
}

/** Questions Ask answers from passages: about content, not about the verdicts on a paper's claims. */
function starters(about: AskAbout): string[] {
  if (about.kind === 'paper') {
    return ['What problem does this paper solve?', 'What are its main results?', 'What limits does it admit?']
  }
  if (about.kind === 'node') {
    return [`What do my papers say about ${about.label}?`, `Where do my papers disagree about ${about.label}?`]
  }
  return ['What methods do my papers use?', 'Where do my papers disagree?', 'What do my papers say about evaluation?']
}
