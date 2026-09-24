import assert from 'node:assert/strict'
import test from 'node:test'

import { checkedLabel, setMockLatency, authorApi, ReportUnavailable } from '../src/lib/author.ts'
import { authorStore } from '../src/lib/authorStore.ts'
import { findCites } from '../src/lib/latexProject.ts'
import { MOCK_CITATIONS, MOCK_DRAFTS, MOCK_SEARCH_RESULTS } from '../src/mocks/author.ts'

test('every mock citation points at a line that really holds its \\cite key', () => {
  for (const citation of MOCK_CITATIONS) {
    const draft = MOCK_DRAFTS.find((d) => d.id === citation.draftId)
    const file = draft?.files.find((f) => f.name === citation.file)
    assert.ok(file, `${citation.id}: ${citation.file} exists in ${citation.draftId}`)
    const hit = findCites(file).some((r) => r.key === citation.key && r.line === citation.line)
    assert.ok(hit, `${citation.id}: \\cite{${citation.key}} on ${citation.file} L${citation.line}`)
  }
})

test('every \\cite in a mock project has exactly one citation record', () => {
  for (const draft of MOCK_DRAFTS) {
    const refs = draft.files.filter((f) => f.kind === 'tex').flatMap((f) => findCites(f))
    const records = MOCK_CITATIONS.filter((c) => c.draftId === draft.id)
    assert.equal(records.length, refs.length, `${draft.id}: ${refs.length} cites, ${records.length} records`)
  }
})

test('d1 counts agree with the design: 12 checked, 3 open, and the suggested fix is for the refuted one', () => {
  authorStore.reset()
  const run = authorStore.checkRun('d1')!
  assert.equal(run.draft.status.checked, 12)
  assert.equal(run.draft.status.open, 3)
  assert.deepEqual(run.draft.status.counts, { supports: 9, insufficient: 1, refutes: 1, unavailable: 1, unchecked: 1 })
  assert.deepEqual(
    run.issues.map((c) => [c.key, c.verdict]),
    [
      ['khattab2020', 'refutes'],
      ['thakur2021', 'insufficient'],
      ['nguyen2016', 'unavailable'],
    ],
  )
  const suggested = MOCK_SEARCH_RESULTS.find((r) => r.suggestedForCitationId)!
  assert.equal(run.issues[0].id, suggested.suggestedForCitationId)
  assert.equal(run.issues[0].suggestedReplacement?.key, suggested.key)
  assert.equal(authorStore.parse('d1').warnings.length, 4)
})

test('the other drafts read as "all supported" and "not checked"', () => {
  authorStore.reset()
  const [, d2, d3] = authorStore.drafts()
  assert.equal(d2.status.open, 0)
  assert.equal(d2.status.checked, 2)
  assert.equal(d3.status.checked, 0)
})

test('replaceCitation rewrites the \\cite, keeps the bib when the key exists, resolves the issue, advances', () => {
  authorStore.reset()
  const before = authorStore.draft('d1')!
  const bibBefore = before.files.find((f) => f.name === 'main.bib')!.content
  const issue = authorStore.nextOpenIssue('d1')!
  assert.equal(issue.id, 'c10')

  const replaced = authorStore.replaceCitation(issue.id, issue.suggestedReplacement!)
  const draft = authorStore.draft('d1')!
  const related = draft.files.find((f) => f.name === 'related-work.tex')!
  assert.match(related.content.split('\n')[9], /\\cite\{santhanam2022\}/)
  assert.doesNotMatch(related.content.split('\n')[9], /khattab2020/)
  assert.match(related.content.split('\n')[7], /\\cite\{khattab2020\}/, 'the supported cite two lines up is untouched')
  assert.equal(related.dirty, true)
  assert.equal(draft.files.find((f) => f.name === 'main.bib')!.content, bibBefore, 'santhanam2022 was already in main.bib')
  assert.equal(replaced.verdict, 'supports')
  assert.equal(replaced.key, 'santhanam2022')
  assert.equal(replaced.resolution?.kind, 'replaced')
  assert.equal(replaced.resolution?.previousKey, 'khattab2020')
  assert.equal(draft.status.open, 2)
  assert.equal(authorStore.nextOpenIssue('d1', issue.id)?.id, 'c11')
})

test('replaceCitation appends the bib entry when the key is new', () => {
  authorStore.reset()
  const plaid = MOCK_SEARCH_RESULTS.find((r) => r.key === 'santhanam2022plaid')!
  authorStore.replaceCitation('c11', plaid)
  const draft = authorStore.draft('d1')!
  const bib = draft.files.find((f) => f.name === 'main.bib')!
  assert.ok(bib.content.includes('@inproceedings{santhanam2022plaid,'))
  assert.equal(bib.dirty, true)
  assert.ok(authorStore.bibKeys('d1').includes('santhanam2022plaid'))
  assert.equal(authorStore.parse('d1').bibEntries, 19)
})

test('overrideCitation closes the issue with a note and reopenCitation undoes it', () => {
  authorStore.reset()
  authorStore.overrideCitation('c11', 'BEIR Table 3 shows it')
  assert.equal(authorStore.draft('d1')!.status.open, 2)
  assert.equal(authorStore.citations('d1').find((c) => c.id === 'c11')?.resolution?.note, 'BEIR Table 3 shows it')
  authorStore.reopenCitation('c11')
  assert.equal(authorStore.draft('d1')!.status.open, 3)
})

test('updateFile keeps citations on their \\cite when lines move, and unchecks a deleted one', () => {
  authorStore.reset()
  const file = authorStore.draft('d1')!.files.find((f) => f.name === 'related-work.tex')!
  const lines = file.content.split('\n')
  lines.splice(6, 0, 'A new sentence with no citation.', '')
  const without = lines.filter((l) => !l.includes('thakur2021'))
  authorStore.updateFile('d1', 'related-work.tex', without.join('\n'))

  const citations = authorStore.citations('d1')
  assert.equal(citations.find((c) => c.id === 'c9')?.line, 10)
  assert.equal(citations.find((c) => c.id === 'c10')?.line, 12)
  assert.equal(citations.find((c) => c.id === 'c11')?.verdict, 'unchecked')
  assert.equal(authorStore.draft('d1')!.status.open, 2)
  assert.equal(authorStore.draft('d1')!.files.find((f) => f.name === 'related-work.tex')!.dirty, true)
})

test('attachSourcePdf then recheck turns an unavailable source into a verdict', () => {
  authorStore.reset()
  authorStore.attachSourcePdf('c13', 'msmarco.pdf')
  assert.equal(authorStore.citations('d1').find((c) => c.id === 'c13')?.verdict, 'unchecked')
  const run = authorStore.recheck('d1')
  assert.equal(run.citations.find((c) => c.id === 'c13')?.verdict, 'supports')
  assert.equal(run.citations.find((c) => c.id === 'c8')?.verdict, 'unchecked', 'liu2023 still has no bib entry')
  assert.ok(run.draft.lastCheckedAt)
})

test('saveDraft clears dirty flags and bumps the version once', () => {
  authorStore.reset()
  assert.equal(authorStore.saveDraft('d1').version, 3, 'nothing dirty, nothing to save')
  authorStore.updateFile('d1', 'intro.tex', '% edited\n')
  assert.equal(authorStore.saveDraft('d1').version, 4)
  assert.ok(authorStore.draft('d1')!.files.every((f) => !f.dirty))
})

test('search ranks the suggested fix first and suggestedKeys lists what the bib lacks', () => {
  authorStore.reset()
  assert.equal(authorStore.search('')[0].key, 'santhanam2022')
  assert.deepEqual(
    authorStore.search('plaid').map((r) => r.key),
    ['santhanam2022plaid'],
  )
  assert.deepEqual(
    authorStore.suggestedKeys('d1').map((r) => r.key),
    ['santhanam2022plaid'],
  )
})

test('createDraft and deleteAll leave the store usable', () => {
  authorStore.reset()
  const created = authorStore.createDraft('  ')
  assert.equal(created.title, 'Untitled draft')
  assert.equal(authorStore.drafts()[0].id, created.id)
  authorStore.deleteAll()
  assert.equal(authorStore.drafts().length, 1)
  assert.equal(authorStore.drafts()[0].status.checked, 0)
  assert.equal(authorStore.citations(authorStore.drafts()[0].id).length, 0)
})

test('authorApi resolves through the store and the report is unavailable', async () => {
  setMockLatency(0)
  authorStore.reset()
  const drafts = await authorApi.getDrafts()
  assert.equal(drafts.length, 3)
  const check = await authorApi.getCheck('d1')
  assert.equal(check?.issues.length, 3)
  assert.equal(await authorApi.getCheck('nope'), undefined)
  assert.equal((await authorApi.search('beir'))[0].key, 'thakur2021')
  await assert.rejects(() => authorApi.exportReport('d1'), ReportUnavailable)
})

test('checkedLabel words match the drafts list', () => {
  const now = Date.parse('2026-09-25T12:00:00Z')
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  assert.equal(checkedLabel(null, now), 'not checked yet')
  assert.equal(checkedLabel(ago(0), now), 'checked just now')
  assert.equal(checkedLabel(ago(2), now), 'checked 2 min ago')
  assert.equal(checkedLabel(ago(3 * 60), now), 'checked 3 h ago')
  assert.equal(checkedLabel(ago(24 * 60), now), 'checked yesterday')
  assert.equal(checkedLabel(ago(5 * 24 * 60), now), 'checked 5 days ago')
})
