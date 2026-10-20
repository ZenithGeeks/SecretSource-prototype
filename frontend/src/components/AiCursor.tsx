/**
 * The AI's pointer, for every role's Ask: it glides to the element an answer or a finding is
 * about (any element with `data-ask-target="kind:id"`), rings it, and shows a short reaction
 * beside it. It is only a visual guide: the Ask panel carries the same text for screen readers
 * and keyboards, so this is aria-hidden and never takes a click. The labeler's review points at
 * claims, passages and references; the other roles' Ask points at each statement as it is checked.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleHelp, Flag, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '../lib/utils'

/** An element on the page, found by its `data-ask-target="kind:id"`. */
export type AskTarget = { kind: string; id: string }

/** Where the cursor is and what it says there; `tone: 'reading'` while the AI is still working. */
export type Pointing = { target: AskTarget; tone: 'reading' | 'agrees' | 'flags' | 'asks' }

const REACTIONS = {
  reading: { label: 'Reading…', icon: Loader2, ring: 'border-accent', chip: 'bg-accent text-canvas' },
  agrees: { label: 'Looks right', icon: Check, ring: 'border-supports', chip: 'bg-supports text-canvas' },
  flags: { label: 'Check this', icon: Flag, ring: 'border-refutes', chip: 'bg-refutes text-canvas' },
  asks: { label: 'A question', icon: CircleHelp, ring: 'border-insufficient', chip: 'bg-insufficient text-canvas' },
} as const

type Box = { top: number; left: number; width: number; height: number }

const SPRING = { type: 'spring', stiffness: 260, damping: 28, mass: 0.8 } as const

export function AiCursor({ pointing }: { pointing: Pointing | null }) {
  const box = useTargetBox(pointing?.target ?? null)
  const reaction = pointing && REACTIONS[pointing.tone]
  return (
    <AnimatePresence>
      {reaction && box && (
        <motion.div
          key="ai-cursor"
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <motion.div
            className={cn('absolute rounded-xl border-2', reaction.ring)}
            initial={false}
            animate={{ x: box.left - 4, y: box.top - 4, width: box.width + 8, height: box.height + 8 }}
            transition={SPRING}
          />
          {/* The tip sits just inside the target's top right corner, where it does not cover text. */}
          <motion.div
            className="absolute flex items-start gap-1"
            initial={false}
            animate={{ x: box.left + Math.min(box.width - 28, 260), y: box.top + 6 }}
            transition={SPRING}
          >
            <svg width="22" height="24" viewBox="0 0 22 24" className="drop-shadow-md">
              <path d="M2 2 L2 20 L7 15.5 L10.5 22.5 L13.5 21 L10 14 L17 14 Z" className="fill-accent stroke-canvas" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <motion.span
              key={pointing.tone}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={cn('mt-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-md', reaction.chip)}
            >
              <reaction.icon className={cn('size-3.5', pointing.tone === 'reading' && 'animate-spin motion-reduce:animate-none')} />
              {reaction.label}
            </motion.span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The target's box on screen, kept up to date while the panel scrolls or the window resizes. */
function useTargetBox(target: AskTarget | null): Box | null {
  // The box with the target it was measured for, so a new target never shows the old box.
  const [measured, setMeasured] = useState<{ target: AskTarget; box: Box } | null>(null)
  useEffect(() => {
    if (!target) return
    // A claim or passage the person has hidden (a rejected claim's passages) has no box.
    const element = document.querySelector<HTMLElement>(`[data-ask-target="${target.kind}:${CSS.escape(target.id)}"]`)
    if (!element) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setMeasured({ target, box: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } })
    }
    const frame = window.requestAnimationFrame(measure)
    // Capture: the label panel scrolls by itself, and its scroll events do not reach the window.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [target])
  return measured && measured.target === target ? measured.box : null
}
