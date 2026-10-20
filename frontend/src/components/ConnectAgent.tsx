/**
 * Connecting a coding agent (Claude Code or Codex) to this tab (lib/agentBridge): the connect
 * screen, where the person sees what the agent may do here and allows it, and the toolbar pill
 * that shows it working, holds a change for Apply, and disconnects. docs/agent-tools.md covers
 * the agent's side.
 */

import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Ban, Check, ChevronDown, Copy, Link2, Loader2, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AgentBridge } from '../lib/agentBridge'
import { cn } from '../lib/utils'
import { Button } from './ui'
import { ApproveChange } from './DoIt'

const CAN = [
  'See what is on this screen',
  'Open screens and papers',
  'Point at things with its cursor',
  'Fill in a field, after you press Apply',
  'Read your papers, claims and verdicts',
  'Start checking a paper you name',
]
const CANNOT = ['Save labels, delete or upload anything', 'Change your papers or your account']

const MCP_URL = 'https://wttw-1.tailcf73b7.ts.net:8443/secretsource/mcp/'

/**
 * How each agent adds SecretSource and gets the Gatehouse key: a command for Claude Code, which
 * keeps the key in its own config, and a file entry for the others. VS Code fills in only its own
 * variables (`${env:NAME}`, `${input:id}`), so its entry asks for the key and VS Code keeps it.
 */
const CLIENTS = {
  'Claude Code': {
    where: 'Run this in a terminal',
    key: 'put it in place of YOUR_KEY below',
    after: 'then start Claude Code',
    config: `claude mcp add --transport http --scope user secretsource ${MCP_URL} --header "apikey: YOUR_KEY"`,
  },
  Codex: {
    where: 'Add this to ~/.codex/config.toml',
    key: 'set it as the GATEHOUSE_KEY environment variable',
    after: 'then restart Codex',
    config: `[mcp_servers.secretsource]
url = "${MCP_URL}"
env_http_headers = { "apikey" = "GATEHOUSE_KEY" }
tool_timeout_sec = 300`,
  },
  'VS Code': {
    where: 'Add this to .vscode/mcp.json in your project',
    key: 'keep it at hand',
    after: 'VS Code asks for the key the first time and keeps it in its secret storage',
    config: `{
  "inputs": [
    { "type": "promptString", "id": "gatehouse-key", "description": "Gatehouse key", "password": true }
  ],
  "servers": {
    "secretsource": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": { "apikey": "\${input:gatehouse-key}" }
    }
  }
}`,
  },
}
type Client = keyof typeof CLIENTS

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
        className="m-auto grid w-full max-w-3xl overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-xl outline-none lg:grid-cols-2"
      >
        {/* Wide screens put the setup beside the consent, so opening it never makes the dialog taller. */}
        <section className="flex flex-col gap-5 p-8">
          <AppPair />
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

          <div className="flex flex-col gap-3 text-sm">
            <Abilities title="It can" items={CAN} allowed />
            <Abilities title="It cannot" items={CANNOT} allowed={false} />
          </div>

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
        <aside className="flex flex-col justify-center bg-neutral-soft p-8 lg:border-l border-border-subtle">
          <SetupHelp />
        </aside>
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
        <motion.span
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(tile, 'bg-accent font-serif text-2xl font-semibold text-canvas')}
        >
          S
        </motion.span>
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.2, ease: 'easeOut' }}
          className="flex size-7 items-center justify-center rounded-full border border-border-subtle bg-canvas text-ink-muted"
        >
          <Link2 className="size-3.5" />
        </motion.span>
        <motion.span
          initial={{ x: -16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(tile, 'bg-ink text-canvas')}
        >
          <SquareTerminal className="size-6" />
        </motion.span>
      </div>
    </MotionConfig>
  )
}

function Abilities({ title, items, allowed }: { title: string; items: string[]; allowed: boolean }) {
  const Icon = allowed ? Check : Ban
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-ink">
            <Icon className={cn('mt-0.5 size-4 shrink-0', allowed ? 'text-supports' : 'text-refutes')} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** First-time setup for the agent the person uses: the Gatehouse key and its MCP entry. Open on wide screens, folded on phones. */
function SetupHelp() {
  const [wide] = useState(() => window.matchMedia?.('(min-width: 1024px)').matches ?? false)
  const [client, setClient] = useState<Client>('Claude Code')
  const [copied, setCopied] = useState(false)
  const { where, key, after, config } = CLIENTS[client]
  const copy = () => {
    void navigator.clipboard?.writeText(config).then(() => setCopied(true))
  }
  return (
    <details open={wide} className="group text-xs text-ink-muted">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between font-medium text-ink">
        First time? Add SecretSource to your agent
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div role="group" aria-label="Your agent" className="mt-2 mb-3 grid grid-cols-3 rounded-xl border border-border-subtle bg-surface p-0.5">
        {(Object.keys(CLIENTS) as Client[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={client === name}
            onClick={() => {
              setClient(name)
              setCopied(false)
            }}
            className={cn(
              'min-h-9 rounded-lg text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              client === name ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <ol className="mb-2 flex list-decimal flex-col gap-1 pl-4 leading-5">
        <li>Get a Gatehouse key for the email you sign in with, and {key}.</li>
        <li>
          {where}; {after}.
        </li>
      </ol>
      <div className="relative">
        <pre className="rounded-lg bg-surface p-2.5 pt-10 font-mono text-xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{config}</pre>
        <button
          type="button"
          onClick={copy}
          className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-md py-1 border border-border-subtle bg-surface px-2 text-ink hover:border-accent"
        >
          {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </details>
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
            <motion.div
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
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>
  )
}
