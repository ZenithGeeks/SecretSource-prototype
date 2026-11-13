/**
 * What Ask shows between a question and its first statement: three bouncing dots, a label with a
 * light sweeping across it, and the seconds so far. Under reduced motion only the timer moves.
 */

import { m, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

export function ThinkingState({ label }: { label: string }) {
  const reduceMotion = useReducedMotion()
  const seconds = useSecondsSince()

  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="flex items-end gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <m.span
            key={dot}
            className="size-1.5 rounded-full bg-accent"
            animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </span>
      <m.span
        role="status"
        className="bg-linear-to-r from-ink-muted via-ink to-ink-muted bg-size-[200%_100%] bg-clip-text font-medium text-transparent"
        animate={reduceMotion ? undefined : { backgroundPositionX: ['100%', '-100%'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      >
        {label}
      </m.span>
      {/* Outside the status line, so a screen reader does not read every second. */}
      <span className="text-ink-muted tabular-nums" aria-hidden="true">
        {seconds}s
      </span>
    </div>
  )
}

/** Whole seconds since the component mounted. */
function useSecondsSince() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return seconds
}
