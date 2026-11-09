/** Two panes side by side with a draggable handle between them (Figma "gutter handle"). The
 * handle is a keyboard-reachable separator: arrow keys nudge it, Home/End snap it, a double
 * click puts it back. Below `lg` the panes stack and the handle goes away. Give it a
 * `storageKey` and the ratio is kept across reloads. */

import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

const MIN = 0.25
const MAX = 0.75
const STEP = 0.05
const HANDLE_PX = 6 // the separator's width (lg:w-1.5): it sits between the panes, outside both

const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value))

/** Where a key sends the handle, or null for a key it does not use. */
function ratioForKey(key: string, ratio: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return ratio - STEP
    case 'ArrowRight':
      return ratio + STEP
    case 'Home':
      return MIN
    case 'End':
      return MAX
    default:
      return null
  }
}

function readRatio(key: string | undefined, fallback: number) {
  if (!key) return fallback
  try {
    const stored = Number(window.localStorage.getItem(key))
    return stored > 0 ? clamp(stored) : fallback
  } catch {
    return fallback // storage can be blocked: the pane just starts at its default
  }
}

function writeRatio(key: string | undefined, ratio: number) {
  if (!key) return
  try {
    window.localStorage.setItem(key, String(ratio))
  } catch {
    // blocked storage: the ratio lasts until the page is closed
  }
}

export function SplitPane({
  left,
  right,
  leftLabel,
  rightLabel,
  separatorLabel = `Resize the ${leftLabel.toLowerCase()} and the ${rightLabel.toLowerCase()}`,
  initialRatio = 0.5,
  minRight = 0,
  storageKey,
}: {
  left: ReactNode
  right: ReactNode
  leftLabel: string
  rightLabel: string
  /** What a screen reader says for the handle. */
  separatorLabel?: string
  /** The left pane's share of the width until the person moves the handle. */
  initialRatio?: number
  /** The narrowest the right pane may get, in px, so its content never has to squeeze. */
  minRight?: number
  /** Where to keep the ratio. Left out, the ratio is not kept. */
  storageKey?: string
}) {
  const [ratio, setRatio] = useState(() => readRatio(storageKey, initialRatio))
  const container = useRef<HTMLDivElement>(null)

  // The share the left pane may take: the right pane keeps `minRight` px of the measured width,
  // even when that is less than MIN. A width of 0 is the page before it is laid out: no limit yet.
  const limit = (value: number, width: number) => Math.min(clamp(value), width ? 1 - (minRight + HANDLE_PX) / width : MAX)

  const change = (value: number) => {
    // Unreachable fallback: change() only runs from the mounted handle.
    /* v8 ignore next -- @preserve */
    const next = limit(value, container.current?.getBoundingClientRect().width ?? 0)
    setRatio(next)
    writeRatio(storageKey, next)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = container.current?.getBoundingClientRect()
    // Unreachable: the handle that was pressed is inside the mounted container.
    /* v8 ignore next -- @preserve */
    if (!rect) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let latest = ratio
    const move = (e: PointerEvent) => {
      latest = limit((e.clientX - rect.left) / rect.width, rect.width)
      setRatio(latest)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      writeRatio(storageKey, latest) // once per drag, not on every move
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = ratioForKey(event.key, ratio)
    if (next === null) return
    event.preventDefault()
    change(next)
  }

  return (
    <div ref={container} className="flex min-h-0 flex-1 flex-col lg:flex-row" style={{ '--split': `${ratio * 100}%` } as React.CSSProperties}>
      <section
        aria-label={leftLabel}
        className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-none lg:basis-[var(--split)]"
        // A window narrowed after the ratio was saved must still leave the right pane its width.
        style={minRight ? { maxWidth: `calc(100% - ${minRight + HANDLE_PX}px)` } : undefined}
      >
        {left}
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={separatorLabel}
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => change(initialRatio)}
        // The bar is 6px wide; the pseudo-element makes the pointer target 24px (WCAG 2.2 target size).
        className="relative hidden shrink-0 cursor-col-resize touch-none flex-col items-center justify-center gap-[3px] bg-border-subtle before:absolute before:inset-y-0 before:-left-[9px] before:-right-[9px] lg:flex lg:w-1.5 hover:bg-accent-soft focus-visible:bg-accent-soft"
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
