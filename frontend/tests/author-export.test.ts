import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, unzipSync } from 'fflate'

import { authorStore } from '../src/lib/authorStore.ts'
import { annotationFor, buildAnnotatedTex, buildProjectZip, buildUpdatedBib, mergeEntries, slug } from '../src/lib/authorExport.ts'
import { parseBib } from '../src/lib/bibtex.ts'
import { MOCK_SEARCH_RESULTS } from '../src/mocks/author.ts'

test('buildUpdatedBib merges the duplicate key and carries a DOI from either copy', () => {
  authorStore.reset()
  const draft = authorStore.draft('d1')!
  const text = buildUpdatedBib(draft, new Date('2026-09-25T00:00:00Z'))
  const entries = parseBib(text)
  assert.equal(entries.length, 17)
  assert.equal(entries.filter((e) => e.key === 'santhanam2022').length, 1)
  assert.equal(entries.find((e) => e.key === 'santhanam2022')?.fields.doi, '10.18653/v1/2022.naacl-main.272')
  assert.match(text, /^% Related work — thesis ch\.2 — bibliography updated by SecretSource on 2026-09-25/)
})

test('buildUpdatedBib includes an entry added by "Replace with …"', () => {
  authorStore.reset()
  const plaid = MOCK_SEARCH_RESULTS.find((r) => r.key === 'santhanam2022plaid')!
  authorStore.replaceCitation('c11', plaid)
  const entries = parseBib(buildUpdatedBib(authorStore.draft('d1')!))
  assert.ok(entries.some((e) => e.key === 'santhanam2022plaid'))
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
  authorStore.reset()
  const run = authorStore.checkRun('d1')!
  const file = run.draft.files.find((f) => f.name === 'related-work.tex')!
  const out = buildAnnotatedTex(file, run.citations)
  const lines = out.split('\n')
  assert.equal(lines.length, file.content.split('\n').length + 4)
  assert.equal(lines[0], '% SecretSource: 3 open issues in 5 \\cite of this file')
  // Original line 10 is now line 11, with its comment on line 10 (three lines inserted above it: summary + comment).
  assert.match(lines[10], /^% SecretSource: Source contradicts \(0\.88 confidence\) — \\cite\{khattab2020\}: The 6–10× reduction/)
  assert.match(lines[11], /matching retrieval quality~\\cite\{khattab2020\}\./)
  assert.match(lines[13], /^% SecretSource: Source is silent \(0\.61 confidence\) — \\cite\{thakur2021\}/)
  assert.match(lines[19], /^% SecretSource: Not checked — \\cite\{nguyen2016\}: No open-access PDF/)
  assert.ok(!out.includes('SecretSource: Source backs it'), 'supported citations get no comment')
})

test('buildAnnotatedTex leaves a file with no open issues untouched', () => {
  authorStore.reset()
  const run = authorStore.checkRun('d1')!
  const file = run.draft.files.find((f) => f.name === 'main.tex')!
  assert.equal(buildAnnotatedTex(file, run.citations), file.content)
})

test('annotationFor leaves the confidence out when the check had none', () => {
  authorStore.reset()
  const c13 = authorStore.citations('d1').find((c) => c.id === 'c13')!
  assert.equal(annotationFor(c13).startsWith('% SecretSource: Not checked — \\cite{nguyen2016}: '), true)
})

test('buildProjectZip holds every project file with its current text', async () => {
  authorStore.reset()
  const draft = authorStore.draft('d1')!
  const blob = buildProjectZip(draft)
  assert.equal(blob.type, 'application/zip')
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(Object.keys(files).sort(), ['intro.tex', 'main.bib', 'main.tex', 'related-work.tex'])
  assert.equal(strFromU8(files['related-work.tex']), draft.files.find((f) => f.name === 'related-work.tex')!.content)
})

test('slug makes a safe file name', () => {
  assert.equal(slug('Related work — thesis ch.2'), 'related-work-thesis-ch-2')
  assert.equal(slug('   '), 'draft')
})
