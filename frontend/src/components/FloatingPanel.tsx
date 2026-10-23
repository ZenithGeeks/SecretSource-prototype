/**
 * A window that floats over the page without blocking it: the person drags it by its title bar
 * (or moves it with the arrow keys there) to anywhere in the browser window, and it opens where
 * they left it last. The labeler's Ask AI uses it on wide screens, so a review can sit beside
 * the passage it talks about instead of under it.
 */

import { AnimatePresence, motion, MotionConfig, useDragControls, useMotionValue } from 'framer-motion'
import { GripHorizontal, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import { IconButton } from './ui'

const MARGIN = 24 // the default gap from the window's bottom right corner
const STEP = 24 // one arrow key press; Shift moves four steps

type Offset = { x: number; y: number }

export function FloatingPanel({
  open,
  title,
  subtitle,
  icon,
  storageKey,
  onClose,
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  icon?: ReactNode
  /** Where the panel's position is remembered in this browser. */
  storageKey: string
  onClose: () => void
  children: ReactNode
}) {
  const bounds = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const drag = useDragControls()
  const saved = readOffset(storageKey)
  const x = useMotionValue(saved.x)
  const y = useMotionValue(saved.y)

  // Keep the panel inside the window when the window shrinks, or when it was saved on a larger one.
  useEffect(() => {
    if (!open) return
    const keepInside = () => {
      const clamped = clamp({ x: x.get(), y: y.get() }, panel.current)
      x.set(clamped.x)
      y.set(clamped.y)
    }
    const frame = window.requestAnimationFrame(keepInside)
    window.addEventListener('resize', keepInside)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', keepInside)
    }
  }, [open, x, y])

  const remember = () => writeOffset(storageKey, { x: x.get(), y: y.get() })

  const moveWithKeys = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? STEP * 4 : STEP
    const moves: Record<string, Offset> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const next = clamp({ x: x.get() + move.x, y: y.get() + move.y }, panel.current)
    x.set(next.x)
    y.set(next.y)
    remember()
  }

  return (
    <MotionConfig reducedMotion="user">
      <div ref={bounds} className="pointer-events-none fixed inset-0 z-40">
        <AnimatePresence>
          {open && (
            <motion.section
              ref={panel}
              role="dialog"
              aria-modal="false"
              aria-label={title}
              drag
              dragListener={false}
              dragControls={drag}
              dragConstraints={bounds}
              dragElastic={0}
              dragMomentum={false}
              onDragEnd={remember}
              onKeyDown={(event) => event.key === 'Escape' && onClose()}
              style={{ x, y, right: MARGIN, bottom: MARGIN, transformOrigin: 'bottom right' }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: 'easeIn' } }}
              className="pointer-events-auto absolute flex max-h-[70vh] w-[400px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-xl"
            >
              <header
                onPointerDown={(event) => drag.start(event)}
                className="flex cursor-grab touch-none items-center gap-3 border-b border-border-subtle px-3 py-2.5 select-none active:cursor-grabbing"
              >
                {icon}
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-ink">{title}</span>
                  {subtitle && <span className="truncate text-xs text-ink-muted">{subtitle}</span>}
                </span>
                <IconButton
                  onKeyDown={moveWithKeys}
                  aria-label={`Move ${title}: use the arrow keys`}
                  title="Drag to move, or focus and use the arrow keys"
                  className="ml-auto size-8"
                >
                  <GripHorizontal className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  onClick={onClose}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-label={`Close ${title}`}
                  className="size-8"
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

/** An offset that keeps the whole panel inside the window, from its default corner. */
function clamp(offset: Offset, element: HTMLElement | null): Offset {
  if (!element) return offset
  const width = element.offsetWidth
  const height = element.offsetHeight
  // At offset 0 the panel sits MARGIN from the bottom right; it may move left and up from there.
  const minX = width + 2 * MARGIN - window.innerWidth
  const minY = height + 2 * MARGIN - window.innerHeight
  return {
    x: Math.min(MARGIN, Math.max(Math.min(minX, 0), offset.x)),
    y: Math.min(MARGIN, Math.max(Math.min(minY, 0), offset.y)),
  }
}

function readOffset(key: string): Offset {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Offset | null
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function writeOffset(key: string, offset: Offset) {
  try {
    window.localStorage.setItem(key, JSON.stringify(offset))
  } catch {
    // Storage can be refused; the panel then opens in its corner next time.
  }
}
