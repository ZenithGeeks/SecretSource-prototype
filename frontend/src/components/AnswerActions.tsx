/**
 * The small pill under a finished answer in Ask: Copy puts the statements, their sources and
 * verdicts on the clipboard; Ask again sends the same question once more as a new turn. On a
 * desktop it shows while the pointer is over the answer or a button in it has focus.
 */

import { Check, Copy, RotateCcw } from 'lucide-react'
import { useState } from 'react'

const BUTTON =
  'flex min-h-11 items-center gap-1 rounded-full px-2.5 text-xs text-ink-muted hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent lg:min-h-7'

export function AnswerActions({ text, onAskAgain }: { text: string; onAskAgain?: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true))
  }

  return (
    <div className="flex items-center gap-0.5 self-start rounded-full border border-border-subtle bg-surface p-0.5 shadow-sm transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
      <button type="button" onClick={copy} className={BUTTON}>
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {onAskAgain && (
        <button type="button" onClick={onAskAgain} className={BUTTON}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Ask again
        </button>
      )}
    </div>
  )
}
