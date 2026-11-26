/** The researcher's Analyses screen with nothing open (Figma "New analysis"). On a first visit:
 * what this does, the form and the three steps. Once there are past analyses (`children`), they
 * come first, under a "New analysis" button that opens the form. */

import { ListChecks, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { SubmitForm } from './SubmitForm'
import { Button } from './ui'
import { cn } from '../lib/utils'

const STEPS = [
  { title: 'Read the claims', body: 'Every sentence that leans on a citation.' },
  { title: 'Find the passage', body: 'The page in the cited work that matches.' },
  { title: 'Weigh it', body: 'Backs it, contradicts it, or stays silent.' },
]

export function NewAnalysis({
  onStarted,
  formOpen = false,
  children,
}: {
  onStarted: (id: string) => void
  /** Start with the form open above the past analyses. */
  formOpen?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(formOpen)
  const keepOpen = () => setOpen(true)
  return (
    <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-7 pb-16', !children && 'items-center pt-10')}>
      {!children && (
        <>
          <div className="rounded-2xl bg-accent-soft p-3.5 text-accent">
            <ListChecks className="size-7" aria-hidden="true" />
          </div>
          <div className="flex flex-col items-center gap-2.5 text-center">
            <h1 className="type-display text-balance">Does the paper’s evidence hold up?</h1>
            <p className="max-w-150 text-reading leading-6 text-ink-muted">
              We read every claim, find the passage in the work it cites, and tell you whether that
              work actually says it.
            </p>
          </div>
        </>
      )}
      {open || !children ? (
        <div className="w-full" onFocusCapture={keepOpen} onChangeCapture={keepOpen} onDropCapture={keepOpen}>
          <SubmitForm onStarted={onStarted} />
        </div>
      ) : (
        <Button className="self-start" onClick={keepOpen}>
          <Plus className="size-4" aria-hidden="true" />
          New analysis
        </Button>
      )}
      {children || (
        <ol className="grid w-full gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col items-start gap-1.5 rounded-xl p-4">
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <p className="text-ui leading-4.5 font-medium">{step.title}</p>
              <p className="text-xs leading-4 text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
