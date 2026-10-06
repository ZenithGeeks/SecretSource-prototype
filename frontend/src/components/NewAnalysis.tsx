/** The researcher's empty Analyses screen (Figma "New analysis"): what this does, the form, the three steps. */

import { ListChecks } from 'lucide-react'

import { SubmitForm } from './SubmitForm'

const STEPS = [
  { title: 'Read the claims', body: 'Every sentence that leans on a citation.' },
  { title: 'Find the passage', body: 'The page in the cited work that matches.' },
  { title: 'Weigh it', body: 'Backs it, contradicts it, or stays silent.' },
]

export function NewAnalysis({ onStarted }: { onStarted: (id: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-7 pt-10 pb-16">
      <div className="rounded-[18px] bg-accent-soft p-3.5 text-accent">
        <ListChecks className="size-7" aria-hidden="true" />
      </div>
      <div className="flex flex-col items-center gap-2.5 text-center">
        <h1 className="type-display text-balance">Does the paper’s evidence hold up?</h1>
        <p className="max-w-[560px] text-[15px] leading-6 text-ink-muted">
          We read every claim, find the passage in the work it cites, and tell you whether that
          work actually says it.
        </p>
      </div>
      <div className="w-full">
        <SubmitForm onStarted={onStarted} />
      </div>
      <ol className="grid w-full gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col items-start gap-1.5 rounded-[14px] p-4">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              {index + 1}
            </span>
            <p className="text-[13px] leading-[18px] font-medium">{step.title}</p>
            <p className="text-xs leading-4 text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
