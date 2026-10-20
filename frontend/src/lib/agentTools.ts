/**
 * The screen agent's browser tools (backend/app/agents/screen.py, docs/agent-tools.md): what each
 * tool call from the agent does on this page. Each moves the AI cursor first, then acts, and
 * returns a small result the agent reads. Only fill_field changes anything, and only after the
 * person approves it.
 */

import { askTarget, type AskTarget, type Pointing } from './askCursor'

/** What the role's app lets the agent do: open its screens and papers. */
export type ScreenActions = {
  screen: string
  screens: string[]
  openScreen: (screen: string) => void
  openPaper: (analysisId: string) => void
}

export type ToolContext = {
  actions: ScreenActions
  point: (pointing: Pointing | null) => void
  /** Shows the change and waits for the person's Apply (true) or Cancel (false). */
  confirm: (change: { target: string; label: string; text: string }) => Promise<boolean>
}

export type ToolCall = { id: string; name: string; args: Record<string, unknown> }
export type ToolResult = Record<string, unknown>

const MAX_TARGETS = 60 // enough for a screen; read_screen's answer goes into every later model call
const SETTLE_MS = 450 // the cursor's glide, so the person sees where it went before the app moves

/** Runs one tool call from the agent. An unknown tool is an error the agent reads, not a crash. */
export async function runTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const args = call.args as Record<string, string>
  switch (call.name) {
    case 'read_screen':
      return readScreen(context.actions.screen)
    case 'open_screen':
      return openScreen(args.screen, context)
    case 'open_paper':
      context.actions.openPaper(args.analysis_id)
      return { status: 'done' }
    case 'point_at':
      return pointAt(args.target, args.note, context)
    case 'fill_field':
      return fillField(args.target, args.text, context)
    default:
      return { status: 'error', message: `there is no tool named ${call.name} in this app` }
  }
}

/** One line for the Do it view, saying what a tool call does. */
export function describeTool(call: ToolCall): string {
  const args = call.args as Record<string, string>
  switch (call.name) {
    case 'read_screen':
      return 'Reading the screen'
    case 'open_screen':
      return `Opening ${args.screen}`
    case 'open_paper':
      return 'Opening the paper'
    case 'point_at':
      return `Pointing: ${args.note || args.target}`
    case 'fill_field':
      return `Filling in: “${args.text}”`
    default:
      return call.name
  }
}

function readScreen(screen: string): ToolResult {
  const targets = [...document.querySelectorAll<HTMLElement>('[data-ask-target]')]
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'))
    .slice(0, MAX_TARGETS)
    .map((element) => ({ target: element.dataset.askTarget, label: labelOf(element) }))
  return { screen, targets }
}

async function openScreen(screen: string, { actions, point }: ToolContext): Promise<ToolResult> {
  if (!actions.screens.includes(screen)) return { status: 'error', message: `no screen ${screen}; screens: ${actions.screens.join(', ')}` }
  point({ target: { kind: 'screen', id: screen }, tone: 'shows', label: `Opening ${screen}` })
  await wait(SETTLE_MS)
  actions.openScreen(screen)
  return { status: 'done', screen }
}

async function pointAt(target: string, note: string, { point }: ToolContext): Promise<ToolResult> {
  const parsed = parseTarget(target)
  if (!parsed || !find(target)) return { status: 'error', message: `${target} is not on the screen; call read_screen` }
  point({ target: parsed, tone: 'shows', label: note })
  await wait(SETTLE_MS)
  return { status: 'done' }
}

async function fillField(target: string, text: string, { point, confirm }: ToolContext): Promise<ToolResult> {
  const field = find(target)
  const parsed = parseTarget(target)
  if (!parsed || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    return { status: 'error', message: `${target} is not a field on the screen; call read_screen` }
  }
  point({ target: parsed, tone: 'asks', label: 'Fill this in?' })
  if (!(await confirm({ target, label: labelOf(field), text }))) return { status: 'cancelled' }
  typeInto(field, text)
  point({ target: parsed, tone: 'agrees', label: 'Filled in' })
  return { status: 'applied' }
}

/** Sets a field's value the way typing does, so React's onChange sees it. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, text)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
}

function find(target: string) {
  return document.querySelector<HTMLElement>(`[data-ask-target="${CSS.escape(target)}"]`)
}

function parseTarget(target: string): AskTarget | null {
  const at = target.indexOf(':')
  if (at < 1) return null
  const parsed = { kind: target.slice(0, at), id: target.slice(at + 1) } as AskTarget
  return askTarget(parsed) === target ? parsed : null
}

function labelOf(element: HTMLElement) {
  const text =
    element.getAttribute('aria-label') || element.innerText || element.textContent || element.getAttribute('placeholder') || element.title || ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
