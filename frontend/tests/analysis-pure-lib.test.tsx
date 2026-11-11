/** The analysis helpers that are plain functions: outline, progress, claims and citations. */

import { describe, expect, it } from 'vitest'

import type { Analysis, Citation, Claim, OutlineEntry, Stage, Verdict } from '../src/lib/api'
import { reasonText } from '../src/lib/api'
import { citationLink, citationNumber, preprintNote, reference, shortMessage } from '../src/lib/citations'
import {
  analysisLabel,
  answersFor,
  countsOf,
  opensByDefault,
  ranked,
  standingOf,
  toCsv,
  toMarkdown,
  unpaired,
  verdictCountLabel,
  verdictCountWord,
} from '../src/lib/claims'
import { contentsRows, sectionName, sectionOfPage, shownRow } from '../src/lib/outline'
import { duration, summarise } from '../src/lib/progress'

const cite = (extra: Partial<Citation> = {}): Citation => ({
  title: 'ColBERT',
  authors: ['Khattab', 'Zaharia'],
  year: '2020',
  doi: '10.1/colbert',
  arxiv: '',
  url: '',
  ...extra,
})

const verdict = (extra: Partial<Verdict> = {}): Verdict => ({
  verdict: 'supports',
  quote: '',
  reasoning: 'It says so.',
  source: 'colbert.pdf',
  cited: '10.1/colbert',
  evidence: [],
  ...extra,
})

const claim = (extra: Partial<Claim> = {}): Claim => ({ claim: 'A claim.', citations: [cite()], ...extra })

describe('outline', () => {
  const outline: OutlineEntry[] = [
    { n: '1', title: 'Introduction', page: 1, y: 0 },
    { n: '3', title: 'Method', page: 3, y: 0 },
    { n: '3.1', title: 'Encoder', page: 4, y: 0 },
    { n: '3.2', title: 'Scoring', page: 5, y: 0 },
  ]

  it('keeps every top-level section and only the subsections a claim comes from', () => {
    const rows = contentsRows(outline, [claim({ section: '3.1' }), claim({ section: '3.1' })])
    expect(rows.map((row) => row.n)).toEqual(['1', '3', '3.1'])
    expect(rows.find((row) => row.n === '3.1')).toMatchObject({ depth: 1, claims: 2, contradicted: false })
  })

  it('marks a section whose own claim is contradicted', () => {
    const refuted = claim({ section: '1', verdicts: [verdict({ verdict: 'refutes' })] })
    expect(contentsRows(outline, [refuted])[0]).toMatchObject({ claims: 1, contradicted: true })
  })

  it('marks the nearest shown section for one that has no row of its own', () => {
    const rows = contentsRows(outline, [])
    expect(shownRow(rows, '3.2')).toBe('3')
    expect(shownRow(rows, '3')).toBe('3')
  })

  it('marks nothing for no section or a section that is not listed', () => {
    const rows = contentsRows(outline, [])
    expect(shownRow(rows, null)).toBeNull()
    expect(shownRow(rows, '9.1')).toBeNull()
  })

  it('finds the last heading on or before a page', () => {
    expect(sectionOfPage(outline, 4)).toBe('3.1')
    expect(sectionOfPage(outline, 99)).toBe('3.2')
  })

  it('has no section for a page before the first heading', () => {
    expect(sectionOfPage([{ n: '1', title: 'Intro', page: 2, y: 0 }], 1)).toBeNull()
  })

  it('names a section with its title, or without when the outline lost it', () => {
    expect(sectionName(outline, '3.1')).toBe('Section 3.1 · Encoder')
    expect(sectionName(outline, '7')).toBe('Section 7')
  })
})

describe('claims', () => {
  it('labels an analysis by its uploaded file name, else the paper', () => {
    const base = { id: '1', paper: 'p.pdf', status: 'done', claims: [], stages: [] } as Analysis
    expect(analysisLabel({ ...base, file: 'C:\\papers\\up.pdf' })).toBe('up.pdf')
    expect(analysisLabel(base)).toBe('p.pdf')
  })

  it('gives a claim its worst standing', () => {
    expect(standingOf(claim({ verdicts: [verdict(), verdict({ verdict: 'refutes' })] }))).toBe('refutes')
    expect(standingOf(claim({ verdicts: [verdict({ verdict: 'insufficient' })] }))).toBe('insufficient')
    expect(standingOf(claim({ verdicts: [verdict()] }))).toBe('supports')
  })

  it('calls a claim not checked when a cited work could not be read, or was never looked at', () => {
    const failure = { source: '10.1/colbert', reason: 'failed' as const, message: '' }
    expect(standingOf(claim({ unchecked: [failure] }))).toBe('unchecked')
    expect(standingOf(claim())).toBe('unchecked')
  })

  it('names a citation by its title or url when it has no DOI or arXiv id', () => {
    const byUrl = cite({ doi: '', title: '', url: 'https://x.org/p' })
    expect(answersFor(claim({ citations: [byUrl], verdicts: [verdict({ cited: 'https://x.org/p' })] }), byUrl).verdict).toBeDefined()
    expect(standingOf(claim({ citations: [byUrl], named: ['https://x.org/p'] }))).toBe('named')
  })

  it('calls a claim uncited without citations, and named when they only name what the paper uses', () => {
    expect(standingOf(claim({ citations: [] }))).toBe('uncited')
    expect(standingOf(claim({ named: ['10.1/colbert'] }))).toBe('named')
  })

  it('opens the standings that need reading', () => {
    expect(opensByDefault('refutes')).toBe(true)
    expect(opensByDefault('insufficient')).toBe(true)
    expect(opensByDefault('unchecked')).toBe(true)
    expect(opensByDefault('supports')).toBe(false)
  })

  it('ranks worst first and keeps the paper order within a standing', () => {
    const claims = [
      claim({ claim: 'ok', verdicts: [verdict()] }),
      claim({ claim: 'bad', verdicts: [verdict({ verdict: 'refutes' })] }),
      claim({ claim: 'ok too', verdicts: [verdict()] }),
    ]
    const standings = ranked(claims)
    expect(standings.map((row) => row.index)).toEqual([1, 0, 2])
    expect(countsOf(standings)).toMatchObject({ refutes: 1, supports: 2, uncited: 0 })
  })

  it('agrees the count word with the number', () => {
    expect(verdictCountWord('refutes', 1)).toBe('contradicts')
    expect(verdictCountWord('refutes', 4)).toBe('contradict')
    expect(verdictCountLabel('supports', 3)).toBe('3 back it')
  })

  it('pairs a citation with its verdict and its failure', () => {
    const failure = { source: '10.1/colbert', reason: 'failed' as const, message: '' }
    const both = claim({ verdicts: [verdict()], unchecked: [failure] })
    expect(answersFor(both, cite())).toEqual({ verdict: both.verdicts![0], failure })
    expect(answersFor(claim(), cite())).toEqual({ verdict: undefined, failure: undefined })
  })

  it('keeps verdicts and failures that name no citation the claim holds', () => {
    const stray = verdict({ cited: 'other' })
    const unnamed = verdict({ cited: undefined })
    const failure = { source: 'other', reason: 'failed' as const, message: '' }
    const result = unpaired(claim({ verdicts: [verdict(), stray, unnamed], unchecked: [failure] }))
    expect(result.verdicts).toEqual([stray, unnamed])
    expect(result.failures).toEqual([failure])
    expect(unpaired(claim())).toEqual({ verdicts: [], failures: [] })
  })

  it('exports one CSV row per answered citation and one for a claim with no answers', () => {
    const failure = { source: 'gone', reason: 'no-open-access' as const, message: 'paywalled' }
    const csv = toCsv([
      claim({ claim: 'First', verdicts: [verdict({ quote: 'q' }), verdict({ cited: undefined, source: 'file.pdf' })], source: { page: 2, boxes: [], page_width: 1, page_height: 1 } }),
      claim({ claim: 'Second', unchecked: [failure] }),
      claim({ claim: 'Third', citations: [] }),
    ])
    const lines = csv.trim().split(/\r?\n/).map((line) => line.replaceAll('"', ''))
    expect(lines[0]).toBe('claim,standing,cited_source,outcome,quote,claim_page')
    expect(lines[1]).toContain('First,supports,10.1/colbert,supports,q,2')
    expect(lines[2]).toContain('file.pdf')
    expect(lines[3]).toContain('no free copy published,paywalled')
    expect(lines[4]).toBe('Third,uncited,,,,')
  })

  it('exports markdown with the sentence, verdicts, quotes and failures', () => {
    const failure = { source: 'gone', reason: 'withdrawn' as const, message: '' }
    const md = toMarkdown(
      [claim({ sentence: 'The sentence.', verdicts: [verdict({ quote: 'quoted' }), verdict({ verdict: 'insufficient' })], unchecked: [failure] })],
      'paper.pdf',
    )
    expect(md).toContain('# Claims in paper.pdf')
    expect(md).toContain('> The sentence.')
    expect(md).toContain('- **supports** against colbert.pdf: It says so.')
    expect(md).toContain('  - > quoted')
    expect(md).toContain('- **not checked** — gone: withdrawn by its authors on arXiv')
    expect(toMarkdown([claim()])).toContain('# Claims in this paper')
  })
})

describe('citations', () => {
  it('writes a reference with the first author, year and title', () => {
    expect(reference(cite())).toBe('Khattab et al. (2020). ColBERT')
    expect(reference(cite({ authors: ['Khattab'] }))).toBe('Khattab (2020). ColBERT')
  })

  it('does not double the full stop after et al. when there is no year', () => {
    expect(reference(cite({ year: '' }))).toBe('Khattab et al. ColBERT')
  })

  it('falls back to Unknown, the arXiv id, or Untitled', () => {
    expect(reference(cite({ authors: [], year: '', title: '', arxiv: '2001.1' }))).toBe('Unknown. arXiv:2001.1')
    expect(reference(cite({ title: '' }))).toBe('Khattab et al. (2020). Untitled')
  })

  it('writes the venue where a work has no title (#937)', () => {
    const venue = 'Future Generation Computer Systems'
    expect(reference(cite({ title: '', venue }))).toBe(`Khattab et al. (2020). ${venue}`)
    expect(reference(cite({ title: '', venue, arxiv: '2001.1' }))).toBe(`Khattab et al. (2020). ${venue}`)
  })

  it('keeps only numeric labels as the citation number', () => {
    expect(citationNumber(cite({ label: '13' }))).toBe('13')
    expect(citationNumber(cite({ label: '13a' }))).toBe('13a')
    expect(citationNumber(cite({ label: 'Khattab, 2020' }))).toBe('')
    expect(citationNumber(cite())).toBe('')
  })

  it('links by DOI, then arXiv, then the url, else nothing', () => {
    expect(citationLink(cite())).toBe('https://doi.org/10.1/colbert')
    expect(citationLink(cite({ doi: '', arxiv: '2001.1' }))).toBe('https://arxiv.org/abs/2001.1')
    expect(citationLink(cite({ doi: '', url: 'https://x.org' }))).toBe('https://x.org')
    expect(citationLink(cite({ doi: '' }))).toBe('')
  })

  it('says which preprint a verdict was checked against', () => {
    expect(preprintNote('2507.11408')).toBe('checked against the arXiv preprint 2507.11408')
    expect(preprintNote()).toBe('checked against the arXiv preprint')
  })

  it('shortens a server error page to its title, or a bare note without one', () => {
    expect(shortMessage('<!DOCTYPE html><html><head><title> Error 502 </title></head></html>')).toBe(
      'the server sent an error page (Error 502)',
    )
    expect(shortMessage('<html><body>oops</body></html>')).toBe('the server sent an error page')
  })

  it('strips tags and cuts a long message to one line', () => {
    expect(shortMessage('<b>no</b>   copy')).toBe('no copy')
    expect(shortMessage('x'.repeat(200))).toHaveLength(140)
    expect(shortMessage(undefined)).toBe('')
  })
})

describe('progress', () => {
  const at = (stage: Stage['stage'], extra: Partial<Stage> = {}): Stage => ({ stage, ...extra })
  const stateOf = (stages: Stage[], status: string, claims: Claim[] = []) =>
    summarise(stages, claims, status, 100).steps.map((step) => step.state)

  it('reports a queued run with nothing done', () => {
    const progress = summarise([at('queued')], [], 'running', 100)
    expect(progress.steps.map((step) => step.state)).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
    expect(progress.checksTotal).toBeNull()
    expect(progress.seconds).toBeNull()
  })

  it('counts verdicts and failures as checks done, and groups failures by reason', () => {
    const claims = [claim()]
    const stages = [
      at('extracted', { claims: 1, at: 10 }),
      at('planned', { checks: 4, sources: 2, at: 11 }),
      at('verified', { claim: 0, source: '10.1/colbert', verdict: 'supports', at: 12 }),
      at('verified', { claim: 0, source: 'b', verdict: 'refutes' }),
      at('verified', { claim: 1, source: 'c', verdict: 'insufficient' }),
      at('verified', { claim: 1, source: 'd', verdict: 'odd' }),
      at('failed', { claim: 0, source: '10.1/colbert', reason: 'withdrawn' }),
      at('failed', { claim: 0, source: '10.1/colbert', reason: 'withdrawn' }),
      at('failed', { claim: 0, source: 'unknown', reason: 'nonsense' as never }),
    ]
    const progress = summarise(stages, claims, 'running', 100)
    expect(progress.verdicts).toEqual({ supports: 1, refutes: 1, insufficient: 1 })
    expect(progress.failed).toBe(3)
    expect(progress.checksDone).toBe(6)
    expect(progress.checksTotal).toBe(4)
    expect(progress.failures).toEqual([
      { reason: reasonText('withdrawn'), sources: ['Khattab et al. (2020). ColBERT'] },
      { reason: 'checking it failed', sources: ['unknown'] },
    ])
    expect(progress.seconds).toBe(90)
  })

  it('files a failure with no source under the empty name', () => {
    const progress = summarise([at('failed', { claim: 0, reason: 'failed' })], [claim()], 'running', 100)
    expect(progress.failures).toEqual([{ reason: 'checking it failed', sources: [''] }])
  })

  it('lists checks that started and have not finished, naming the source', () => {
    const stages = [
      at('planned', { checks: 3, sources: 1 }),
      at('verifying', { claim: 0, source: '10.1/colbert' }),
      at('verifying', { claim: 1, source: 'b' }),
      at('verifying', { claim: 2, source: 'c' }),
      at('verifying', { claim: 3 }),
      at('verified', { claim: 1, source: 'b', verdict: 'supports' }),
      at('verified', { claim: 2, verdict: 'supports' }),
    ]
    const progress = summarise(stages, [claim()], 'running', 100)
    expect(progress.running).toEqual([
      { claim: 1, source: 'Khattab et al. (2020). ColBERT' },
      { claim: 4, source: '' },
    ])
  })

  it('lists nothing as running once the run is over', () => {
    const stages = [at('verifying', { claim: 0, source: 'a' })]
    expect(summarise(stages, [], 'done', 100).running).toEqual([])
  })

  it('treats a verifying stage with no claim as the first claim', () => {
    const progress = summarise([at('verifying', { source: 'a' })], [], 'running', 100)
    expect(progress.running).toEqual([{ claim: 1, source: 'a' }])
  })

  it('shows a run that never checked sources as skipping the plan and the checks', () => {
    const stages = [at('extracted', { claims: 2 }), at('figures', { figures: 3 }), at('audited', { findings: 0 }), at('done')]
    expect(stateOf(stages, 'done')).toEqual(['done', 'skipped', 'skipped', 'done', 'done'])
  })

  it('shows the details of each finished step', () => {
    const stages = [
      at('extracted', { claims: 1 }),
      at('planned', { checks: 2, sources: 1 }),
      at('verifying', { claim: 0, source: 'a' }),
      at('figures', { figures: 1 }),
      at('audited', { findings: 2 }),
      at('done'),
    ]
    const steps = summarise(stages, [], 'done', 100).steps
    expect(steps.map((step) => step.detail)).toEqual(['1 claim', '2 checks · 1 source', '0 of 2', '1 figure', '2 findings'])
  })

  it('counts checks without a plan when only verifying was seen, and plans with missing counts as zero', () => {
    const verifying = summarise([at('extracted'), at('verifying', { claim: 0, source: 'a' })], [], 'running', 100)
    expect(verifying.steps[0].detail).toBe('0 claims')
    expect(verifying.steps[2].detail).toBe('0 checks')
    const planned = summarise([at('planned')], [], 'running', 100)
    expect(planned.steps[1].detail).toBe('0 checks · 0 sources')
    expect(summarise([at('figures'), at('audited')], [], 'done', 100).steps[3].detail).toBe('0 figures')
    expect(summarise([at('audited')], [], 'done', 100).steps[4].detail).toBe('0 findings')
  })

  it('skips the figures step for a run from before it existed', () => {
    expect(stateOf([at('extracted'), at('planned'), at('verifying'), at('audited')], 'done')[3]).toBe('skipped')
  })

  it('marks the step an errored run stopped on as failed, and an idle one as todo', () => {
    expect(stateOf([at('extracted'), at('error', { message: 'boom' })], 'error')).toEqual([
      'done', 'failed', 'todo', 'todo', 'todo',
    ])
    expect(stateOf([], 'done')[0]).toBe('todo')
    expect(summarise([at('error', { message: 'boom' })], [], 'error', 100).error).toBe('boom')
  })

  it('takes the claim count from the claims when the paper has not been read', () => {
    expect(summarise([], [claim(), claim()], 'running', 100).claims).toBe(2)
    expect(summarise([at('extracted', { claims: 5 })], [], 'done', 100).claims).toBe(5)
  })

  it('measures a finished run from its first to its last stage, never negative', () => {
    expect(summarise([at('queued', { at: 10 }), at('done', { at: 70 })], [], 'done', 500).seconds).toBe(60)
    expect(summarise([at('queued', { at: 10 })], [], 'running', 5).seconds).toBe(0)
  })

  it('defaults the clock to now', () => {
    const now = Date.now() / 1000
    const seconds = summarise([at('queued', { at: now - 30 })], [], 'running').seconds
    expect(seconds).toBeGreaterThanOrEqual(30)
  })

  it('writes a duration in seconds, minutes, or hours', () => {
    expect(duration(44.6)).toBe('45 s')
    expect(duration(240)).toBe('4 min')
    expect(duration(3900)).toBe('1 h 5 min')
  })
})
