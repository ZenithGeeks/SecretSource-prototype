/**
 * The way into Ask, in every role's toolbar: a pill that says what it asks about, and, until the
 * person has opened Ask once or dismissed it, a short bubble under it saying what Ask does.
 */

import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'

import { cn } from '../lib/utils'
import type { AskAbout } from './AssistantPanel'

const INTRO_KEY = 'ask.introSeen'

const SCOPE: Record<AskAbout['kind'], string> = {
  paper: 'about this paper',
  node: 'about this topic',
  library: 'about your library',
}

export function AskButton({ open, about, onToggle }: { open: boolean; about: AskAbout; onToggle: () => void }) {
  const [introSeen, setIntroSeen] = useState(readIntroSeen)
  const dismiss = () => {
    setIntroSeen(true)
    try {
      window.localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // Private browsing can refuse storage; the bubble then comes back on the next visit.
    }
  }

  return (
    <div className="relative">
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
          'inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-9',
          open
            ? 'border-accent bg-accent text-canvas'
            : 'border-accent bg-accent-soft text-ink hover:bg-surface',
        )}
      >
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full transition-colors lg:size-6',
            open ? 'bg-canvas text-accent' : 'bg-accent text-canvas',
          )}
        >
          <Sparkles
            className="size-3.5"
            aria-hidden="true"
          />
        </span>
        {/* On a phone only the icon shows: the toolbar also holds the breadcrumb and the screen's actions. */}
        <span className="sr-only sm:not-sr-only">Ask AI</span>
        <span className={cn('hidden font-normal xl:inline', open ? 'text-canvas' : 'text-ink-muted')}>{SCOPE[about.kind]}</span>
      </button>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {!introSeen && !open && (
            <motion.div
              role="note"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: 0.4 }}
              className="absolute top-full right-0 z-40 mt-2 w-72 rounded-xl border border-border-subtle bg-surface p-3 text-left shadow-lg"
            >
              <span aria-hidden="true" className="absolute -top-1.5 right-6 size-3 rotate-45 border-t border-l border-border-subtle bg-surface" />
              <p className="text-sm font-medium text-ink">Ask AI about your papers</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                Ask in your own words. The answer comes from your papers, and every sentence in it is checked against the
                passage it cites, so you see what is backed and what is not.
              </p>
              <div className="mt-2 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-8 rounded-md px-2.5 text-xs font-medium text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismiss()
                    onToggle()
                  }}
                  className="min-h-8 rounded-md px-2.5 text-xs font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Try it
                </button>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-ink-muted hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
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
