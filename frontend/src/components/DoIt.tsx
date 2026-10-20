/**
 * Ask's Do it mode: the person says what they want done, and the screen agent does it on screen
 * with the AI cursor (lib/screenAgent). A change waits here for Apply or Cancel.
 */

import { MotionConfig } from 'framer-motion'
import { ArrowUp, Loader2, MousePointerClick, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ScreenActions } from '../lib/agentTools'
import type { Pointing } from '../lib/askCursor'
import { useScreenAgent, type AgentLine } from '../lib/screenAgent'
import { cn } from '../lib/utils'
import { AiCursor } from './AiCursor'

const EXAMPLES = ['Open my most recent paper', 'Show me where to search the library', 'Take me to the graph']

export function DoIt({ actions }: { actions: ScreenActions }) {
  const [pointing, setPointing] = useState<Pointing | null>(null)
  const agent = useScreenAgent(actions, setPointing)
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [agent.lines.length, agent.pending])

  const send = (message: string) => {
    if (!message.trim() || agent.running) return
    setDraft('')
    void agent.send(message.trim())
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {agent.lines.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] font-medium text-ink">Tell the AI what to do, and watch it work.</p>
            <p className="text-[13px] leading-5 text-ink-muted">
              It moves around the app with its own cursor: it opens screens and papers, and points at things. It fills in
              a field only after you press Apply, and it never saves, deletes or starts an analysis.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => send(example)}
                  className="min-h-9 rounded-full border border-border-subtle px-3 text-xs text-ink hover:border-accent hover:bg-accent-soft"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
        {agent.lines.map((line, index) => (
          <Line key={index} line={line} />
        ))}
        {agent.pending && (
          <div role="group" aria-label="Approve this change" className="flex flex-col gap-2 rounded-xl border border-insufficient bg-insufficient-soft p-3">
            <p className="text-xs font-medium text-ink">Fill in “{agent.pending.label || 'this field'}” with:</p>
            <p className="rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink [overflow-wrap:anywhere]">{agent.pending.text}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => agent.pending?.answer(false)}
                className="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-accent-soft hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => agent.pending?.answer(true)}
                className="min-h-9 rounded-lg bg-accent px-3 text-sm font-medium text-canvas hover:opacity-90"
              >
                Apply
              </button>
            </div>
          </div>
        )}
        {agent.running && !agent.pending && (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Working…
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="px-5 pb-4">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="flex items-center gap-2 rounded-xl border border-border-subtle bg-neutral-soft py-1.5 pr-1.5 pl-3"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={agent.running}
            aria-label="What should the AI do?"
            placeholder={agent.running ? 'Working… Stop ends it' : 'e.g. Open my ColBERT paper'}
            maxLength={2000}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
          />
          {agent.running ? (
            <button type="button" onClick={agent.stop} aria-label="Stop" className="flex size-11 items-center justify-center rounded-lg border border-border-subtle text-ink lg:size-8">
              <Square className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Do it"
              className="flex size-11 items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 lg:size-8"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          )}
        </form>
      </div>
      <MotionConfig reducedMotion="user">
        <AiCursor pointing={pointing} />
      </MotionConfig>
    </>
  )
}

function Line({ line }: { line: AgentLine }) {
  if (line.kind === 'person') {
    return <p className="ml-8 self-end rounded-xl bg-neutral-soft px-3 py-2 text-[13px] leading-5 text-ink">{line.text}</p>
  }
  if (line.kind === 'step') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <MousePointerClick className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        {line.text}
      </p>
    )
  }
  return <p className={cn('text-[13px] leading-5', line.kind === 'error' ? 'text-refutes' : 'text-ink')}>{line.text}</p>
}
