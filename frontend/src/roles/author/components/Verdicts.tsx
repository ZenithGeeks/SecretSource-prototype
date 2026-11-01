/**
 * The verdict visuals the Author screens share, reading src/lib/verdict.ts: CitationBadge
 * (the pill on an issue row) and AuditNote (the warning under a verdict the gateway's audit
 * flagged). The bar and legend are in src/components/VerdictBar.tsx.
 */

import { AlertTriangle } from 'lucide-react'

import { StandingBadge } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import { VERDICTS } from '../../../lib/verdict'
import type { AuditFinding, Verdict } from '../../../types/draftCheck'

export function CitationBadge({ verdict }: { verdict: Verdict }) {
  return <StandingBadge standing={VERDICTS[verdict].standing} title={VERDICTS[verdict].legend} />
}

const AUDIT_WORDS: Record<string, string> = {
  'quote-not-in-evidence': 'This quote is not in the source passages the check read. Read the source before you rely on this verdict.',
  'decided-without-quote': 'The check gave this verdict without quoting the source.',
  'unknown-verdict': 'The check answered with a verdict it does not know.',
}

/** One line per audit finding on a citation; nothing when there are none. */
export function AuditNote({ findings, className }: { findings: AuditFinding[] | undefined; className?: string }) {
  if (!findings?.length) return null
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {findings.map((finding) => (
        <li key={finding.check} className="flex items-start gap-1.5 text-insufficient">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{AUDIT_WORDS[finding.check] ?? finding.detail}</span>
        </li>
      ))}
    </ul>
  )
}
