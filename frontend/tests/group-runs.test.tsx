/** groupRuns: one entry per paper, the run its row opens, and the runs folded under it. */

import { describe, expect, it } from 'vitest'

import type { Analysis, Claim } from '../src/lib/api'
import { byRunTime, countsText, groupRuns, runTime, standingCount, standingsIn } from '../src/lib/claims'

const run = (fields: Partial<Analysis>): Analysis =>
  ({ id: 'a', paper: '10.1/x', status: 'done', claims: [], stages: [], ...fields }) as Analysis

const ids = (runs: Analysis[]) => runs.map((analysis) => analysis.id)

describe('groupRuns', () => {
  it('groups runs of one title together, whatever the case or punctuation', () => {
    const [paper, ...rest] = groupRuns([
      run({ id: 'new', title: 'Dense Retrieval!' }),
      run({ id: 'old', paper: '10.2/y', title: 'dense  retrieval' }),
    ])
    expect(rest).toHaveLength(0)
    expect(paper.run.id).toBe('new')
    expect(ids(paper.earlier)).toEqual(['old'])
  })

  it('keeps distinct Unicode and blank-normalized titles in separate groups', () => {
    const groups = groupRuns([
      run({ id: 'cells', title: '细胞研究', paper: 'doi:10.1/cells' }),
      run({ id: 'genes', title: '基因分析', paper: 'doi:10.1/genes' }),
      run({ id: 'cells-older', title: '细胞研究！', paper: 'arxiv:1234.1' }),
      run({ id: 'symbols', title: '!?', paper: 'doi:10.1/symbols' }),
      run({ id: 'other', title: '…', paper: 'doi:10.1/other' }),
      run({ id: 'punctuation-id', title: '', paper: '!' }),
      run({ id: 'titled-punctuation-id', title: 'Paper with a punctuation ID', paper: '!' }),
    ])
    expect(ids(groups.map(({ run }) => run))).toEqual(['cells', 'genes', 'symbols', 'other', 'punctuation-id'])
    expect(ids(groups[0].earlier)).toEqual(['cells-older'])
    expect(ids(groups[4].earlier)).toEqual(['titled-punctuation-id'])
  })

  it('keeps papers in the order of their first run', () => {
    const papers = groupRuns([
      run({ id: 'a1', paper: '10.1/a', title: 'A' }),
      run({ id: 'b1', paper: '10.1/b', title: 'B' }),
      run({ id: 'a2', paper: '10.1/a', title: 'A' }),
    ])
    expect(papers.map(({ run: main }) => main.id)).toEqual(['a1', 'b1'])
  })

  it('opens a running run, then a finished one, then the newest', () => {
    const runs = [
      run({ id: 'stopped', title: 'A', status: 'error' }),
      run({ id: 'going', title: 'A', status: 'running' }),
      run({ id: 'finished', title: 'A' }),
    ]
    expect(groupRuns(runs)[0].run.id).toBe('going')
    expect(groupRuns([runs[0], runs[2]])[0].run.id).toBe('finished')
    expect(groupRuns([runs[0]])[0].run.id).toBe('stopped')
    expect(ids(groupRuns(runs)[0].earlier)).toEqual(['stopped', 'finished'])
  })

  it('joins a stopped run without a title to a titled run of the same paper id', () => {
    const [paper, ...rest] = groupRuns([
      run({ id: 'done', paper: 'arXiv:2004.14974', title: 'ColBERT' }),
      run({ id: 'broke', paper: 'https://arxiv.org/abs/2004.14974', status: 'error' }),
    ])
    expect(rest).toHaveLength(0)
    expect(ids(paper.earlier)).toEqual(['broke'])
  })

  it('keeps ids that differ only in their punctuation apart', () => {
    const papers = groupRuns([
      run({ id: 'dash', paper: 'doi:10.1/a-b', status: 'error' }),
      run({ id: 'dot', paper: 'doi:10.1/a.b', status: 'error' }),
    ])
    expect(papers).toHaveLength(2)
  })

  it('keeps every run of one id in one group when a later run read another title', () => {
    const [paper, ...rest] = groupRuns([
      run({ id: 'new', paper: '10.1/x', title: 'Dense Retrieval for QA' }),
      run({ id: 'old', paper: '10.1/x', title: 'Dense retrieval' }),
    ])
    expect(rest).toHaveLength(0)
    expect(ids(paper.earlier)).toEqual(['old'])
  })

  it('keeps a stopped run of a paper nobody titled on its own, by its id', () => {
    const papers = groupRuns([
      run({ id: 'x1', paper: 'doi:10.1/X', status: 'error' }),
      run({ id: 'x2', paper: 'https://doi.org/10.1/x', status: 'error' }),
      run({ id: 'y', paper: '10.2/y', status: 'error' }),
    ])
    expect(papers).toHaveLength(2)
    expect(ids(papers[0].earlier)).toEqual(['x2'])
  })
})

describe('countsText', () => {
  const claim = (verdict?: 'supports' | 'refutes' | 'insufficient', extra: Partial<Claim> = {}): Claim =>
    ({ claim: 'c', citations: [{ title: 't', authors: [], year: '', doi: 'd', arxiv: '', url: '' }], verdicts: verdict ? [{ verdict }] : [], ...extra }) as Claim

  it('lists the worst first, with the badge wording, and leaves out zero counts', () => {
    const claims = [claim('supports'), claim('supports'), claim('supports'), claim('insufficient'), claim('insufficient'), claim('refutes')]
    expect(countsText(claims)).toBe('Source contradicts: 1 · Source is silent: 2 · Source backs it: 3')
  })

  it('counts a claim whose sources could not be read as not checked', () => {
    expect(countsText([claim(undefined, { unchecked: ['d'] })])).toBe('Not checked: 1')
  })

  it('counts claims with no citation, so the counts add up', () => {
    const uncited = claim(undefined, { citations: [] })
    expect(countsText([claim('supports'), uncited])).toBe('Source backs it: 1 · No citation: 1')
  })

  it('counts claims that only name what the paper used', () => {
    const named = claim(undefined, { named: ['d'] })
    expect(countsText([claim('refutes'), named])).toBe('Source contradicts: 1 · Names a tool or dataset: 1')
  })

  it('is empty when there are no claims', () => {
    expect(countsText([])).toBe('')
  })
})

describe('standingCount', () => {
  it('puts the count after the standing label', () => {
    expect(standingCount('refutes', 3)).toBe('Source contradicts: 3')
  })
})

describe('runTime', () => {
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  it('says when a finished run ended', () => {
    expect(runTime(run({ started: '2026-11-12T10:00:00Z', completed: '2026-11-12T10:30:00Z' }))).toBe(`Finished ${when('2026-11-12T10:30:00Z')}`)
  })

  it('says when a run started if it has not finished', () => {
    expect(runTime(run({ status: 'running', started: '2026-11-12T10:00:00Z' }))).toBe(`Started ${when('2026-11-12T10:00:00Z')}`)
  })

  it('says a finished run "Ran" when it kept no end time', () => {
    expect(runTime(run({ started: '2026-11-12T10:00:00Z' }))).toBe(`Ran ${when('2026-11-12T10:00:00Z')}`)
  })

  it('is empty when the run has no readable time', () => {
    expect(runTime(run({ started: 'not a date' }))).toBe('')
    expect(runTime(run({}))).toBe('')
  })
})

describe('byRunTime', () => {
  it('puts the run with the newest time first', () => {
    const runs = [
      run({ id: 'old', completed: '2026-11-01T10:00:00Z' }),
      run({ id: 'new', completed: '2026-11-12T10:00:00Z' }),
      run({ id: 'going', status: 'running', started: '2026-11-05T10:00:00Z' }),
    ]
    expect(ids([...runs].sort(byRunTime))).toEqual(['new', 'going', 'old'])
  })
})

describe('standingsIn', () => {
  it('reads the standings named in a ?standing= value, worst first', () => {
    expect(standingsIn('supports,refutes')).toEqual(['refutes', 'supports'])
  })

  it('ignores values that are not a standing, and a missing value', () => {
    expect(standingsIn('refutes,nonsense,')).toEqual(['refutes'])
    expect(standingsIn(null)).toEqual([])
  })
})
