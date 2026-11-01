/** What each statement verdict is called and coloured in the Ask panel's stamps (#713). */

import type { StatementVerdict } from './assistant'

export type StampVerdict = StatementVerdict | 'checking'

export type StampStyle = { label: string; pill: string; bar: string }

export const STAMPS: Record<StampVerdict, StampStyle> = {
  supports: { label: 'Backed', pill: 'bg-supports-soft text-supports', bar: 'border-supports' },
  refutes: { label: 'Contradicted', pill: 'bg-refutes-soft text-refutes', bar: 'border-refutes' },
  insufficient: { label: 'Not backed', pill: 'bg-insufficient-soft text-insufficient', bar: 'border-insufficient' },
  unchecked: { label: 'Can’t check', pill: 'bg-neutral-soft text-ink-muted', bar: 'border-dotted border-ink-muted' },
  error: { label: 'Can’t check', pill: 'bg-neutral-soft text-ink-muted', bar: 'border-dotted border-ink-muted' },
  checking: { label: 'Checking…', pill: 'bg-neutral-soft text-ink-muted', bar: 'border-dotted border-ink-muted' },
}
