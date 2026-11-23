/**
 * Ask's Do it mode: the person says what they want done, and the screen agent does it on screen
 * with the AI cursor (lib/screenAgent). A change waits here for Apply or Cancel. The same view
 * offers to connect a coding agent instead (components/ConnectAgent).
 */

import { AnimatePresence, m, MotionConfig } from 'framer-motion'
import { ArrowUp, Ban, Check, ChevronLeft, CircleAlert, Loader2, MousePointerClick, Square, SquareTerminal, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ScreenActions } from '../lib/agentTools'
import type { Pointing } from '../lib/askCursor'
import { useScreenAgent, type AgentLine, type DelegationState, type PendingChange } from '../lib/screenAgent'
import { cn } from '../lib/utils'
import { AiCursor } from './AiCursor'
import { Badge } from './ui'

const EXAMPLES = ['Open my most recent paper', 'Show me where to search the library', 'Take me to the graph']

/** After this long with no answer, the Working line says Stop is there. */
const SLOW_SECONDS = 30

/** Where the person was when they sent the request: a screen, and the analysis open on it. */
type Place = { screen: string; analysis: string | null }

function placeNow(screen: string): Place {
  return { screen, analysis: new URLSearchParams(window.location.search).get('analysis') }
}

/** Seconds since `running` turned on, ticking once a second; 0 while it is off. */
function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => {
      window.clearInterval(timer)
      setSeconds(0)
    }
  }, [running])
  return seconds
}

/** What a screen reader hears about the run. */
function runStatus(running: boolean, stopped: boolean, replied: boolean) {
  if (running) return 'Working'
  if (stopped) return 'Stopped'
  return replied ? 'Done. The reply is below.' : ''
}

export function DoIt({
  actions,
  onConnectAgent,
  prefill,
  onPrefilled,
}: {
  actions: ScreenActions
  onConnectAgent?: () => void
  /** A request a screen typed in for the person to read and send (useAsk's askToDo); a new `n` types it again. */
  prefill?: { text: string; n: number }
  /** The prefill is in the field: the owner drops it, so a later mount does not type it again. */
  onPrefilled?: () => void
}) {
  const [pointing, setPointing] = useState<Pointing | null>(null)
  const agent = useScreenAgent(actions, setPointing)
  const [draft, setDraft] = useState(prefill?.text ?? '')
  const [seenPrefill, setSeenPrefill] = useState(prefill?.n)
  if (prefill && seenPrefill !== prefill.n) {
    setSeenPrefill(prefill.n)
    setDraft(prefill.text)
  }
  const [stopped, setStopped] = useState(false)
  const [start, setStart] = useState<Place | null>(null)
  const elapsed = useElapsed(agent.running)
  const field = useRef<HTMLInputElement>(null)
  // The person reads what was typed in, then sends it; the field takes the focus for that.
  useEffect(() => {
    if (!prefill) return
    field.current?.focus()
    onPrefilled?.()
  }, [prefill, onPrefilled])
  const end = useRef<HTMLDivElement>(null)
  const now = placeNow(actions.screen)
  // A run that took the person somewhere else offers the way back once it ends.
  const wayBack = !agent.running && start && (start.screen !== now.screen || start.analysis !== now.analysis) ? start : null
  const last = agent.lines.at(-1)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [agent.lines.length, agent.pending])

  const send = (message: string) => {
    if (!message.trim() || agent.running) return
    setDraft('')
    setStopped(false)
    setStart(placeNow(actions.screen))
    void agent.send(message.trim())
  }

  const goBack = (place: Place) => {
    if (place.analysis && actions.openPaper) actions.openPaper(place.analysis)
    else actions.openScreen(place.screen)
    setStart(null)
  }

  return (
    <>
      <p role="status" className="sr-only">
        {runStatus(agent.running, stopped, last?.kind === 'agent' || last?.kind === 'error')}
      </p>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {agent.lines.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] font-medium text-ink">Tell the AI what to do, and watch it work.</p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-5 text-ink">
              <li>It opens screens and papers, and points at things with its own cursor.</li>
              <li>It fills in a field only after you press Apply, and changes role only after you press Switch.</li>
              <li>It never saves labels, deletes or uploads anything.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              {(actions.examples ?? EXAMPLES).map((example) => (
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
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Working… <span className="tabular-nums">{elapsed} s</span>
            {elapsed >= SLOW_SECONDS && <span>· still going. Stop ends it and changes nothing.</span>}
          </p>
        )}
        {stopped && !agent.running && <p className="text-[13px] leading-5 text-ink">Stopped. Nothing was changed.</p>}
        {wayBack && (
          <button
            type="button"
            onClick={() => goBack(wayBack)}
            className="flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to where you were
          </button>
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
            ref={field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={agent.running}
            aria-label="What should the AI do?"
            placeholder={agent.running ? 'Working… Stop ends it' : 'e.g. Open my most recent paper'}
            maxLength={2000}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
          />
          {agent.running ? (
            <button
              type="button"
              onClick={() => {
                setStopped(true)
                agent.stop()
              }}
              aria-label="Stop" className="flex size-11 items-center justify-center rounded-lg border border-border-subtle text-ink lg:size-8">
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
  if (line.kind === 'step' || line.kind === 'progress') {
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
    <m.div
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
          <m.span
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
          </m.span>
        </AnimatePresence>
      </div>
      {line.task && <p className="text-[13px] leading-5 text-ink-muted [overflow-wrap:anywhere]">{line.task}</p>}
    </m.div>
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
