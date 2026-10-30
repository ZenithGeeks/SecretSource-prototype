/**
 * The screen agent's browser tools (backend/app/agents/screen.py, docs/agent-tools.md): what each
 * tool call from the agent does on this page. Each moves the AI cursor first, then acts, and
 * returns a small result the agent reads. Anything that changes data, and a role switch, waits
 * for the person: one approval step, then Apply or Switch. Cancel changes nothing.
 */

import { askTarget, type AskTarget, type Pointing } from './askCursor'
import type { Role } from './roles'

/** What the role's app lets the agent do: open its screens and papers, and change role. */
export type ScreenActions = {
  /** Which role's screen agent answers (backend/app/agent_runs.py); the Researcher's when left out. */
  role?: 'researcher' | 'labeler' | 'writer'
  screen: string
  screens: string[]
  openScreen: (screen: string) => void
  /** Missing in a role with no papers (the Author's), so open_paper fails instead of switching roles. */
  openPaper?: (analysisId: string) => void
  /** Moves to that role the way the role menu does. The caller performs it after the result is sent. */
  switchRole?: (role: Role) => void
  /** False when the person still has unsaved work and declines to leave it. */
  confirmLeave?: () => boolean
  /** What Do it offers to try before the first message; the Researcher's when left out. */
  examples?: string[]
  /** The Author's open editor, for read_draft; null when no editor is open. */
  draftEditor?: () => DraftReader | null
}

/** What the Author's editor lets the agent read: the text on screen, not the gateway's copy, so
 * an edit still waiting for its autosave is included. */
export type DraftReader = {
  /** Which draft the editor has open, so the agent can tell it is the one the person asked for. */
  draft: () => { id: string; title: string }
  /** The file on screen. */
  active: string | undefined
  files: () => { name: string; kind: string; dirty: boolean }[]
  /** A file's text as on screen; undefined for a file the draft does not have. */
  read: (file: string) => string | undefined
  /** The keys of the draft's .bib files as on screen. */
  bibKeys: () => string[]
}

/** What an approval step tells the person. The same card covers every change; the button word differs. */
export type ConfirmRequest = {
  /** What will happen, in plain words, if the person approves. */
  summary: string
  /** Apply for a change to data. Switch for a role change (the tool's contract). */
  action: 'Apply' | 'Switch'
}

export type ToolContext = {
  actions: ScreenActions
  point: (pointing: Pointing | null) => void
  /** Shows `summary` and waits for the person to approve (true) or Cancel (false). */
  confirm: (change: ConfirmRequest) => Promise<boolean>
  /** Records a role switch. The caller performs it only after this tool's result is sent. */
  onSwitched?: (role: Role) => void
}

export type ToolCall = { id: string; name: string; args: Record<string, unknown> }
export type ToolResult = Record<string, unknown>

const MAX_TARGETS = 60 // enough for a screen; read_screen's answer goes into every later model call
const SETTLE_MS = 450 // the cursor's glide, so the person sees where it went before the app moves
// read_draft's answer goes into every later model call: about 300 lines of LaTeX at most.
export const DRAFT_MAX_LINES = 300
export const DRAFT_MAX_CHARS = 24_000
// The draft's files and .bib keys go with every read_draft answer too: a thesis has tens of files
// and a few hundred keys; past that, or past the characters (as JSON), the list stops.
export const DRAFT_MAX_FILES = 50
export const DRAFT_FILES_MAX_CHARS = 4_000
export const DRAFT_MAX_BIB_KEYS = 500
export const DRAFT_BIB_KEYS_MAX_CHARS = 8_000
// Right after open_screen("editor") the editor may still be mounting or fetching the draft.
export const DRAFT_WAIT_MS = 2_000
const DRAFT_POLL_MS = 50

/** Runs one tool call from the agent. An unknown tool is an error the agent reads, not a crash. */
export async function runTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const args = call.args as Record<string, string>
  switch (call.name) {
    case 'read_screen':
      return readScreen(context.actions.screen)
    case 'open_screen':
      return openScreen(args.screen, context)
    case 'open_paper':
      if (!context.actions.openPaper) return { status: 'error', message: 'there are no papers in this role; call switch_role first' }
      context.actions.openPaper(args.analysis_id)
      return { status: 'done' }
    case 'point_at':
      return pointAt(args.target, args.note, context)
    case 'fill_field':
      return fillField(args.target, args.text, context)
    case 'switch_role':
      return switchRole(args.role, args.reason, context)
    case 'read_draft':
      return readDraft(call.args, context.actions)
    default:
      return { status: 'error', message: `there is no tool named ${call.name} in this app` }
  }
}

/** The agent's role word, and the app's id for it. The agent says "author"; the app says "writer". */
const AGENT_ROLE: Record<string, Role> = { researcher: 'researcher', labeler: 'labeler', author: 'writer' }
const AGENT_ROLE_LABEL: Record<string, string> = { researcher: 'Researcher', labeler: 'Labeler', author: 'Author' }

/** The app's role for the agent's word; own keys only, so "constructor" or "toString" is not a role. */
const agentRole = (role: string): Role | undefined => (Object.hasOwn(AGENT_ROLE, role) ? AGENT_ROLE[role] : undefined)

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
    case 'switch_role':
      return `Switching to the ${agentRole(args.role) ? AGENT_ROLE_LABEL[args.role] : args.role} role`
    case 'read_draft':
      return `Reading ${args.file || 'the draft'}`
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

/** One file of the open draft, numbered from `start_line`, up to DRAFT_MAX_LINES lines or
 * DRAFT_MAX_CHARS characters; `truncated` says the cap stopped it before `end_line` (or the end).
 * A first line longer than the cap is cut and `line_truncated` says so: the rest of it cannot be read.
 * The files and .bib keys stop at their caps too, with `files_truncated` / `bib_keys_truncated`.
 * Waits up to DRAFT_WAIT_MS for an editor that is still opening. */
async function readDraft(args: Record<string, unknown>, actions: ScreenActions): Promise<ToolResult> {
  if (!actions.draftEditor) return { status: 'error', message: 'there is no draft editor in this role' }
  const opened = () => {
    const reader = actions.draftEditor?.() ?? null
    return reader && reader.files().length > 0 ? reader : null
  }
  let reader = opened()
  for (let waited = 0; !reader && waited < DRAFT_WAIT_MS; waited += DRAFT_POLL_MS) {
    await wait(DRAFT_POLL_MS)
    reader = opened()
  }
  if (!reader) {
    return actions.draftEditor()
      ? { status: 'error', message: 'the draft is still opening; try again' }
      : { status: 'error', message: 'no draft is open in the editor; open one with open_screen("editor")' }
  }
  const allFiles = reader.files()
  const files = capList(allFiles, DRAFT_MAX_FILES, DRAFT_FILES_MAX_CHARS)
  const file = typeof args.file === 'string' && args.file ? args.file : (reader.active ?? allFiles[0].name)
  const text = reader.read(file)
  if (text === undefined) {
    const names = files.kept.map((f) => f.name).join(', ') + (files.cut ? ', …' : '')
    return { status: 'error', message: `no file ${file} in this draft; files: ${names}` }
  }
  const lines = text.split('\n')
  const first = Math.max(1, Math.trunc(Number(args.start_line)) || 1)
  const asked = Math.trunc(Number(args.end_line)) || 0
  const end = asked > 0 ? Math.min(asked, lines.length) : lines.length
  if (first > lines.length) return { status: 'error', message: `${file} has ${lines.length} lines` }
  const shown: string[] = []
  let size = 0
  let lineCut = false
  for (let n = first; n <= end && shown.length < DRAFT_MAX_LINES; n += 1) {
    const row = `${n}\t${lines[n - 1]}`
    if (shown.length === 0 && row.length > DRAFT_MAX_CHARS) {
      // One line over the cap on its own (a paragraph with no line breaks): show its start.
      shown.push(row.slice(0, DRAFT_MAX_CHARS))
      lineCut = true
      break
    }
    if (shown.length > 0 && size + row.length + 1 > DRAFT_MAX_CHARS) break
    shown.push(row)
    size += row.length + 1
  }
  const last = first + shown.length - 1
  const bibKeys = capList(reader.bibKeys(), DRAFT_MAX_BIB_KEYS, DRAFT_BIB_KEYS_MAX_CHARS)
  return {
    draft: reader.draft(),
    file,
    files: files.kept,
    ...(files.cut && { files_truncated: true }),
    first_line: first,
    last_line: last,
    total_lines: lines.length,
    truncated: last < end || lineCut,
    ...(lineCut && {
      line_truncated: true,
      note:
        `line ${last} has ${lines[last - 1].length} characters and only its start is shown; read_draft cannot show the rest of a line.` +
        (last < lines.length ? ` The next line is ${last + 1}.` : ''),
    }),
    text: shown.join('\n'),
    bib_keys: bibKeys.kept,
    ...(bibKeys.cut && { bib_keys_truncated: true }),
  }
}

/** The first of `items` that fit in `max` entries and `maxChars` characters as JSON; `cut` says some were left out. */
function capList<T>(items: T[], max: number, maxChars: number): { kept: T[]; cut: boolean } {
  const kept: T[] = []
  let size = 0
  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1
    if (kept.length === max || size + itemSize > maxChars) break
    kept.push(item)
    size += itemSize
  }
  return { kept, cut: kept.length < items.length }
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
  const label = labelOf(field) || 'this field'
  if (!(await confirm({ summary: `Type “${text}” into ${label}.`, action: 'Apply' }))) return { status: 'cancelled' }
  typeInto(field, text)
  point({ target: parsed, tone: 'agrees', label: 'Filled in' })
  return { status: 'applied' }
}

/** Asks, then records the switch. Navigating here would unmount the page before the result is sent. */
async function switchRole(role: string, reason: string, { actions, confirm, onSwitched }: ToolContext): Promise<ToolResult> {
  const next = agentRole(role)
  if (!next) return { status: 'error', message: `no role ${role || '(none)'}; roles: researcher, labeler, author` }
  if (!actions.switchRole || !onSwitched) return { status: 'error', message: 'this screen cannot change role; use the role menu' }
  if (next === (actions.role ?? 'researcher')) return { status: 'error', message: `already in the ${role} role` }
  const why = (reason ?? '').trim()
  const summary = why ? `Switch to the ${AGENT_ROLE_LABEL[role]} role. ${why}` : `Switch to the ${AGENT_ROLE_LABEL[role]} role.`
  if (!(await confirm({ summary, action: 'Switch' }))) return { status: 'cancelled' }
  // After Switch, the unsaved-work prompt can still refuse. The agent hears cancelled and stays.
  if (actions.confirmLeave && !actions.confirmLeave()) return { status: 'cancelled' }
  onSwitched(next)
  return { status: 'switched' }
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
