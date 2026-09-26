import assert from 'node:assert/strict'
import test from 'node:test'

import { findCites, parseProject, replaceCiteKey, sentenceStart } from '../src/lib/latexProject.ts'
import type { ProjectFile } from '../src/types/draftCheck.ts'
import { INTRO_TEX, MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis.ts'

const tex = (name: string, content: string): ProjectFile => ({ name, kind: 'tex', content })
const bib = (name: string, content: string): ProjectFile => ({ name, kind: 'bib', content })

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

test('parseProject derives the four Draft check warnings from the thesis project text', () => {
  const files = [tex('related-work.tex', RELATED_WORK_TEX), tex('intro.tex', INTRO_TEX), bib('main.bib', MAIN_BIB)]
  const result = parseProject(files)
  assert.equal(result.texFiles, 2)
  assert.equal(result.citeCommands, 8)
  assert.equal(result.bibEntries, 7)
  assert.deepEqual(
    result.warnings.map((w) => [w.type, w.detail]),
    [
      ['missing-key', '\\cite{liu2023} in related-work.tex L37'],
      ['missing-key', '\\cite{devlin2019} in intro.tex L2'],
      ['duplicate-key', 'santhanam2022 defined twice'],
      ['unused-entry', 'karpukhin2020 is never cited'],
      ['no-doi-url', 'nguyen2016'],
    ],
  )
  assert.equal(result.warnings[2].file, 'main.bib')
})

test('sentenceStart walks up to the first line of a sentence that runs on', () => {
  const content = 'One.\nTwo runs\nonto this line~\\cite{a}.\n\\section{X}\nThree~\\cite{b}.'
  assert.equal(sentenceStart(content, 3), 2)
  assert.equal(sentenceStart(content, 5), 5)
})

test('replaceCiteKey swaps one key and keeps the others in the same command', () => {
  assert.equal(replaceCiteKey('a~\\cite{x, y}.', 1, 'y', 'z'), 'a~\\cite{x, z}.')
  assert.equal(replaceCiteKey('a~\\cite{x}.\nb~\\cite{x}.', 2, 'x', 'q'), 'a~\\cite{x}.\nb~\\cite{q}.')
  assert.equal(replaceCiteKey('a~\\cite{x}.', 9, 'x', 'q'), 'a~\\cite{x}.')
})
