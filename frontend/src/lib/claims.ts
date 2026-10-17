/**
 * What a claim's results add up to, and how to leave with them.
 *
 * A reader scanning twenty claims asks one question first — is anything wrong with this
 * paper's citations — so a claim gets a single standing, the standings sort worst-first,
 * and the counts double as filters (#37).
 */

import type { Analysis, Citation, Claim, Unchecked, Verdict } from './api'
import { reasonText } from './api'
import { csvText } from './csv'

/** The name a list shows for an analysis: the uploaded file's name, else the paper id. */
export function analysisLabel(analysis: Analysis): string {
  return analysis.file?.split(/[\\/]/).pop() ?? analysis.paper
}

/** One claim's standing, worst first: that order is the reading order. */
export const STANDINGS = ['refutes', 'insufficient', 'unchecked', 'supports', 'named', 'uncited'] as const

export type Standing = (typeof STANDINGS)[number]

/** Plain language over jargon: a badge has to mean something to a first-time reader (#37). */
export const STANDING_LABELS: Record<Standing, string> = {
  refutes: 'Source contradicts',
  insufficient: 'Source is silent',
  unchecked: 'Not checked',
  supports: 'Source backs it',
  named: 'Names what it uses',
  uncited: 'No citation',
}

/** The word that follows a count: "1 contradicts" / "4 contradict", "4 silent", "1 backs it" /
 * "3 back it", "3 not checked". [singular, plural]. */
const COUNT_WORDS: Record<Standing, readonly [string, string]> = {
  refutes: ['contradicts', 'contradict'],
  insufficient: ['silent', 'silent'],
  supports: ['backs it', 'back it'],
  unchecked: ['not checked', 'not checked'],
  named: ['names what it uses', 'name what they use'],
  uncited: ['no citation', 'no citation'],
}

/** The label under a verdict count, agreeing with the number: `verdictCountWord('refutes', 1)`
 * is "contradicts", with 4 it is "contradict". */
export function verdictCountWord(kind: Standing, n: number): string {
  return COUNT_WORDS[kind][n === 1 ? 0 : 1]
}

/** Number and word together: "1 contradicts", "3 back it". */
export function verdictCountLabel(kind: Standing, n: number): string {
  return `${n} ${verdictCountWord(kind, n)}`
}

/** What each badge does and does not mean. Shown as a legend and on hover. */
export const STANDING_MEANINGS: Record<Standing, string> = {
  refutes: 'A cited paper says something that goes against this claim.',
  insufficient: 'We read the cited paper and it does not settle the claim either way.',
  unchecked: 'We could not read a cited paper, so this claim has not been checked at all.',
  supports: 'A cited paper says what this claim says it does.',
  named:
    'The claim is about this paper’s own work. It cites a benchmark, dataset, model or method only to name what it used, so there is nothing in the cited work to check it against.',
  uncited: 'The sentence this claim came from cites nothing, so there is nothing to check.',
}

/**
 * The one standing a claim gets.
 *
 * The worst answer wins: a claim with one contradicting source and three supporting ones is
 * a claim worth a reader's attention, and averaging that away would hide the only finding
 * on the page.
 */
export function standingOf(claim: Claim): Standing {
  const verdicts = claim.verdicts ?? []
  if (verdicts.some((verdict) => verdict.verdict === 'refutes')) return 'refutes'
  if (verdicts.some((verdict) => verdict.verdict === 'insufficient')) return 'insufficient'
  if (verdicts.length) return 'supports'
  if ((claim.unchecked ?? []).length) return 'unchecked'
  if (!claim.citations.length) return 'uncited'
  const named = new Set(claim.named ?? [])
  return claim.citations.every((citation) => named.has(citedAs(citation))) ? 'named' : 'unchecked'
}

/** A supported claim needs no reading; one that failed or was never checked does. */
export function opensByDefault(standing: Standing) {
  return standing === 'refutes' || standing === 'insufficient' || standing === 'unchecked'
}

export type Standings = { claim: Claim; index: number; standing: Standing }[]

/** Every claim with its standing, worst first, keeping the paper's order within a standing. */
export function ranked(claims: Claim[]): Standings {
  return claims
    .map((claim, index) => ({ claim, index, standing: standingOf(claim) }))
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

/**
 * The claims as CSV, one row per answered citation.
 *
 * Columns match what the benchmark harness wants (#9), so an exported file can seed a
 * labelling round instead of being retyped.
 */
export function toCsv(claims: Claim[]) {
  const header = ['claim', 'standing', 'cited_source', 'outcome', 'quote', 'claim_page']
  const body = rows(claims).map((row) => [row.claim.claim, row.standing, row.source, row.outcome, row.quote, row.page])
  return csvText([header, ...body])
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
