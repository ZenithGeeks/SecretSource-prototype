/** "Labeling guide": opens the annotation guideline over the page, so the labeler keeps their place. */

import { lazy, Suspense, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../../lib/utils'

// Its own chunk: the guideline text and its renderer stay out of the main bundle.
const LabelingGuide = lazy(() => import('./LabelingGuide'))

export function GuideButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('w-fit text-xs font-medium text-accent hover:underline', className)}>
        Labeling guide
      </button>
      {/* In document.body, so a parent's z-index cannot put page bars over the dialog. Keys stop
          at its edge: the workspace labels claims on plain letter and number keys. */}
      {open &&
        createPortal(
          <div onKeyDown={(event) => event.stopPropagation()}>
            <Suspense fallback={null}>
              <LabelingGuide onClose={() => setOpen(false)} />
            </Suspense>
          </div>,
          document.body,
        )}
    </>
  )
}
