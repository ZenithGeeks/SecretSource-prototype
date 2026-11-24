/** "Labeling guide": opens the annotation guideline over the page, so the labeler keeps their place. */

import { lazy, Suspense, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../../lib/utils'

// Its own chunk: the guideline text and its renderer stay out of the main bundle.
const LabelingGuide = lazy(() => import('./LabelingGuide'))

export function GuideButton({
  className,
  onOpen,
  onClose,
}: {
  className?: string
  /** Runs as the guide opens, such as to close the popover the button sits in. */
  onOpen?: () => void
  /** Takes the focus back when the guide closes, in place of this button (hidden by `onOpen`). */
  onClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Back to this button: the dialog's own return goes to whatever had focus when it opened,
  // which is the page itself when the click did not focus the button.
  const close = () => {
    setOpen(false)
    if (onClose) onClose()
    else button.current?.focus()
  }
  const show = () => {
    setOpen(true)
    onOpen?.()
  }
  return (
    <>
      <button ref={button} type="button" onClick={show} className={cn('w-fit text-xs font-medium text-accent hover:underline', className)}>
        Labeling guide
      </button>
      {/* In document.body, so a parent's z-index cannot put page bars over the dialog. Keys stop
          at its edge: the workspace labels claims on plain letter and number keys. */}
      {open &&
        createPortal(
          <div onKeyDown={(event) => event.stopPropagation()}>
            <Suspense fallback={null}>
              <LabelingGuide onClose={close} />
            </Suspense>
          </div>,
          document.body,
        )}
    </>
  )
}
