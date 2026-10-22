/**
 * Settings, Agents: how to add SecretSource to Claude Code, Codex or VS Code over MCP, what a
 * connected agent may do, and a link that connects this tab. The connect screen itself
 * (components/ConnectAgent) only asks for consent. docs/agent-tools.md covers the agent's side.
 */

import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { Role } from '../lib/roles'
import { cn } from '../lib/utils'
import { AgentAbilities } from './AgentAbilities'
import { Section } from './settings'

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

// Only these roles' apps hold the agent bridge (components/useAgentConnection).
const CAN_CONNECT: Role[] = ['researcher', 'labeler']

export function AgentsSection({ role }: { role: Role }) {
  const [client, setClient] = useState<Client>('Claude Code')
  const [copied, setCopied] = useState(false)
  const { where, key, after, config } = CLIENTS[client]
  const copy = () => {
    void navigator.clipboard?.writeText(config).then(() => setCopied(true))
  }

  return (
    <Section title="Agents">
      <div className="flex w-full flex-col gap-5 border-t border-border-subtle py-3.5 text-[13px] text-ink">
        <p className="text-ink-muted">
          Claude Code, Codex or VS Code can work SecretSource for you from your terminal. You watch each step in
          the connected tab, with its cursor.
        </p>

        <Step number={1} title="Add SecretSource to your agent">
          <div role="group" aria-label="Your agent" className="mb-3 grid grid-cols-3 rounded-xl border border-border-subtle p-0.5">
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
                  'min-h-9 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  client === name ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <ol className="mb-2 flex list-decimal flex-col gap-1 pl-4 text-xs leading-5 text-ink-muted">
            <li>Get a Gatehouse key for the email you sign in with, and {key}.</li>
            <li>
              {where}; {after}.
            </li>
          </ol>
          <div className="relative">
            <pre className="rounded-lg bg-neutral-soft p-2.5 pt-10 font-mono text-xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
              {config}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-ink hover:border-accent"
            >
              {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </Step>

        <Step number={2} title="Connect a tab">
          {CAN_CONNECT.includes(role) ? (
            <p className="text-xs leading-5 text-ink-muted">
              The agent works in one tab at a time, and it stays connected until you disconnect it from the Agent
              pill.{' '}
              <a href={connectUrl()} className="font-medium text-accent underline-offset-2 hover:underline">
                Connect this tab
              </a>
            </p>
          ) : (
            <p className="text-xs leading-5 text-ink-muted">
              Switch to Researcher or Labeler to connect a tab. The data tools (your papers, claims and verdicts) work
              without one.
            </p>
          )}
        </Step>

        <AgentAbilities />
      </div>
    </Section>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-medium">
        <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent" aria-hidden="true">
          {number}
        </span>
        {title}
      </p>
      {children}
    </div>
  )
}

/** This page with ?connect=agent, which opens the connect screen after the reload. */
function connectUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('connect', 'agent')
  return url.toString()
}
