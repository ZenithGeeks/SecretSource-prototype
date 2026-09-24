/** Two panes side by side with a draggable handle between them (Figma "gutter handle"). The
 * handle is a keyboard-reachable separator: arrow keys nudge it, Home/End snap it. Below
 * `lg` the panes stack and the handle goes away. */

import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

const MIN = 0.25
const MAX = 0.75
const STEP = 0.05

export function SplitPane({
  left,
  right,
  leftLabel,
  rightLabel,
  initialRatio = 0.5,
}: {
  left: ReactNode
  right: ReactNode
  leftLabel: string
  rightLabel: string
  initialRatio?: number
}) {
  const [ratio, setRatio] = useState(initialRatio)
  const container = useRef<HTMLDivElement>(null)

  const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value))

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = container.current?.getBoundingClientRect()
    if (!rect) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => setRatio(clamp((e.clientX - rect.left) / rect.width))
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowLeft'
        ? ratio - STEP
        : event.key === 'ArrowRight'
          ? ratio + STEP
          : event.key === 'Home'
            ? MIN
            : event.key === 'End'
              ? MAX
              : null
    if (next === null) return
    event.preventDefault()
    setRatio(clamp(next))
  }

  return (
    <div ref={container} className="flex min-h-0 flex-1 flex-col lg:flex-row" style={{ '--split': `${ratio * 100}%` } as React.CSSProperties}>
      <section aria-label={leftLabel} className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-none lg:basis-[var(--split)]">
        {left}
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the editor and the preview"
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="hidden shrink-0 cursor-col-resize touch-none flex-col items-center justify-center gap-[3px] bg-border-subtle lg:flex lg:w-1.5 hover:bg-accent-soft focus-visible:bg-accent-soft"
      >
        <span aria-hidden="true" className="size-[3px] rounded-full bg-ink-muted" />
        <span aria-hidden="true" className="size-[3px] rounded-full bg-ink-muted" />
        <span aria-hidden="true" className="size-[3px] rounded-full bg-ink-muted" />
      </div>
      <section aria-label={rightLabel} className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border-subtle lg:border-t-0">
        {right}
      </section>
    </div>
  )
}
