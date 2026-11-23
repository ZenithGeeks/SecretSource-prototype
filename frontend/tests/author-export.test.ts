import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, unzipSync } from 'fflate'

import { annotationFor, buildAnnotatedTex, buildProjectZip, buildUpdatedBib, mergeEntries, slug } from '../src/lib/authorExport.ts'
import { parseBib } from '../src/lib/bibtex.ts'
import type { Citation, Draft } from '../src/types/draftCheck.ts'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis.ts'

const draft: Draft = {
  id: 'd1',
  projectId: null,
  title: 'Related work — thesis ch.2',
  version: 3,
  files: [
    { name: 'related-work.tex', kind: 'tex', content: RELATED_WORK_TEX },
    { name: 'main.bib', kind: 'bib', content: MAIN_BIB },
  ],
  pdfs: {},
  status: { checked: 0, counts: { supports: 0, refutes: 0, insufficient: 0, unavailable: 0, unchecked: 0 }, open: 0 },
  lastCheckedAt: null,
  lastCheckId: null,
  runningCheckId: null,
  sinceLastCheck: null,
  checks: 0,
  created: '',
  updated: '',
  savedAt: '',
}

const contradicted: Citation = {
  id: 'c1',
  key: 'khattab2020',
  file: 'related-work.tex',
  line: 24,
  column: 30,
  sentence: 'ColBERTv2 further reduces index size by $6$--$10\\times$ while matching retrieval quality~\\cite{khattab2020}.',
  claim: 'ColBERTv2 further reduces index size by 6–10× while matching retrieval quality.',
  verdict: 'refutes',
  evidence: { passage: 'we leave compression to future work', pdf: 'colbert.pdf', page: 7 },
  explanation: 'The 2020 paper defers compression.',
}

test('buildUpdatedBib merges the duplicate key and carries a DOI from either copy', () => {
  const text = buildUpdatedBib(draft, new Date('2026-09-25T00:00:00Z'))
  const entries = parseBib(text)
  assert.equal(entries.length, 6)
  assert.equal(entries.filter((e) => e.key === 'santhanam2022').length, 1)
  assert.equal(entries.find((e) => e.key === 'santhanam2022')?.fields.doi, '10.18653/v1/2022.naacl-main.272')
  assert.match(text, /^% Related work — thesis ch\.2 — bibliography updated by SecretSource on 2026-09-25/)
})

test('mergeEntries keeps the first definition and fills gaps from later ones', () => {
  const merged = mergeEntries([
    { type: 'article', key: 'k', fields: { title: 'A', year: '2020' }, line: 1 },
    { type: 'article', key: 'k', fields: { title: 'B', doi: '10/x' }, line: 9 },
  ])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].fields, { title: 'A', year: '2020', doi: '10/x' })
})

test('buildAnnotatedTex writes a comment above each open issue and a summary on top', () => {
  const silent: Citation = { ...contradicted, id: 'c2', key: 'thakur2021', line: 26, verdict: 'insufficient', evidence: undefined, explanation: 'BEIR is silent on it.' }
  const resolved: Citation = { ...contradicted, id: 'c3', line: 22, resolution: { kind: 'overridden', note: 'fine', at: '' } }
  const out = buildAnnotatedTex(draft.files[0], [contradicted, silent, resolved])
  const lines = out.split('\n')
  assert.equal(lines[0], '% SecretSource: 2 open issues in 7 \\cite of this file')
  // the comment sits right above the flagged line (one line down, after the summary)
  assert.equal(lines[24], '% SecretSource: Source contradicts (colbert.pdf p.7) — \\cite{khattab2020}: The 2020 paper defers compression.')
  assert.ok(lines[25].includes('\\cite{khattab2020}'))
  assert.equal(lines[27], '% SecretSource: Source is silent — \\cite{thakur2021}: BEIR is silent on it.')
  assert.equal(out.split('\n').filter((l) => l.startsWith('% SecretSource')).length, 3)
})

test('buildAnnotatedTex leaves a file with no open issues untouched', () => {
  assert.equal(buildAnnotatedTex(draft.files[0], []), draft.files[0].content)
})

test('annotationFor explains an unavailable source and a missing key', () => {
  assert.equal(
    annotationFor({ ...contradicted, verdict: 'unavailable', evidence: undefined, explanation: undefined, message: 'no free copy published' }),
    '% SecretSource: Source unavailable — \\cite{khattab2020}: The source could not be read: no free copy published.',
  )
  assert.equal(
    annotationFor({ ...contradicted, verdict: 'unchecked', evidence: undefined, explanation: undefined, reason: 'missing-key' }),
    '% SecretSource: Not checked — \\cite{khattab2020}: No entry in the bibliography.',
  )
  const nothingToLookUp = { reason: 'no-locator', message: 'Add a DOI, URL or title to check this source' }
  assert.equal(
    annotationFor({ ...contradicted, verdict: 'unchecked', evidence: undefined, explanation: undefined, ...nothingToLookUp }),
    '% SecretSource: Not checked — \\cite{khattab2020}: Add a DOI, URL or title to check this source.',
  )
})

test('annotationFor says when no index knows the cited DOI, or the bib entry disagrees with it', () => {
  assert.equal(
    annotationFor({ ...contradicted, verdict: 'unavailable', evidence: undefined, explanation: undefined, message: 'no free copy published', exists: 'no' }),
    '% SecretSource: Source unavailable — \\cite{khattab2020}: The source could not be read: no free copy published. Neither Crossref nor OpenAlex knows this DOI, so the reference may not exist. Check the DOI and that the paper is real.',
  )
  assert.match(
    annotationFor({ ...contradicted, exists: 'yes', index: 'Crossref', mismatches: ['year: the .bib says 2021, Crossref says 2023'] }),
    / The .bib entry disagrees with Crossref: year: the .bib says 2021, Crossref says 2023\.$/,
  )
})

test('annotationFor says when no index lists a cited title (#439)', () => {
  assert.match(
    annotationFor({ ...contradicted, exists: 'no', lookedUpBy: 'title' }),
    / No index \(Crossref, OpenAlex, arXiv or Semantic Scholar\) lists a work with this title and first author, so the reference may not exist\./,
  )
  assert.match(annotationFor({ ...contradicted, exists: 'unknown', lookedUpBy: 'title' }), /whether this work exists\.$/)
  assert.doesNotMatch(annotationFor({ ...contradicted, exists: 'yes', index: 'arXiv', lookedUpBy: 'title' }), /index|exist/)
})

test('buildProjectZip holds every project file with its current text', () => {
  const zip = buildProjectZip(draft)
  assert.equal(zip.type, 'application/zip')
  return zip.arrayBuffer().then((buffer) => {
    const files = unzipSync(new Uint8Array(buffer))
    assert.deepEqual(Object.keys(files).sort(), ['main.bib', 'related-work.tex'])
    assert.equal(strFromU8(files['related-work.tex']), RELATED_WORK_TEX)
  })
})

test('buildProjectZip adds the draft figures at their paths, bytes unchanged', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
  return buildProjectZip(draft, [{ name: 'figures/posv.png', content: png }])
    .arrayBuffer()
    .then((buffer) => {
      const files = unzipSync(new Uint8Array(buffer))
      assert.deepEqual(Object.keys(files).sort(), ['figures/posv.png', 'main.bib', 'related-work.tex'])
      assert.deepEqual([...files['figures/posv.png']], [...png])
    })
})

test('buildProjectZip also puts a figure where \\includegraphics names it, so the export compiles', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7])
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 8])
  const tex = [
    '\\includegraphics[width=0.5\\textwidth]{figures/posv}', // no extension, found by file name
    '\\includegraphics{./plots/arch.pdf}',
    '\\includegraphics{../outside/posv}', // outside the project: no entry for it
    '% \\includegraphics{commented/posv}',
    '\\includegraphics{missing}',
  ].join('\n')
  const withTex: Draft = { ...draft, files: [{ name: 'main.tex', kind: 'tex', content: tex }] }
  return buildProjectZip(withTex, [{ name: 'posv.png', content: png }, { name: 'arch.pdf', content: pdf }])
    .arrayBuffer()
    .then((buffer) => {
      const files = unzipSync(new Uint8Array(buffer))
      assert.deepEqual(Object.keys(files).sort(), ['arch.pdf', 'figures/posv.png', 'main.tex', 'plots/arch.pdf', 'posv.png'])
      assert.deepEqual([...files['figures/posv.png']], [...png])
      assert.deepEqual([...files['plots/arch.pdf']], [...pdf])
    })
})

test('slug makes a safe file name', () => {
  assert.equal(slug('Related work — thesis ch.2'), 'related-work-thesis-ch-2')
  assert.equal(slug('   '), 'draft')
})
