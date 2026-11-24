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

/** The name a list, a breadcrumb or a heading shows for an analysis: the paper's own title,
 * else the title another of `runs` has for the same paper (a run stopped before the paper was
 * read has none), else the uploaded file's name, else the paper id. */
export function analysisLabel(analysis: Analysis, runs: Analysis[] = []): string {
  const paper = normalise(analysis.paper)
  return (
    analysis.title ||
    runs.find((run) => run.title && normalise(run.paper) === paper)?.title ||
    analysis.file?.split(/[\\/]/).pop() ||
    analysis.paper
  )
}

/** A paper's runs: the one its row opens, and the others, newest first. */
export type PaperRuns = { run: Analysis; earlier: Analysis[] }

/** Lowercase words only, so "arXiv:2004.14974" and "2004.14974" compare equal. */
function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?(arxiv\.org\/abs\/|doi\.org\/)|^(arxiv|doi):/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Groups a newest-first list of runs into one entry per paper, in the order of each paper's
 * newest run.
 *
 * The same paper can come back under another id (a DOI one time, an arXiv link the next), so
 * runs are matched by title, and a run without a title (a stopped one) by its id, joined to the
 * title another run of that id has. A row opens a running run, else the newest finished one,
 * else the newest.
 */
export function groupRuns(analyses: Analysis[]): PaperRuns[] {
  const titleOf = new Map<string, string>()
  for (const analysis of analyses) {
    if (analysis.title) titleOf.set(normalise(analysis.paper), normalise(analysis.title))
  }
  const papers = new Map<string, Analysis[]>()
  for (const analysis of analyses) {
    const id = normalise(analysis.paper)
    const key = analysis.title ? normalise(analysis.title) : (titleOf.get(id) ?? id)
    papers.set(key, [...(papers.get(key) ?? []), analysis])
  }
  return [...papers.values()].map((runs) => {
    const run =
      runs.find((analysis) => analysis.status === 'running') ??
      runs.find((analysis) => analysis.status === 'done') ??
      runs[0]
    return { run, earlier: runs.filter((analysis) => analysis !== run) }
  })
}

/** One claim's standing, worst first: that order is the reading order. */
export const STANDINGS = ['refutes', 'insufficient', 'unchecked', 'supports', 'named', 'uncited'] as const

export type Standing = (typeof STANDINGS)[number]

/** A standing's colour in bars, dots and keys. The three greys differ by shape as well as shade:
 * a claim that only names a tool or dataset gets a hollow mark, so it never reads as not checked. */
export const STANDING_COLORS: Record<Standing, string> = {
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
  unchecked: 'bg-neutral',
  supports: 'bg-supports',
  named: 'border border-ink-muted',
  uncited: 'bg-ink/30',
}

/** Plain language over jargon: a badge has to mean something to a first-time reader (#37). */
export const STANDING_LABELS: Record<Standing, string> = {
  refutes: 'Source contradicts',
  insufficient: 'Source is silent',
  unchecked: 'Not checked',
  supports: 'Source backs it',
  named: 'Names a tool or dataset',
  uncited: 'No citation',
}

/** The word that follows a count: "1 contradicts" / "4 contradict", "4 silent", "1 backs it" /
 * "3 back it", "3 not checked". [singular, plural]. */
const COUNT_WORDS: Record<Standing, readonly [string, string]> = {
  refutes: ['contradicts', 'contradict'],
  insufficient: ['silent', 'silent'],
  supports: ['backs it', 'back it'],
  unchecked: ['not checked', 'not checked'],
  named: ['names a tool or dataset', 'name a tool or dataset'],
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

/** The other cited works' verdicts beside a claim's chip, worst first: "3 back it, 1 silent".
 * Empty when there are none. */
export function verdictTally(verdicts: Verdict['verdict'][]): string {
  return (['refutes', 'insufficient', 'supports'] as const)
    .map((kind) => [kind, verdicts.filter((verdict) => verdict === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => verdictCountLabel(kind, n))
    .join(', ')
}

/** What each badge does and does not mean. Shown as a legend and on hover. */
export const STANDING_MEANINGS: Record<Standing, string> = {
  refutes: 'A cited paper says something that goes against this claim.',
  insufficient: 'We read the cited paper and it does not settle the claim either way.',
  unchecked: 'We could not read a cited paper, so this claim has not been checked at all.',
  supports: 'A cited paper says what this claim says it does.',
  named:
    'The claim is about this paper’s own work. Its citations only name something the paper used, such as a benchmark, dataset or model, so there is nothing in them to check it against.',
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

/** "20 claims, 3 contradicted by a source": a run's size and the finding a reader looks for first. */
export function claimsLine(claims: Claim[]): string {
  const contradicted = claims.filter((claim) => standingOf(claim) === 'refutes').length
  const size = `${claims.length} ${claims.length === 1 ? 'claim' : 'claims'}`
  return contradicted ? `${size}, ${contradicted} contradicted by a source` : size
}

/** One standing's count in words that do not change with the number: "Source contradicts: 3". */
export function standingCount(kind: Standing, n: number): string {
  return `${STANDING_LABELS[kind]}: ${n}`
}

/** "Source contradicts: 3 · Source is silent: 7 · No citation: 1": every standing with a claim,
 * worst first, so the counts add up to the number of claims. */
export function countsText(claims: Claim[]): string {
  const counts = countsOf(ranked(claims))
  return STANDINGS.filter((kind) => counts[kind] > 0)
    .map((kind) => standingCount(kind, counts[kind]))
    .join(' · ')
}

/** "Finished 8 Nov 2026, 18:35", "Started …" for a run that has not finished, or "Ran …" for a
 * finished run from before finish times were kept: the one time every screen names a run by.
 * Empty when the run has no readable time. */
export function runTime(analysis: Analysis): string {
  const time = runDate(analysis)
  if (!time) return ''
  const word = analysis.status !== 'done' ? 'Started' : analysis.completed ? 'Finished' : 'Ran'
  return `${word} ${new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

/** The time runTime names, in milliseconds, to sort runs by; 0 when the run has no readable time. */
export function runDate(analysis: Analysis): number {
  const finished = analysis.status === 'done' && analysis.completed
  return new Date((finished ? analysis.completed : analysis.started) ?? '').getTime() || 0
}

/** Newest first by the time each row shows, so a list's order matches its dates. */
export function byRunTime(a: Analysis, b: Analysis) {
  return runDate(b) - runDate(a)
}

/** The standings a `?standing=` value names ("refutes,insufficient"), ignoring anything else. */
export function standingsIn(param: string | null): Standing[] {
  const named = new Set(param?.split(','))
  return STANDINGS.filter((kind) => named.has(kind))
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
