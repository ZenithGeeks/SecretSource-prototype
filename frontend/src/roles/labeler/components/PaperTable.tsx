/**
 * The papers the team added, one row each. Where there is room it is a table; in a narrow
 * space each row stacks into a card. A ready row opens with a click anywhere on it, or with Enter
 * on its title.
 */

import { m } from 'framer-motion'
import { Check, ChevronRight, CircleAlert, CircleCheck, EyeOff, Loader2, MoreVertical, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { MenuButton } from '../../../components/library'
import { Badge, Button, Progress } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { OFFLINE_REASON, useFeature } from '../../../lib/features'
import { problem, useAssignTopic, useRetryPaper, useUploadPaper } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { isFinished, opensLabels, type Paper } from '../paperFilters'
import { PaperKeywords } from './PaperKeywords'
import { UploadPdfButton } from './UploadPdfButton'
import { VenueRankBadge } from './VenueRankBadge'

const COLUMNS = ['Paper', 'Progress', 'Also labeled by']

// On narrow screens the header row is hidden, so each cell carries its own small label.
function CellLabel({ children }: { children: ReactNode }) {
  return <span className="text-ink-muted @4xl:hidden">{children}: </span>
}

function StatusBadge({ status }: { status: Paper['status'] }) {
  if (status === 'done')
    return (
      <Badge tone="supports">
        <CircleCheck aria-hidden="true" /> Ready
      </Badge>
    )
  if (status === 'running')
    return (
      <Badge>
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Reading…
      </Badge>
    )
  return (
    <Badge tone="refutes">
      <CircleAlert aria-hidden="true" /> Could not be read
    </Badge>
  )
}

/** The team's progress as the bar, the viewer's own count under it. A second person on the same
 * claim does not move the bar, but it is how agreement is measured, so "You" stays visible. */
function TeamProgress({ paper }: { paper: Paper }) {
  if (paper.status !== 'done') return <span className="text-ink-muted">Not ready</span>
  if (paper.claims === 0) return <span className="text-ink-muted">No claims</span>
  const teamDone = paper.team_judged >= paper.claims
  return (
    <span className="flex w-full max-w-60 flex-col gap-1.5">
      <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
        <CellLabel>Progress</CellLabel>
        {teamDone ? (
          <>
            <Check className="size-4 shrink-0 text-supports" aria-hidden="true" />
            <span className="font-medium text-supports">All {paper.claims} claims</span>
          </>
        ) : (
          `${paper.team_judged} of ${paper.claims} claims`
        )}
      </span>
      <Progress
        value={paper.team_judged}
        max={paper.claims}
        label={`Claims the team decided in ${paper.title}`}
        tone={teamDone ? 'supports' : 'accent'}
      />
      <span className="text-xs text-ink-muted tabular-nums">You: {isFinished(paper) ? 'all' : paper.judged}</span>
    </span>
  )
}

type RowProps = {
  paper: Paper
  me: string
  myTopic: string
  lead?: boolean
  /** The viewer's blind checks. Being a lead does not open their labels before the viewer finishes. */
  blind?: ReadonlySet<string>
  onOpen: (id: string) => void
  /** Opens the paper's labels (opensLabels); without it every paper opens the workspace. */
  onOpenLabels?: (id: string) => void
}

function PaperRow({ paper, me, myTopic, lead = false, blind, onOpen, onOpenLabels }: RowProps) {
  const assign = useAssignTopic()
  const retry = useRetryPaper()
  const upload = useUploadPaper()
  const online = useFeature('analyses')
  const [showKeywords, setShowKeywords] = useState(false)
  const ready = paper.status === 'done'
  const failed = paper.status === 'error'
  // Only the person who shared a paper can retry or remove it, so others are told who that is.
  const adder = paper.added_by || 'the person who added it'
  const others = paper.labelers.filter((name) => name !== me)
  const isBlind = blind?.has(paper.analysis_id) ?? false
  const viewLabels = Boolean(onOpenLabels) && opensLabels(paper, lead && !isBlind)
  const open = viewLabels && onOpenLabels ? onOpenLabels : onOpen
  const hasKeywords = Boolean(paper.subject || paper.keywords?.length)
  let action = 'Label'
  if (viewLabels) action = 'View labels'
  else if (isFinished(paper)) action = 'Review'
  else if (paper.judged > 0) action = 'Continue'
  const cell = '@4xl:table-cell @4xl:px-3 @4xl:py-2.5 @4xl:align-middle'

  return (
    // A row the list gains (a paper just added, one a filter brings back) fades in instead of
    // popping in. No exit fade: a removed row would stay readable until it ended.
    <m.tr
      data-ask-target={askTarget({ kind: 'paper', id: paper.analysis_id })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle px-4 py-3 text-sm last:border-b-0 @4xl:table-row @4xl:p-0',
        ready && 'transition-colors hover:bg-accent-soft/40 motion-reduce:transition-none',
      )}
    >
      <td className={cn(cell, 'w-full @4xl:w-auto @4xl:min-w-56 @4xl:pl-4')}>
        {ready ? (
          // The ::after layer stretches this button over the whole row, so a click anywhere opens it,
          // and it draws the focus ring around the row instead of the global one around the title.
          <button
            type="button"
            aria-label={`${paper.title} (${action})`}
            onClick={() => open(paper.analysis_id)}
            className="text-left font-medium text-ink focus-visible:outline-none! after:absolute after:inset-0 after:rounded-sm hover:text-accent focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
          >
            <span className="line-clamp-2 break-words">{paper.title}</span>
          </button>
        ) : (
          <span className="line-clamp-2 font-medium break-words text-ink">{paper.title}</span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Badge tone={paper.topic === myTopic ? 'accent' : 'neutral'} title={paper.topic === myTopic ? 'Your topic' : undefined}>
            {paper.topic}
            {paper.topic === myTopic && <span className="sr-only">, your topic</span>}
          </Badge>
          <StatusBadge status={paper.status} />
          {isBlind && (
            <Badge tone="accent">
              <EyeOff aria-hidden />
              Blind check
            </Badge>
          )}
          <VenueRankBadge value={paper.venue_rank} source={paper.venue_rank_source} />
          {hasKeywords && (
            <button
              type="button"
              aria-expanded={showKeywords}
              onClick={() => setShowKeywords((open) => !open)}
              className="relative z-10 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              {showKeywords ? 'Hide keywords' : 'Keywords'}
            </button>
          )}
        </div>
        {showKeywords && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <PaperKeywords subject={paper.subject} keywords={paper.keywords} />
          </div>
        )}
        {failed && (
          <span role="alert" className="mt-1 block text-refutes">
            Could not be read: {paper.reason || 'no open PDF was found'}.{' '}
            {paper.mine ? 'Try again, upload its PDF, or remove it.' : `Only ${adder} can try again, upload its PDF or remove it.`}
            {retry.isError && ` Trying again failed: ${problem(retry.error).title}.`}
            {upload.isError && ` The PDF was not added: ${problem(upload.error).title}.`}
            {paper.mine && !online && ` ${OFFLINE_REASON.analyses}`}
          </span>
        )}
      </td>
      <td className={cn(cell, 'w-full @4xl:w-40')}>
        <TeamProgress paper={paper} />
      </td>
      <td className={cell}>
        <CellLabel>Also labeled by</CellLabel>
        {/* Who labeled a paper is a hint on a blind check (#867). */}
        {isBlind && !isFinished(paper) ? (
          <span className="text-ink-muted">Hidden until you finish</span>
        ) : others.length > 0 ? (
          others.join(', ')
        ) : (
          <span className="text-ink-muted">No one</span>
        )}
      </td>
      <td className={cn(cell, 'flex w-full items-center justify-end gap-1 @4xl:w-auto @4xl:whitespace-nowrap')}>
        {ready && (
          // Looks like a button; the stretched title button above does the opening.
          <span aria-hidden="true" className="inline-flex min-h-11 items-center gap-1 px-2 font-medium text-accent">
            {action}
            <ChevronRight className="size-4" />
          </span>
        )}
        {paper.mine && failed && (
          <Button
            variant="ghost"
            className="relative z-10 min-h-11 px-3"
            aria-label={`${retry.isPending ? 'Starting' : 'Try again'} ${paper.title}`}
            // Trying again while its PDF is uploading would list the paper twice.
            disabled={!online || retry.isPending || upload.isPending}
            onClick={() => retry.mutate(paper.analysis_id)}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {retry.isPending ? 'Starting…' : 'Try again'}
          </Button>
        )}
        {paper.mine && failed && (
          <UploadPdfButton
            title={paper.title}
            busy={upload.isPending}
            disabled={!online || retry.isPending}
            // The gateway takes the topic and DOI from the row it replaces.
            onFile={(file) => upload.mutate({ file, topic: '', replaces: paper.analysis_id })}
          />
        )}
        {paper.mine && (
          <MenuButton
            label={`More actions for ${paper.title}`}
            className="relative z-10"
            trigger={(triggerProps) => (
              <button
                type="button"
                aria-label={`More actions for ${paper.title}`}
                disabled={assign.isPending || retry.isPending || upload.isPending}
                className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                {...triggerProps}
              >
                <MoreVertical className="size-4" aria-hidden="true" />
              </button>
            )}
            items={[
              {
                key: 'remove',
                className: 'text-refutes hover:bg-refutes-soft',
                content: (
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Remove
                  </span>
                ),
                onSelect: () => {
                  if (!window.confirm("Remove this paper from the team's list? Labels already saved are kept.")) return
                  assign.mutate({ analysisId: paper.analysis_id, topic: '' })
                },
              },
            ]}
          />
        )}
      </td>
    </m.tr>
  )
}

export function PaperTable({ papers, ...row }: Omit<RowProps, 'paper'> & { papers: Paper[] }) {
  return (
    <div className="@container overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="block w-full border-collapse text-left @4xl:table">
        <thead className="sr-only @4xl:not-sr-only @4xl:table-header-group">
          <tr className="border-b border-border-subtle text-xs text-ink-muted">
            {COLUMNS.map((name) => (
              <th key={name} scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap first:pl-4">
                {name}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="block @4xl:table-row-group">
          {papers.map((paper) => (
            <PaperRow key={paper.analysis_id} paper={paper} {...row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
