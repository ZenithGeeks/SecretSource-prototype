/**
 * What each claim standing means and how to read an analysis, as a closed disclosure, and the
 * standings counted as badges. Home, Analyses, an analysis and Library show this one key, so
 * the words cannot drift apart between screens. Each entry is the same badge the claim cards
 * wear, in STANDINGS order.
 */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Standing } from '../lib/claims'
import { STANDING_MEANINGS, STANDINGS, standingCount } from '../lib/claims'
import { Badge, StandingBadge, VerdictBadge } from './ui'

/** A disclosure's summary: link colour, a chevron and no browser marker, as "What do these mean?" has. */
export const DISCLOSURE_SUMMARY =
  'inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-1 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden'

/** A key cap, as the labeler draws its shortcuts. */
export const KEY_CAP = 'rounded-sm border border-border-subtle bg-canvas px-1 font-mono text-caption leading-4 text-ink-muted'

/** Every standing with a count, worst first, as badges: "Source contradicts: 3". With `limit`,
 * only the worst few show and a "+2" badge names the rest on hover. */
export function StandingCounts({ counts, limit }: { counts: Record<Standing, number>; limit?: number }) {
  const kinds = STANDINGS.filter((kind) => counts[kind] > 0)
  const rest = limit === undefined ? [] : kinds.slice(limit)
  return (
    <span className="flex flex-wrap gap-1.5">
      {kinds.slice(0, limit).map((kind) => (
        <VerdictBadge key={kind} verdict={kind} text={standingCount(kind, counts[kind])} title={STANDING_MEANINGS[kind]} />
      ))}
      {rest.length > 0 && (
        <Badge title={rest.map((kind) => standingCount(kind, counts[kind])).join(' · ')}>+{rest.length}</Badge>
      )}
    </span>
  )
}

/** The id of the key, which an analysis header's Help opens. */
export const HELP_ID = 'page-help'

export function StandingKey() {
  const [open, setOpen] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)

  // Light dismiss: the key folds away once the reader does something else (picks a tile, opens a
  // claim or the page viewer, presses J), so it never keeps the claims pushed down the page.
  // A click closes it after it lands, and focus moved by a click is left to the click: closing on
  // pointerdown would move the row under the pointer before the click arrives.
  useEffect(() => {
    const node = details.current
    /* v8 ignore next -- the details element is mounted whenever it can be open; this satisfies the type */
    if (!open || !node) return
    let pointing = false
    const outside = (event: Event) => !node.contains(event.target as Node)
    const close = () => (node.open = false)
    const onPointerDown = () => (pointing = true)
    const onClick = (event: MouseEvent) => {
      pointing = false
      if (outside(event)) close()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!pointing && outside(event)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('click', onClick)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('click', onClick)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open])

  return (
    // The chevron and link colour mark it as something to open, as the other disclosures do.
    <details ref={details} id={HELP_ID} className="group text-ui" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={DISCLOSURE_SUMMARY}>
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        What do these mean?
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {STANDINGS.map((kind) => (
          <div key={kind} className="contents">
            <dt>
              <StandingBadge standing={kind} />
            </dt>
            <dd className="text-ink-muted">{STANDING_MEANINGS[kind]}</dd>
          </div>
        ))}
      </dl>
      {/* Words from the README, the verdict notes and the screens' own labels; nothing here the app does not do. */}
      <h3 className="type-label mt-3 text-ink-muted">How to read an analysis</h3>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink-muted">
        <dt className="font-medium text-ink">Claim</dt>
        <dd>One statement in a paper that credits a cited work with something you could check in it.</dd>
        <dt className="font-medium text-ink">Checked</dt>
        <dd>We could read the cited paper and compare it with the claim.</dd>
        <dt className="font-medium text-ink">Verdict</dt>
        <dd>An AI judge reads passages from the cited paper. It can be wrong, so each verdict shows its quote and page.</dd>
        <dt className="font-medium text-ink">Several works</dt>
        <dd>The claim takes the worst answer: contradicts, then silent, then backs it.</dd>
        <dt className="font-medium text-ink">Runs</dt>
        <dd>Each run is kept. Earlier runs fold under the paper’s row on Analyses; a stopped one says why.</dd>
        <dt className="font-medium text-ink">Keys</dt>
        <dd>
          <kbd className={KEY_CAP}>J</kbd> and <kbd className={KEY_CAP}>K</kbd> move between claims,{' '}
          <kbd className={KEY_CAP}>O</kbd> shows the evidence, <kbd className={KEY_CAP}>Esc</kbd> closes the page viewer.
        </dd>
        <dt className="font-medium text-ink">Export</dt>
        <dd>Copies every claim and verdict as markdown, or downloads them with their pages as CSV.</dd>
      </dl>
    </details>
  )
}
