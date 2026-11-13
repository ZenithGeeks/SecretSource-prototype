/**
 * The way into Ask, in every role's toolbar: a pill that says what it asks about, and, until the
 * person has opened Ask once or dismissed it, a short note beside it saying what Ask does.
 *
 * The note sits in the toolbar's flow, left of the pill, not over the page (#724): it takes its
 * own room in the bar, so it can never cover a screen's actions (New draft, Re-check, Import
 * .bib) or catch a click meant for them. Got it, ×, Esc, Try it and the pill itself dismiss it
 * for good (`ask.introSeen`).
 */

import { AnimatePresence, m, MotionConfig } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Role } from '../lib/roles'
import { cn } from '../lib/utils'
import type { AskAbout } from './AssistantPanel'
import { Mascot } from './Mascot'

const INTRO_KEY = 'ask.introSeen'
const INTRO_TEXT = 'Ask in your own words. The answer comes from your papers, and every sentence in it is checked against the passage it cites.'

const SCOPE: Record<AskAbout['kind'], string> = {
  paper: 'about this paper',
  node: 'about this topic',
  library: 'about your library',
}

export function AskButton({
  role,
  open,
  about,
  scope,
  onToggle,
}: {
  role: Role
  open: boolean
  about: AskAbout
  /** Replaces the words after "Ask AI" that `about` would give, for a screen that is about something else; empty for none. */
  scope?: string
  onToggle: () => void
}) {
  const [introSeen, setIntroSeen] = useState(readIntroSeen)
  const dismiss = () => {
    setIntroSeen(true)
    try {
      window.localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Private browsing can refuse storage; the bubble then comes back on the next visit.
    }
  }

  const showIntro = !introSeen && !open

  // Esc dismisses it from anywhere on the page, as a popover would; nothing else is listened to.
  useEffect(() => {
    if (!showIntro) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [showIntro])

  return (
    <div className="flex items-center gap-2">
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {showIntro && (
            <m.div
              key="ask-intro"
              role="note"
              aria-label="About Ask AI"
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: 0.4 }}
              title={INTRO_TEXT}
              // Small enough to share a toolbar with the screen's actions: the gist shows, the whole
              // sentence is the tooltip and what a screen reader reads. Below 1400px it is just
              // "New · Try it · ×": at 1280 the Editor's top bar has no room for more without wrapping.
              // Below 480px it is "New · ×", pointing at the pill, which does what Try it does: the
              // Editor's top bar would otherwise push the pill off a phone's screen.
              className="relative flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-surface py-0.5 pr-0.5 pl-3 text-left text-xs whitespace-nowrap shadow-sm"
            >
              {/* The point towards the pill on its right. */}
              <span aria-hidden="true" className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rotate-45 border-t border-r border-border-subtle bg-surface" />
              <p className="relative text-ink">
                <span className="font-medium">New</span>
                <span className="hidden min-[1400px]:inline" aria-hidden="true">
                  : ask about your papers
                </span>
                <span className="sr-only">. {INTRO_TEXT}</span>
              </p>
              <span className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => {
                    dismiss()
                    onToggle()
                  }}
                  className="hidden min-h-7 rounded-full px-2 font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent min-[480px]:inline"
                >
                  Try it
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="hidden min-h-7 rounded-full px-2 font-medium text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent min-[1400px]:inline"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Close"
                  className="flex size-7 items-center justify-center rounded-full text-ink-muted hover:bg-accent-soft hover:text-ink"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </m.div>
          )}
        </AnimatePresence>
      </MotionConfig>
      <button
        type="button"
        onClick={() => {
          dismiss()
          onToggle()
        }}
        aria-pressed={open}
        aria-label="Ask AI"
        title="Ask a question: the answer comes from your papers, and each sentence is checked against the passage it cites."
        className={cn(
          'inline-flex shrink-0 min-h-11 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-9',
          open
            ? 'border-accent bg-accent text-canvas'
            : 'border-accent bg-accent-soft text-ink hover:bg-surface',
        )}
      >
        {/* Quip is plum, so on the open (plum) button it sits on a canvas disc to stay visible. */}
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full transition-colors lg:size-6',
            open && 'bg-canvas',
          )}
        >
          <Mascot role={role} size={26} />
        </span>
        {/* On a phone only the icon shows: the toolbar also holds the breadcrumb and the screen's actions. */}
        <span className="sr-only sm:not-sr-only">Ask AI</span>
        {scope !== '' && (
          <span className={cn('hidden font-normal xl:inline', open ? 'text-canvas' : 'text-ink-muted')}>{scope ?? SCOPE[about.kind]}</span>
        )}
      </button>
    </div>
  )
}

function readIntroSeen() {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return true // storage refused: do not nag on every render
  }
}
