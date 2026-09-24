import assert from 'node:assert/strict'
import test from 'node:test'

import { findCites, parseProject, replaceCiteKey } from '../src/lib/latexProject.ts'
import { MOCK_DRAFTS } from '../src/mocks/author.ts'
import type { ProjectFile } from '../src/types/draftCheck.ts'

const tex = (name: string, content: string): ProjectFile => ({ name, kind: 'tex', content, dirty: false })
const bib = (name: string, content: string): ProjectFile => ({ name, kind: 'bib', content, dirty: false })

test('findCites lists every key of every \\cite with its line, and skips an unfinished one', () => {
  const refs = findCites(tex('a.tex', 'One~\\cite{x}.\nTwo~\\citep[p.~4]{y, z}.\nTyping \\cite{par'))
  assert.deepEqual(
    refs.map((r) => [r.key, r.line]),
    [
      ['x', 1],
      ['y', 2],
      ['z', 2],
    ],
  )
  assert.equal(refs[0].column, 11)
})

test('parseProject derives the four Draft check warnings from the d1 project text', () => {
  const d1 = MOCK_DRAFTS.find((d) => d.id === 'd1')!
  const result = parseProject(d1.files)
  assert.equal(result.texFiles, 3)
  assert.equal(result.citeCommands, 13)
  assert.equal(result.bibEntries, 18)
  assert.deepEqual(
    result.warnings.map((w) => w.type),
    ['missing-key', 'duplicate-key', 'unused-entry', 'no-doi-url'],
  )
  assert.equal(result.warnings[0].detail, '\\cite{liu2023} in intro.tex L18')
  assert.equal(result.warnings[1].detail, 'santhanam2022 defined twice')
  assert.match(result.warnings[2].detail, /^karpukhin2020 and 5 others are never cited$/)
  assert.equal(result.warnings[3].detail, 'nguyen2016, thakur2021')
  assert.equal(result.warnings[3].file, 'main.bib')
})

test('parseProject on a draft with no .bib reports every cite as missing', () => {
  const result = parseProject([tex('abstract.tex', 'A~\\cite{khattab2020}.'), bib('empty.bib', '')])
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].type, 'missing-key')
})

test('replaceCiteKey swaps one key on one line and leaves the others alone', () => {
  const content = 'A~\\cite{old}.\nB~\\cite{keep, old}.\nC~\\cite{old}.'
  const next = replaceCiteKey(content, 2, 'old', 'new')
  assert.equal(next, 'A~\\cite{old}.\nB~\\cite{keep, new}.\nC~\\cite{old}.')
  assert.equal(replaceCiteKey(content, 1, 'absent', 'new'), content)
  assert.equal(replaceCiteKey(content, 99, 'old', 'new'), content)
})
