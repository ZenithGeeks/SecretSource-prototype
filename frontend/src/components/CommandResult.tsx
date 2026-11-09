/**
 * What a /command answers in the Ask panel (lib/askCommands): claims with their standing, the
 * evidence behind one claim, the gaps in the library, and the smaller answers. Each standing and
 * verdict is a badge with an icon and words, so colour is never the only cue.
 */

import { Check, CircleAlert, CircleHelp, Copy, FileSearch, Rocket, X } from 'lucide-react'
import { Fragment, useState, type ComponentType } from 'react'

import type { ClaimRow, CommandView, Standing } from '../lib/askCommands'
import type { StatementVerdict } from '../lib/assistant'
import { cn } from '../lib/utils'
import { Badge, Progress } from './ui'

type Look = { label: string; tone: 'supports' | 'insufficient' | 'refutes' | 'neutral'; icon: ComponentType<{ className?: string }>; edge: string }

// The same words and tones as the labeler's stamps, so a claim reads the same everywhere.
const STANDING: Record<Standing, Look> = {
  backed: { label: 'Backed', tone: 'supports', icon: Check, edge: 'border-l-supports' },
  silent: { label: 'Not backed', tone: 'insufficient', icon: CircleAlert, edge: 'border-l-insufficient' },
  contradicted: { label: 'Contradicted', tone: 'refutes', icon: X, edge: 'border-l-refutes' },
  unchecked: { label: "Can't check", tone: 'neutral', icon: CircleHelp, edge: 'border-l-border-subtle' },
}

const VERDICT_STANDING: Record<StatementVerdict, Standing> = {
  supports: 'backed',
  insufficient: 'silent',
  refutes: 'contradicted',
  unchecked: 'unchecked',
  error: 'unchecked',
}

function StandingBadge({ standing }: { standing: Standing }) {
  const look = STANDING[standing]
  return (
    <Badge tone={look.tone}>
      <look.icon aria-hidden="true" />
      {look.label}
    </Badge>
  )
}

export function CommandResult({ view, command }: { view: CommandView; command: string }) {
  return (
    <section aria-label={`Result of ${command}`} className="flex flex-col gap-3">
      <Body view={view} />
    </section>
  )
}

function Body({ view }: { view: CommandView }) {
  switch (view.kind) {
    case 'claims':
      return <Claims view={view} />
    case 'claim':
      return <ClaimEvidence view={view} />
    case 'gaps':
      return <Gaps view={view} />
    case 'progress':
      return <LabelProgress view={view} />
    case 'code':
      return <Code text={view.text} />
    case 'page':
      return (
        <Callout icon={FileSearch} tone={view.page ? 'supports' : 'neutral'}>
          {view.page ? `Found on page ${view.page}.` : 'That text is not in this paper.'}
        </Callout>
      )
    case 'started':
      return (
        <Callout icon={Rocket} tone="accent">
          {`Started analysis ${view.id}. It runs in the background: see Analyses.`}
        </Callout>
      )
    case 'message':
      return <Callout icon={CircleAlert}>{view.text}</Callout>
  }
}

const CALLOUT_ICON = { neutral: 'text-ink-muted', supports: 'text-supports', accent: 'text-accent' }

function Callout({ icon: Icon, tone = 'neutral', children }: { icon: ComponentType<{ className?: string }>; tone?: keyof typeof CALLOUT_ICON; children: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-neutral-soft p-3 text-[13px] leading-5 text-ink">
      <Icon className={cn('mt-0.5 size-4 shrink-0', CALLOUT_ICON[tone])} aria-hidden="true" />
      <p className="min-w-0 [overflow-wrap:anywhere]">{children}</p>
    </div>
  )
}

/** The words a search found, marked in the claim. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return (
    <>
      {text.split(pattern).map((part, index) =>
        // split keeps the matches at the odd positions
        index % 2 ? (
          <mark key={index} className="rounded bg-accent-soft px-0.5 font-medium text-ink">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Claims({ view }: { view: Extract<CommandView, { kind: 'claims' }> }) {
  const tally = (Object.keys(STANDING) as Standing[]).filter((standing) => view.tally?.[standing])
  return (
    <>
      {view.title && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium leading-5 text-ink [overflow-wrap:anywhere]">{view.title}</p>
          {view.status && view.status !== 'done' && <p className="text-xs text-ink-muted">Analysis {view.status}{view.message ? `: ${view.message}` : ''}</p>}
          {tally.length > 0 && (
            <ul aria-label="Claims by standing" className="flex flex-wrap gap-1.5">
              {tally.map((standing) => {
                const look = STANDING[standing]
                return (
                  <li key={standing}>
                    <Badge tone={look.tone}>
                      <look.icon aria-hidden="true" />
                      <span className="tabular-nums">{view.tally![standing]}</span> {look.label}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      <ol className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle">
        {view.claims.map((claim) => (
          <ClaimItem key={`${claim.paper}-${claim.number}`} claim={claim} words={view.highlight ?? []} />
        ))}
      </ol>
    </>
  )
}

function ClaimItem({ claim, words }: { claim: ClaimRow; words: string[] }) {
  return (
    <li className={cn('flex gap-2.5 border-l-[3px] px-3 py-2.5 first:rounded-tl-xl last:rounded-bl-xl', STANDING[claim.standing].edge)}>
      <span className="mt-0.5 flex h-5 min-w-6 shrink-0 items-center justify-center rounded-md bg-border-subtle px-1 text-[11px] font-semibold text-ink-muted tabular-nums">
        {claim.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {claim.paper && <p className="text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">{claim.paper}</p>}
        <p className="text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">
          <Marked text={claim.claim} words={words} />
        </p>
        <StandingBadge standing={claim.standing} />
      </div>
    </li>
  )
}

function ClaimEvidence({ view }: { view: Extract<CommandView, { kind: 'claim' }> }) {
  return (
    <>
      <div className={cn('flex flex-col gap-2 rounded-xl border border-border-subtle border-l-[3px] p-3', STANDING[view.standing].edge)}>
        <div className="flex items-center gap-2">
          <span className="flex h-5 min-w-6 items-center justify-center rounded-md bg-border-subtle px-1 text-[11px] font-semibold text-ink-muted tabular-nums">{view.number}</span>
          <StandingBadge standing={view.standing} />
        </div>
        <p className="text-[13px] leading-5 font-medium text-ink [overflow-wrap:anywhere]">{view.claim}</p>
        {view.sentence && <p className="border-l-2 border-border-subtle pl-3 text-xs leading-5 text-ink-muted italic [overflow-wrap:anywhere]">{view.sentence}</p>}
      </div>
      {view.verdicts.length > 0 && <p className="type-label text-ink-muted">What the cited papers say</p>}
      <ul className="flex flex-col gap-2">
        {view.verdicts.map((verdict, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-xl border border-border-subtle p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-medium text-ink [overflow-wrap:anywhere]">{verdict.cited}</p>
              <StandingBadge standing={VERDICT_STANDING[verdict.verdict]} />
            </div>
            {verdict.quote && <blockquote className="border-l-2 border-accent pl-3 font-serif text-sm leading-5 text-ink italic [overflow-wrap:anywhere]">“{verdict.quote}”</blockquote>}
            {verdict.reasoning && <p className="text-xs leading-5 text-ink-muted [overflow-wrap:anywhere]">{verdict.reasoning}</p>}
          </li>
        ))}
        {view.unchecked.map((entry, index) => (
          <li key={`u${index}`} className="flex flex-col gap-1.5 rounded-xl border border-dashed border-border-subtle p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-medium text-ink [overflow-wrap:anywhere]">{entry.source}</p>
              <StandingBadge standing="unchecked" />
            </div>
            <p className="text-xs leading-5 text-ink-muted">{entry.reason}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function Gaps({ view }: { view: Extract<CommandView, { kind: 'gaps' }> }) {
  const tiles = [
    { label: 'Not backed', hint: 'no cited work backs them', value: view.notBacked, look: STANDING.silent, text: 'text-insufficient' },
    { label: 'Contradicted', hint: 'a cited work disagrees', value: view.contradicted, look: STANDING.contradicted, text: 'text-refutes' },
    { label: 'Not held', hint: 'cited, not in your library', value: view.missing, look: STANDING.unchecked, text: 'text-ink' },
  ]
  return (
    <ul className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <li key={tile.label} className="flex flex-col gap-1 rounded-xl border border-border-subtle p-3">
          <tile.look.icon className={cn('size-4', tile.text)} aria-hidden="true" />
          <p className={cn('text-xl leading-6 font-semibold tabular-nums', tile.text)}>{tile.value}</p>
          <p className="text-xs leading-4 font-medium text-ink">{tile.label}</p>
          <p className="text-[11px] leading-4 text-ink-muted">{tile.hint}</p>
        </li>
      ))}
    </ul>
  )
}

function LabelProgress({ view }: { view: Extract<CommandView, { kind: 'progress' }> }) {
  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-border-subtle p-3">
        <p className="text-[13px] font-medium text-ink">
          <span className="tabular-nums">{view.saved}</span> of <span className="tabular-nums">{view.claims}</span> claims saved
        </p>
        <Progress value={view.saved} max={view.claims} label="Claims saved" tone="supports" />
        <p className="text-xs text-ink-muted">
          <span className="tabular-nums">{view.reviewed}</span> reviewed by the AI
        </p>
      </div>
      {view.next ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-accent bg-accent-soft p-3">
          <p className="type-label text-ink-muted">Next to label</p>
          <p className="text-[13px] leading-5 text-ink [overflow-wrap:anywhere]">
            <span className="mr-1.5 inline-flex h-5 min-w-6 items-center justify-center rounded-md bg-border-subtle px-1 text-[11px] font-semibold text-ink-muted tabular-nums">{view.next.number}</span>
            {view.next.claim}
          </p>
        </div>
      ) : (
        <Callout icon={Check} tone="supports">
          Every claim is saved.
        </Callout>
      )}
    </>
  )
}

function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="rounded-xl border border-border-subtle bg-surface p-3 pt-11 font-mono text-xs leading-5 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{text}</pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
        className="absolute top-2 right-2 flex min-h-8 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 text-xs text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
