/**
 * The Ask panel (Figma: Redesign 2026, R/16–R/18, R/11 Mobile, components A/Stamp, A/Statement,
 * A/Why). The reader asks about what is on screen; the answer streams in as statements, each
 * with its source and a stamp that turns from Checking… into the judge's verdict. A drawer on
 * desktop, a full-screen sheet on a phone. The chat itself lives in useAssistant, so the panel
 * can unmount on a screen change without losing it.
 */

import { ArrowUp, ChevronLeft, ChevronRight, Clock, FileText, Library as LibraryIcon, Plus, SearchX, Sparkles, Square, X, CircleAlert } from 'lucide-react'
import { MotionConfig } from 'framer-motion'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import type { Assistant, AskContext, ChatSummary, Statement, StatementVerdict, Turn } from '../lib/assistant'
import { listChats, sourceLabel, sourceTarget, whenLabel } from '../lib/assistant'
import { loadAskMode, saveAskMode, useAskUserId, type AskPanelMode } from '../lib/askSession'
import type { Role } from '../lib/roles'
import { STAMPS } from '../lib/stamps'
import { OFFLINE_REASON, useFeature } from '../lib/features'
import { cn } from '../lib/utils'
import { askTarget, type Pointing } from '../lib/askCursor'
import { parseCommand, type PaperRef } from '../lib/askCommands'
import { AiCursor } from './AiCursor'
import { AnswerActions } from './AnswerActions'
import { AskInput } from './AskInput'
import { AskWelcome } from './AskWelcome'
import { CommandResult } from './CommandResult'
import { Mascot } from './Mascot'
import type { Target } from './PageViewer'
import { Stamp } from './Stamp'
import { ThinkingState } from './ThinkingState'
import { IconButton, Segmented } from './ui'

/** What the chip says the question is about. `library` cannot be removed: it is the default. */
export type AskAbout = { kind: 'paper' | 'node' | 'library'; label: string }

function ComposerChip({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 rounded-full border border-border-subtle px-2.5 text-xs text-ink-muted hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 lg:min-h-7"
    >
      {label}
    </button>
  )
}

const NOTE = 'Each statement is checked against the passage it cites. A statement no passage backs is marked, not hidden.'

/** "3 of 4 backed · 1 contradicted" once every check is in, "Checking 1 of 3" until then. */
function answerSummary(turn: Turn) {
  const checked = turn.statements.filter((s) => s.verdict).length
  if (checked < turn.statements.length) return `Checking ${checked + 1} of ${turn.statements.length}`
  const backed = turn.statements.filter((s) => s.verdict === 'supports').length
  const contradicted = turn.statements.filter((s) => s.verdict === 'refutes').length
  const parts = [`${backed} of ${turn.statements.length} backed`]
  if (contradicted) parts.push(`${contradicted} contradicted`)
  return parts.join(' · ')
}

/** The answer as plain text for Copy: one line per statement, with its source and stamp. */
function answerText(turn: Turn, titles: Record<string, string>) {
  const lines = turn.statements.map((statement) => {
    const source = statement.source ? ` (${sourceLabel(statement, titles[statement.source])})` : ''
    return `- ${statement.text}${source} [${STAMPS[statement.verdict ?? 'unchecked'].label}]`
  })
  return [turn.question, '', ...lines].join('\n')
}

/** The judge's passage and reasoning behind a stamp (A/Why). */
function Why({ statement, title, onShowSource }: { statement: Statement; title?: string; onShowSource: (target: Target) => void }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-neutral-soft p-3">
      <p className="type-label text-ink-muted">What the passage says{statement.page ? ` · page ${statement.page}` : ''}</p>
      {statement.quote && <p className="font-serif text-[15px] leading-6 italic text-ink">“{statement.quote}”</p>}
      {statement.reasoning && <p className="text-xs leading-5 text-ink-muted">{statement.reasoning}</p>}
      <button
        type="button"
        onClick={() => onShowSource(sourceTarget(statement, title))}
        className="self-start text-xs font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Open passage
      </button>
    </div>
  )
}

/** One checked statement (A/Statement): the sentence, its source, and its stamp. */
function StatementRow({
  statement,
  target,
  title,
  answering,
  onShowSource,
}: {
  statement: Statement
  /** Its id for the AI cursor (`statement:<id>`), which points here when its check comes in. */
  target: string
  title?: string
  /** Whether the answer is still coming. A statement left without a verdict by a Stop or a
   * failure could not be checked, so it stops saying Checking…. */
  answering: boolean
  onShowSource: (target: Target) => void
}) {
  const [open, setOpen] = useState(false)
  const previewId = useId()
  const verdict = statement.verdict ?? (answering ? 'checking' : 'unchecked')
  const stamp = STAMPS[verdict]
  const explained = Boolean(statement.verdict && (statement.quote || statement.reasoning))
  return (
    <li data-ask-target={askTarget({ kind: 'statement', id: target })} className={cn('border-l-2 pl-3', stamp.bar)}>
      <p className="text-[13px] leading-5 text-ink">{statement.text}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        {statement.source ? (
          // Hover or focus shows the quoted passage once the judge has read it.
          <span className="group/source relative flex min-w-0">
            <button
              type="button"
              onClick={() => onShowSource(sourceTarget(statement, title))}
              aria-describedby={statement.quote ? previewId : undefined}
              className="min-h-11 truncate text-left text-xs text-ink-muted underline hover:text-ink focus-visible:outline-2 focus-visible:outline-accent lg:min-h-6"
            >
              {sourceLabel(statement, title)}
            </button>
            {statement.quote && (
              <span
                id={previewId}
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-64 rounded-xl border border-border-subtle bg-surface p-3 shadow-lg group-focus-within/source:block group-hover/source:block"
              >
                <span className="type-label block text-ink-muted">
                  {sourceLabel(statement, title)}
                  {statement.page ? ` · page ${statement.page}` : ''}
                </span>
                <span className="mt-1 line-clamp-4 block font-serif text-[13px] leading-5 italic text-ink">“{statement.quote}”</span>
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">No passage named</span>
        )}
        {explained ? (
          // The button is the 44px (phone) or 24px (desktop) hit area; the pill inside stays small.
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${stamp.label}: why`}
            className="flex min-h-11 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-accent lg:min-h-6"
          >
            <Stamp verdict={verdict} />
          </button>
        ) : (
          <Stamp verdict={verdict} />
        )}
      </div>
      {open && <Why statement={statement} title={title} onShowSource={onShowSource} />}
    </li>
  )
}

/** A question and what came back for it: the statements, or why there are none. */
function TurnView({
  turn,
  about,
  titles,
  onAskAgain,
  onRegenerate,
  onShowSource,
}: {
  turn: Turn
  about: AskAbout
  titles: Record<string, string>
  /** Replaces a failed turn with a new try. */
  onAskAgain?: () => void
  /** Asks a finished turn's question again, as a new turn. Only the last turn gets it. */
  onRegenerate?: () => void
  onShowSource: (target: Target) => void
}) {
  const unanswered = turn.status === 'done' && turn.statements.length === 0 && !turn.note && !turn.view
  return (
    <div className="flex flex-col gap-3">
      <p data-ask-target={askTarget({ kind: 'question', id: String(turn.id) })} className="ml-8 self-end rounded-xl bg-neutral-soft px-3 py-2 text-[13px] leading-5 text-ink">
        {turn.question}
      </p>
      {turn.statements.length > 0 && (
        <section aria-label="Answer" className="group flex flex-col gap-2.5">
          {/* The one line a screen reader hears change while the checks come in. */}
          <p role="status" className="type-label flex items-center gap-1.5 text-ink-muted">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Answer · {answerSummary(turn)}
          </p>
          <ul className="flex flex-col gap-3">
            {turn.statements.map((statement) => (
              <StatementRow
                key={statement.index}
                statement={statement}
                target={`${turn.id}-${statement.index}`}
                title={titles[statement.source]}
                answering={turn.status === 'answering'}
                onShowSource={onShowSource}
              />
            ))}
          </ul>
          {turn.status === 'done' && <AnswerActions text={answerText(turn, titles)} onAskAgain={onRegenerate} />}
        </section>
      )}
      {turn.view && <CommandResult view={turn.view} command={turn.command ?? 'command'} />}
      {turn.note && <p className="text-xs leading-5 text-ink-muted">{turn.note}</p>}
      {turn.status === 'answering' && turn.statements.length === 0 && <ThinkingState label="Reading your papers…" />}
      {unanswered && (
        <div className="flex gap-2.5 rounded-xl bg-neutral-soft p-3">
          <SearchX className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="text-[13px] leading-5">
            <p className="font-medium text-ink">
              {about.kind === 'library' ? 'No paper in your library answers this.' : 'This paper does not answer this.'}
            </p>
            <p className="text-ink-muted">
              Nothing was written, so nothing is unchecked.{' '}
              {about.kind === 'library' ? 'Add the paper to your library, or ask about one you have.' : 'Remove the chip to ask your whole library.'}
            </p>
          </div>
        </div>
      )}
      {turn.status === 'failed' && (
        <div className="flex gap-2.5 rounded-xl border border-border-subtle bg-neutral-soft p-3">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="flex flex-col items-start gap-2 text-[13px] leading-5 text-ink">
            <p>The answer failed. Your question is kept in this chat.</p>
            {onAskAgain && (
              <button
                type="button"
                onClick={onAskAgain}
                className="min-h-11 rounded-lg border border-border-subtle bg-surface px-3 text-[13px] font-medium hover:bg-accent-soft lg:min-h-8"
              >
                Ask again
              </button>
            )}
          </div>
        </div>
      )}
      {turn.status === 'stopped' && <p className="text-xs text-ink-muted">Stopped. What arrived is kept.</p>}
    </div>
  )
}

/** The reader's earlier chats, newest first (R/18b). */
function ChatList({ onPick, onBack, onNew }: { onPick: (id: string) => void; onBack: () => void; onNew: () => void }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    listChats().then(setChats, () => setFailed(true))
  }, [])
  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <IconButton onClick={onBack} aria-label="Back to the chat" className="lg:size-7">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <h2 className="flex-1 text-[15px] font-semibold text-ink">Your chats</h2>
        <IconButton onClick={onNew} aria-label="New chat" className="lg:size-7">
          <Plus className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto px-5">
        {failed && <p className="py-3 text-[13px] text-ink-muted">Your chats could not be loaded.</p>}
        {chats?.length === 0 && <p className="py-3 text-[13px] text-ink-muted">No chats yet.</p>}
        <ul className="divide-y divide-border-subtle">
          {chats?.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => onPick(chat.id)}
                className="flex w-full items-center gap-2 py-3 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] leading-5 text-ink">{chat.title || 'Untitled chat'}</span>
                  <span className="text-xs text-ink-muted">{whenLabel(chat.updated)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/** Below lg the panel covers the whole screen. */
const PHONE = '(max-width: 1023px)'
const isPhone = () => window.matchMedia?.(PHONE).matches ?? false

/** Moves focus into the panel when a reader opens it and back to what opened it when it closes.
 * On a phone, where the panel covers the screen, it is announced as a modal dialog. */
function usePanelFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const panel = root.current
    if (!panel) return
    const active = document.activeElement
    // A panel restored open on page load leaves focus where it is; only a click or key opened it.
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    if (opener) panel.querySelector<HTMLElement>('input, textarea, button')?.focus()
    if (isPhone()) {
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
    }
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [root])
}

/** On a phone, Tab past the last control comes back to the first, so focus stays on the panel
 * that covers the screen. Dialogs it opens (a source, Connect agent) sit outside it and trap
 * their own focus. */
function keepTabInside(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab' || !isPhone()) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, a[href], [tabindex="0"]')]
    .filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

export function AssistantPanel({
  role,
  assistant,
  context,
  about,
  titles = {},
  papers = [],
  canNarrow = true,
  onClearAbout,
  onClose,
  onShowSource,
  doIt,
  extra,
  initialMode,
  className,
}: {
  /** Whose Quip (components/Mascot) the header and the empty chat show. */
  role: Role
  assistant: Assistant
  context: AskContext
  about: AskAbout
  /** Paper titles by PDF file name, so a source reads as its title. */
  titles?: Record<string, string>
  /** The reader's papers, which @ lists and a /command can name. */
  papers?: PaperRef[]
  /** Whether the role has a paper or graph node to open, so the empty panel says how to narrow a question. */
  canNarrow?: boolean
  /** Removes the chip, so the next question asks the whole library. */
  onClearAbout: () => void
  onClose: () => void
  onShowSource: (target: Target) => void
  /** The Do it view (components/DoIt) for a role whose screens the agent can work; none hides the switch. */
  doIt?: ReactNode
  /** A mode a screen adds for what it shows, such as the Labeler's "This claim"; gone when the screen is left. */
  extra?: { label: string; content: ReactNode }
  /** Which mode to open on. A role switch lands on Do it so the conversation is still there. */
  initialMode?: 'answer' | 'extra' | 'do'
  className?: string
}) {
  const userId = useAskUserId()
  const [view, setView] = useState<'chat' | 'chats'>('chat')
  // Answer, Do it, or the screen's own mode, as last chosen by this user, unless a role switch
  // carried a Do it conversation here (initialMode). A mode whose view went away (the screen that
  // added it was left) falls back to Answer without forgetting it. A later screen that adds or
  // removes its own mode does not rewrite a mode they already chose.
  const [chosen, setChosen] = useState<AskPanelMode>(() => initialMode ?? loadAskMode(userId) ?? (extra ? 'extra' : 'answer'))
  const [modeFor, setModeFor] = useState(userId)
  if (modeFor !== userId) {
    setModeFor(userId)
    setChosen(loadAskMode(userId) ?? (extra ? 'extra' : 'answer'))
  }
  const mode = (chosen === 'extra' && !extra) || (chosen === 'do' && !doIt) ? 'answer' : chosen
  function chooseMode(next: AskPanelMode) {
    setChosen(next)
    saveAskMode(userId, next)
  }
  const end = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const root = useRef<HTMLElement>(null)
  usePanelFocus(root)
  const { turns, answering, draft, setDraft } = assistant
  const last = turns.at(-1)
  const askOnline = useFeature('ask')
  // A /command does not ask the model, so it still runs while Ask is offline.
  const canSend = draft.trim() !== '' && (askOnline || draft.trim().startsWith('/'))

  // The cursor rests a moment on the last check once an answer ends, then leaves.
  const [rested, setRested] = useState<number | null>(null)
  const lastId = last?.id
  const lastStatus = last?.status
  useEffect(() => {
    if (lastId === undefined || lastStatus === 'answering') return
    const timer = window.setTimeout(() => setRested(lastId), CURSOR_REST_MS)
    return () => window.clearTimeout(timer)
  }, [lastStatus, lastId])
  const pointing = view === 'chat' && mode === 'answer' && last && last.id !== rested ? cursorFor(last) : null

  // Follow a new question and new statements; a verdict landing does not move the reader.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [turns.length, last?.statements.length])

  const send = () => {
    const question = draft.trim()
    if (!canSend || answering) return
    setDraft('')
    if (!question.startsWith('/')) {
      void assistant.ask(question, context)
      return
    }
    const parsed = parseCommand(question, papers, context.analysis)
    if ('error' in parsed) assistant.refuse(question, parsed.error)
    else void assistant.run(question, parsed)
  }

  /** Types `@` after the draft, or `/` into an empty one, and puts the cursor back in the field. */
  const insert = (sign: '@' | '/') => {
    setDraft(sign === '/' ? '/' : `${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@`)
    composer.current?.querySelector('input')?.focus()
  }

  const newChat = () => {
    assistant.newChat()
    setView('chat')
  }

  return (
    <aside
      ref={root}
      aria-label="Ask"
      // Escape closes the panel, unless a menu inside it (the @ and / list) used the key first.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
        keepTabInside(event)
      }}
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-surface lg:static lg:z-auto lg:h-full lg:border-l lg:border-border-subtle',
        className,
      )}
    >
      {view === 'chats' ? (
        <ChatList
          onBack={() => setView('chat')}
          onNew={newChat}
          onPick={(id) => {
            setView('chat')
            void assistant.openChat(id)
          }}
        />
      ) : (
        <>
          <div className="flex items-center gap-2 px-5 pt-4 pb-3">
            {/* On a phone the panel covers the screen, so Back is how the reader returns to it. */}
            <IconButton onClick={onClose} aria-label="Back to the screen" className="lg:hidden">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </IconButton>
            <h2 className="flex flex-1 items-center gap-1.5 text-[15px] font-semibold text-ink">
              <Mascot role={role} size={24} />
              Ask
            </h2>
            <IconButton onClick={() => setView('chats')} aria-label="Your chats" className="lg:size-7">
              <Clock className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton onClick={newChat} aria-label="New chat" className="lg:size-7">
              <Plus className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton onClick={onClose} aria-label="Close Ask" className="hidden lg:flex lg:size-7">
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </div>

          {(doIt || extra) && (
            <Segmented
              label="What Ask does"
              options={[
                { value: 'answer' as const, label: 'Answer' },
                ...(extra ? [{ value: 'extra' as const, label: extra.label }] : []),
                ...(doIt ? [{ value: 'do' as const, label: 'Do it' }] : []),
              ]}
              value={mode}
              onChange={chooseMode}
              className="mx-5 mb-3"
            />
          )}
          {mode === 'do' ? (
            doIt
          ) : mode === 'extra' ? (
            <div className="flex-1 overflow-y-auto px-5 pb-4">{extra?.content}</div>
          ) : (
            <>
              <div className="mx-5 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent">
                {about.kind === 'library' ? (
                  <LibraryIcon className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">About: {about.label}</span>
                {about.kind !== 'library' && (
                  <button
                    type="button"
                    onClick={onClearAbout}
                    aria-label="Ask about your whole library instead"
                    className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent/10 lg:size-6"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-6 overflow-y-auto dot-grid px-5 py-4">
                {assistant.opening && turns.length === 0 && (
                  <p role="status" className="text-[13px] text-ink-muted">
                    Opening this chat…
                  </p>
                )}
                {assistant.openFailed && <p className="text-[13px] text-ink-muted">This chat could not be opened.</p>}
                {turns.length === 0 && !assistant.opening && !assistant.openFailed && (
                  <MotionConfig reducedMotion="user">
                    <AskWelcome
                      role={role}
                      about={about}
                      canNarrow={canNarrow}
                      onAsk={(question) => {
                        if (!answering && askOnline) void assistant.ask(question, context)
                      }}
                    />
                  </MotionConfig>
                )}
                {turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    about={about}
                    titles={titles}
                    onShowSource={onShowSource}
                    onAskAgain={turn === last && !answering && askOnline ? () => void assistant.ask(turn.question, context, true) : undefined}
                    onRegenerate={turn === last && !answering && askOnline ? () => void assistant.ask(turn.question, context) : undefined}
                  />
                ))}
                <div ref={end} />
              </div>

              <div className="px-5 pb-4">
                <form
                  ref={composer}
                  onSubmit={(event) => {
                    event.preventDefault()
                    send()
                  }}
                  className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface px-3 pt-1.5 pb-2 shadow-sm transition-shadow focus-within:border-accent focus-within:shadow-md"
                >
                  <AskInput
                    draft={draft}
                    onChange={setDraft}
                    papers={papers}
                    disabled={answering}
                    placeholder={
                      answering
                        ? 'Answering… Stop keeps what’s here'
                        : about.kind === 'library'
                          ? 'Ask about your library, / for commands, @ for a paper…'
                          : about.kind === 'paper'
                            ? 'Ask about this paper, / for commands…'
                            : 'Ask about this node, / for commands…'
                    }
                  />
                  <div className="flex items-center gap-1.5">
                    {/* Shortcuts into the field's own @ and / menus. */}
                    <ComposerChip label="@ Paper" disabled={answering} onClick={() => insert('@')} />
                    {/* A command must start the question, so this one waits for an empty field. */}
                    <ComposerChip label="/ Commands" disabled={answering || draft !== ''} onClick={() => insert('/')} />
                    {answering ? (
                      <button
                        type="button"
                        onClick={assistant.stop}
                        className="ml-auto flex min-h-11 items-center gap-1.5 rounded-full border border-accent px-3 text-[13px] font-medium text-accent hover:bg-accent-soft lg:min-h-8"
                      >
                        <Square className="size-3 fill-current" aria-hidden="true" />
                        Stop
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!canSend}
                        aria-label="Send"
                        className="ml-auto flex size-11 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent/70 text-white shadow-md disabled:opacity-40 lg:size-8"
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </form>
                {askOnline ? (
                  <p className="mt-2 text-xs text-ink-muted">{NOTE}</p>
                ) : (
                  <p role="status" className="mt-2 text-xs text-refutes">
                    {OFFLINE_REASON.ask}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
      <MotionConfig reducedMotion="user">
        <AiCursor pointing={pointing} scroll={false} />
      </MotionConfig>
    </aside>
  )
}

const CURSOR_REST_MS = 2500
/** The cursor's reaction to each verdict. */
const VERDICT_TONE: Record<StatementVerdict, Pointing['tone']> = {
  supports: 'agrees',
  refutes: 'flags',
  insufficient: 'asks',
  unchecked: 'asks',
  error: 'asks',
}

/** Where the AI cursor is during an answer: on the question while it reads, then on each
 * statement as its check comes in, with a reaction to the verdict. */
function cursorFor(turn: Turn): Pointing | null {
  const checked = turn.statements.find((s) => s.index === turn.lastChecked)
  if (checked?.verdict) return { target: { kind: 'statement', id: `${turn.id}-${checked.index}` }, tone: VERDICT_TONE[checked.verdict] }
  if (turn.status !== 'answering') return null
  const first = turn.statements[0]
  return first
    ? { target: { kind: 'statement', id: `${turn.id}-${first.index}` }, tone: 'reading' }
    : { target: { kind: 'question', id: String(turn.id) }, tone: 'reading' }
}
