/**
 * Connecting a coding agent (Claude Code or Codex) to this tab (lib/agentBridge): the connect
 * screen, where the person sees what the agent may do here and allows it, and the toolbar pill
 * that shows it working, holds a change for Apply, and disconnects. First-time setup is in
 * Settings, Agents (components/AgentsSection); docs/agent-tools.md covers the agent's side.
 */

import { AnimatePresence, m, MotionConfig } from 'framer-motion'
import { Link2, Loader2, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AgentBridge } from '../lib/agentBridge'
import { cn } from '../lib/utils'
import { AccessSummary } from './AgentAccessCard'
import { Button } from './ui'
import { ApproveChange } from './DoIt'

/** The connect screen: who is signed in, what the agent can and cannot do here, Allow or Cancel. */
export function ConnectAgent({ email, onAllow, onCancel }: { email: string | null; onAllow: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex overflow-y-auto bg-ink/45 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        tabIndex={-1}
        className="m-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-border-subtle bg-canvas dot-grid px-4 pt-8 pb-4 shadow-xl outline-none sm:px-6"
      >
        <AppPair />
        <section className="flex flex-col gap-5 rounded-2xl border border-border-subtle bg-surface p-6 shadow-md">
          <div className="text-center">
            <h2 id="connect-title" className="font-serif text-xl font-semibold text-balance text-ink">
              Let your coding agent use this tab
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Claude Code or Codex works SecretSource for you from your terminal. You watch each step here, with its cursor.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent" aria-hidden="true">
              {(email ?? 'L')[0].toUpperCase()}
            </span>
            <div className="min-w-0 text-left">
              <p className="text-xs text-ink-muted">{email ? 'Signed in as' : 'Signed in'}</p>
              <p className="truncate text-sm font-medium text-ink">{email ?? 'Local workspace'}</p>
            </div>
          </div>

          <AccessSummary />

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={onCancel} className="min-h-11 border border-border-subtle">
                Cancel
              </Button>
              <Button onClick={onAllow} className="min-h-11">
                Allow
              </Button>
            </div>
            <p className="text-center text-xs text-ink-muted">Only this tab, until you disconnect or close it.</p>
          </div>
        </section>
        <p className="text-center text-xs text-ink-muted">First time? Settings, Agents shows how to add SecretSource to your agent.</p>
      </div>
    </div>
  )
}

/** SecretSource and the terminal, linked: the one moment of motion on the screen. */
function AppPair() {
  const tile = 'flex size-11 items-center justify-center rounded-xl shadow-lg'
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex items-center justify-center gap-3" aria-hidden="true">
        <m.span
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(tile, 'bg-accent font-serif text-2xl font-semibold text-canvas')}
        >
          S
        </m.span>
        <m.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.2, ease: 'easeOut' }}
          className="flex size-7 items-center justify-center rounded-full border border-border-subtle bg-canvas text-ink-muted"
        >
          <Link2 className="size-3.5" />
        </m.span>
        <m.span
          initial={{ x: -16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(tile, 'bg-ink text-canvas')}
        >
          <SquareTerminal className="size-6" />
        </m.span>
      </div>
    </MotionConfig>
  )
}

/** The toolbar pill while an agent is connected; it opens by itself when a change waits for Apply. */
export function AgentStatus({ bridge }: { bridge: AgentBridge }) {
  const [open, setOpen] = useState(false)
  const shown = open || bridge.pending !== null
  const last = bridge.steps.at(-1)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={shown}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-9"
      >
        <span className="relative flex size-2">
          {bridge.working && <span className="absolute inset-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />}
          <span className={cn('relative size-2 rounded-full', bridge.working ? 'bg-accent' : 'bg-supports')} />
        </span>
        <SquareTerminal className="size-3.5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Agent</span>
      </button>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {shown && (
            <m.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute top-full right-0 z-40 mt-2 flex w-80 flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-3 text-left shadow-lg"
            >
              <div>
                <p className="text-sm font-medium text-ink">Your agent is connected</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted" aria-live="polite">
                  {bridge.working && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {bridge.working && last ? last : 'Waiting for your agent'}
                </p>
              </div>
              {bridge.steps.length > 0 && (
                <ol className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-ink-muted">
                  {bridge.steps.map((step, index) => (
                    <li key={index} className={index === bridge.steps.length - 1 ? 'text-ink' : undefined}>
                      {step}
                    </li>
                  ))}
                </ol>
              )}
              {bridge.pending && <ApproveChange change={bridge.pending} />}
              <button
                type="button"
                onClick={() => {
                  bridge.connect(false)
                  setOpen(false)
                }}
                className="min-h-9 rounded-lg text-sm font-medium text-refutes transition-colors hover:bg-refutes-soft"
              >
                Disconnect
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>
  )
}
