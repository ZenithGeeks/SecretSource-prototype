/**
 * The papers the team added, one row each. Where there is room it is a table; in a narrow
 * space each row stacks into a card. A ready row opens with a click anywhere on it, or with Enter
 * on its title.
 */

import { motion } from 'framer-motion'
import { Check, ChevronRight, CircleAlert, CircleCheck, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge, Button, Progress } from '../../../components/ui'
import { problem, useAssignTopic, useRetryPaper, useUploadPaper } from '../../../lib/labeling'
import { cn } from '../../../lib/utils'
import { addedByOf, isFinished, type Paper } from '../paperFilters'
import { PaperKeywords } from './PaperKeywords'
import { UploadPdfButton } from './UploadPdfButton'

const COLUMNS = ['Paper', 'Topic', 'Status', 'Progress', 'Also labeled by', 'Added by']

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

function PaperRow({ paper, me, myTopic, onOpen }: { paper: Paper; me: string; myTopic: string; onOpen: (id: string) => void }) {
  const assign = useAssignTopic()
  const retry = useRetryPaper()
  const upload = useUploadPaper()
  const ready = paper.status === 'done'
  const failed = paper.status === 'error'
  const addedBy = addedByOf(paper, me)
  // Only the person who shared a paper can retry or remove it, so others are told who that is.
  const adder = paper.added_by || 'the person who added it'
  const others = paper.labelers.filter((name) => name !== me)
  const action = isFinished(paper) ? 'Review' : paper.judged > 0 ? 'Continue' : 'Label'
  const cell = '@4xl:table-cell @4xl:px-3 @4xl:py-3 @4xl:align-middle'

  return (
    // A row the list gains (a paper just added, one a filter brings back) fades in instead of
    // popping in. No exit fade: a removed row would stay readable until it ended.
    <motion.tr
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
            onClick={() => onOpen(paper.analysis_id)}
            className="text-left font-medium text-ink focus-visible:outline-none! after:absolute after:inset-0 after:rounded-sm hover:text-accent focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
          >
            <span className="line-clamp-2 break-words">{paper.title}</span>
          </button>
        ) : (
          <span className="line-clamp-2 font-medium break-words text-ink">{paper.title}</span>
        )}
        <PaperKeywords subject={paper.subject} keywords={paper.keywords} className="mt-1.5" />
        {failed && (
          <span role="alert" className="mt-1 block text-refutes">
            Could not be read: {paper.reason || 'no open PDF was found'}.{' '}
            {paper.mine ? 'Try again, upload its PDF, or remove it.' : `Only ${adder} can try again, upload its PDF or remove it.`}
            {retry.isError && ` Trying again failed: ${problem(retry.error).title}.`}
            {upload.isError && ` The PDF was not added: ${problem(upload.error).title}.`}
          </span>
        )}
      </td>
      <td className={cell}>
        <Badge tone={paper.topic === myTopic ? 'accent' : 'neutral'} title={paper.topic === myTopic ? 'Your topic' : undefined}>
          {paper.topic}
          {paper.topic === myTopic && <span className="sr-only">, your topic</span>}
        </Badge>
      </td>
      <td className={cell}>
        <StatusBadge status={paper.status} />
      </td>
      <td className={cn(cell, 'w-full @4xl:w-40')}>
        <TeamProgress paper={paper} />
      </td>
      <td className={cell}>
        <CellLabel>Also labeled by</CellLabel>
        {others.length > 0 ? others.join(', ') : <span className="text-ink-muted">No one</span>}
      </td>
      <td className={cell}>
        <CellLabel>Added by</CellLabel>
        {addedBy === me ? 'You' : addedBy || <span className="text-ink-muted">Unknown</span>}
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
            disabled={retry.isPending || upload.isPending}
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
            disabled={retry.isPending}
            // The gateway takes the topic and DOI from the row it replaces.
            onFile={(file) => upload.mutate({ file, topic: '', replaces: paper.analysis_id })}
          />
        )}
        {paper.mine && (
          <Button
            variant="ghost"
            title="Remove"
            className="relative z-10 min-h-11 min-w-11 px-3 hover:text-refutes @4xl:px-0"
            aria-label={`Remove ${paper.title}`}
            disabled={assign.isPending || retry.isPending || upload.isPending}
            onClick={() => {
              if (!window.confirm("Remove this paper from the team's list? Labels already saved are kept.")) return
              assign.mutate({ analysisId: paper.analysis_id, topic: '' })
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="@4xl:sr-only">Remove</span>
          </Button>
        )}
      </td>
    </motion.tr>
  )
}

export function PaperTable({ papers, me, myTopic, onOpen }: { papers: Paper[]; me: string; myTopic: string; onOpen: (id: string) => void }) {
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
            <PaperRow key={paper.analysis_id} paper={paper} me={me} myTopic={myTopic} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
