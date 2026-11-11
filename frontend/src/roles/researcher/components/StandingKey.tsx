/**
 * What "backed", "silent", "contradicted" and "not checked" mean, as a closed disclosure under a
 * tally. The words come from STANDING_MEANINGS, the same text the verdict badges show on hover, so
 * the key and the badges cannot drift apart.
 */

import { STANDING_MEANINGS, type Standing } from '../../../lib/claims'

const ROWS: { word: string; kind: Standing }[] = [
  { word: 'backed', kind: 'supports' },
  { word: 'silent', kind: 'insufficient' },
  { word: 'contradicted', kind: 'refutes' },
  { word: 'not checked', kind: 'unchecked' },
]

export function StandingKey() {
  return (
    <details className="group text-[13px]">
      <summary className="inline-flex cursor-pointer list-none items-center rounded-md py-1 font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        What do these mean?
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {ROWS.map(({ word, kind }) => (
          <div key={word} className="contents">
            <dt className="font-medium text-ink">{word}</dt>
            <dd className="text-ink-muted">{STANDING_MEANINGS[kind]}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
