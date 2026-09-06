/**
 * What a claim's results add up to, and how to leave with them.
 *
 * A reader scanning twenty claims asks one question first — is anything wrong with this
 * paper's citations — so a claim gets a single standing, the standings sort worst-first,
 * and the counts double as filters (#37).
 */

import type { Citation, Claim, Unchecked, Verdict } from './api'
import { reasonText } from './api'

/** One claim's standing, worst first: that order is the reading order. "checking" is the
 * run's own state, a claim whose sources are being read right now; it sits with the
 * unanswered ones so a reader watching the run sees what is still to come. */
export const STANDINGS = ['refutes', 'insufficient', 'checking', 'unchecked', 'supports', 'uncited'] as const

export type Standing = (typeof STANDINGS)[number]

/** Plain language over jargon: a badge has to mean something to a first-time reader (#37). */
export const STANDING_LABELS: Record<Standing, string> = {
  refutes: 'Source contradicts',
  insufficient: 'Source is silent',
  checking: 'Checking',
  unchecked: 'Not checked',
  supports: 'Source backs it',
  uncited: 'No source cited',
}

/** What each badge does and does not mean. Shown as a legend and on hover. */
export const STANDING_MEANINGS: Record<Standing, string> = {
  refutes: 'A cited paper says something that goes against this claim.',
  insufficient: 'We read the cited paper and it does not settle the claim either way.',
  checking: 'A cited paper is being read right now; the answer appears when that is done.',
  unchecked: 'We could not read a cited paper, so this claim has not been checked at all.',
  supports: 'A cited paper says what this claim says it does.',
  uncited: 'The sentence this claim came from cites nothing, so there is nothing to check.',
}

/**
 * The one standing a claim gets.
 *
 * The worst answer wins: a claim with one contradicting source and three supporting ones is
 * a claim worth a reader's attention, and averaging that away would hide the only finding
 * on the page.
 */
export function standingOf(claim: Claim, running = false): Standing {
  const verdicts = claim.verdicts ?? []
  if (verdicts.some((verdict) => verdict.verdict === 'refutes')) return 'refutes'
  if (verdicts.some((verdict) => verdict.verdict === 'insufficient')) return 'insufficient'
  if (verdicts.length) return 'supports'
  if ((claim.unchecked ?? []).length) return 'unchecked'
  // While the run is on, a claim with a source we can look up is still to be answered;
  // "not checked" would read as a result before there is one.
  if (running && claim.citations.some(citedAs)) return 'checking'
  return claim.citations.length ? 'unchecked' : 'uncited'
}

/** A supported claim needs no reading; one that failed, is being checked or was never checked does. */
export function opensByDefault(standing: Standing) {
  return (
    standing === 'refutes' || standing === 'insufficient' || standing === 'checking' || standing === 'unchecked'
  )
}

export type Standings = { claim: Claim; index: number; standing: Standing }[]

/** Every claim with its standing, worst first, keeping the paper's order within a standing.
 * `running` marks the claims whose sources are still being read. */
export function ranked(claims: Claim[], running = false): Standings {
  return claims
    .map((claim, index) => ({ claim, index, standing: standingOf(claim, running) }))
    .sort((a, b) => STANDINGS.indexOf(a.standing) - STANDINGS.indexOf(b.standing))
}

export function countsOf(standings: Standings): Record<Standing, number> {
  const counts = Object.fromEntries(STANDINGS.map((s) => [s, 0])) as Record<Standing, number>
  for (const { standing } of standings) counts[standing] += 1
  return counts
}

/** How a citation is named in a verdict or a failure: the identifier we looked it up by. */
export function citedAs({ doi, arxiv, title, url }: Citation) {
  return doi || arxiv || title || url
}

/** The verdict and the failure belonging to one citation, paired by what we looked it up by. */
export function answersFor(claim: Claim, citation: Citation) {
  const cited = citedAs(citation)
  return {
    verdict: (claim.verdicts ?? []).find((v) => v.cited === cited),
    failure: (claim.unchecked ?? []).find((f) => f.source === cited),
  }
}

/** Verdicts and failures that name no citation we hold, so nothing is dropped from the card. */
export function unpaired(claim: Claim) {
  const named = new Set(claim.citations.map(citedAs))
  return {
    verdicts: (claim.verdicts ?? []).filter((v) => !v.cited || !named.has(v.cited)),
    failures: (claim.unchecked ?? []).filter((f) => !named.has(f.source)),
  }
}

function rows(claims: Claim[]) {
  return claims.flatMap((claim) => {
    const standing = standingOf(claim)
    const answers: (Verdict | Unchecked)[] = [...(claim.verdicts ?? []), ...(claim.unchecked ?? [])]
    if (!answers.length) return [{ claim, standing, source: '', outcome: '', quote: '', page: '' }]
    return answers.map((answer) => ({
      claim,
      standing,
      source: 'cited' in answer ? (answer.cited ?? answer.source) : answer.source,
      outcome: 'verdict' in answer ? answer.verdict : reasonText(answer.reason),
      quote: 'quote' in answer ? answer.quote : answer.message,
      page: String(claim.source?.page ?? ''),
    }))
  })
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * The claims as CSV, one row per answered citation.
 *
 * Columns match what the benchmark harness wants (#9), so an exported file can seed a
 * labelling round instead of being retyped.
 */
export function toCsv(claims: Claim[]) {
  const header = ['claim', 'standing', 'cited_source', 'outcome', 'quote', 'claim_page']
  const body = rows(claims).map((row) =>
    [row.claim.claim, row.standing, row.source, row.outcome, row.quote, row.page]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...body].join('\n')
}

/** The claims as markdown, for pasting into a literature review. */
export function toMarkdown(claims: Claim[], paper?: string) {
  const lines = [`# Claims in ${paper ?? 'this paper'}`, '']
  for (const { claim, index, standing } of ranked(claims)) {
    lines.push(`## ${index + 1}. ${STANDING_LABELS[standing]}`, '', claim.claim, '')
    if (claim.sentence) lines.push(`> ${claim.sentence}`, '')
    for (const verdict of claim.verdicts ?? []) {
      lines.push(`- **${verdict.verdict}** against ${verdict.source}: ${verdict.reasoning}`)
      if (verdict.quote) lines.push(`  - > ${verdict.quote}`)
    }
    for (const failure of claim.unchecked ?? []) {
      lines.push(`- **not checked** — ${failure.source}: ${reasonText(failure.reason)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
