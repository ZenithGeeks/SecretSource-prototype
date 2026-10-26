/**
 * Ask's Do it mode: the person says what they want done, and the screen agent does it on screen
 * with the AI cursor (lib/screenAgent). A change waits here for Apply or Cancel. The same view
 * offers to connect a coding agent instead (components/ConnectAgent).
 */

import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ArrowUp, Ban, Check, CircleAlert, Loader2, MousePointerClick, Square, SquareTerminal, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ScreenActions } from '../lib/agentTools'
import type { Pointing } from '../lib/askCursor'
import { useScreenAgent, type AgentLine, type DelegationState, type PendingChange } from '../lib/screenAgent'
import { cn } from '../lib/utils'
import { AiCursor } from './AiCursor'
import { Badge } from './ui'

const EXAMPLES = ['Open my most recent paper', 'Show me where to search the library', 'Take me to the graph']

export function DoIt({ actions, onConnectAgent }: { actions: ScreenActions; onConnectAgent?: () => void }) {
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
              a field only after you press Apply, and it changes role only after you press Switch. It never saves labels,
              deletes or uploads anything. For questions about what is inside your papers it asks a specialist, and you see that here.
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
        <MotionConfig reducedMotion="user">
          {agent.lines.map((line, index) => (
            <Line key={index} line={line} />
          ))}
        </MotionConfig>
        {agent.pending && <ApproveChange change={agent.pending} />}
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
        {onConnectAgent && (
          <button
            type="button"
            onClick={onConnectAgent}
            className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg text-xs text-ink-muted transition-colors hover:bg-accent-soft hover:text-ink"
          >
            <SquareTerminal className="size-3.5" aria-hidden="true" />
            Work from your terminal: connect Claude Code or Codex
          </button>
        )}
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
  if (line.kind === 'delegation') return <Delegation line={line} />
  return <p className={cn('text-[13px] leading-5', line.kind === 'error' ? 'text-refutes' : 'text-ink')}>{line.text}</p>
}

/** The specialists the agent hands work to, by the name the stream gives. */
const SPECIALISTS: Record<string, string> = { data_agent: 'Papers specialist' }

/** How each hand-over state looks: words, a badge colour, and an icon, so colour is not the only cue. */
const DELEGATION: Record<DelegationState, { label: string; tone: 'accent' | 'supports' | 'refutes' | 'neutral'; icon: typeof Check }> = {
  working: { label: 'Working', tone: 'accent', icon: Loader2 },
  done: { label: 'Done', tone: 'supports', icon: Check },
  failed: { label: 'Failed', tone: 'refutes', icon: CircleAlert },
  stopped: { label: 'Stopped', tone: 'neutral', icon: Ban },
}

/** The agent handing a request to a specialist: who, what it was asked, and whether it has answered. */
function Delegation({ line }: { line: Extract<AgentLine, { kind: 'delegation' }> }) {
  const state = DELEGATION[line.state]
  const name = SPECIALISTS[line.name] ?? line.name
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-neutral-soft p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <Users className="size-3.5 text-accent" aria-hidden="true" />
          {name}
        </span>
        {/* The badge swaps in place when the state changes; keyed on the state so it animates once per change. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={line.state}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.14 }}
          >
            <Badge tone={state.tone}>
              <state.icon className={cn(line.state === 'working' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
              {state.label}
            </Badge>
          </motion.span>
        </AnimatePresence>
      </div>
      {line.task && <p className="text-[13px] leading-5 text-ink-muted [overflow-wrap:anywhere]">{line.task}</p>}
    </motion.div>
  )
}

/** One approval step for every change: plain words for what will happen, then Apply or Switch, or Cancel. */
export function ApproveChange({ change }: { change: PendingChange }) {
  return (
    <div role="group" aria-label="Approve this change" className="flex flex-col gap-2 rounded-xl border border-insufficient bg-insufficient-soft p-3">
      <p className="text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">{change.summary}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => change.answer(false)}
          className="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-accent-soft hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => change.answer(true)}
          className="min-h-9 rounded-lg bg-accent px-3 text-sm font-medium text-canvas hover:opacity-90"
        >
          {change.action}
        </button>
      </div>
    </div>
  )
}
