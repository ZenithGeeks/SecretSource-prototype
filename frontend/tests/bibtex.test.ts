import assert from 'node:assert/strict'
import test from 'node:test'

import { duplicateKeys, lacksLocator, parseBib, serializeBib, shortAuthors } from '../src/lib/bibtex.ts'

const SAMPLE = `% a comment line
@inproceedings{khattab2020,
  title = {ColBERT: Efficient and {Effective} Passage Search},
  author = {Khattab, Omar and Zaharia, Matei},
  year = 2020,
  doi = "10.1145/3397271.3401075"
}

@article{nguyen2016,
  title={MS MARCO},
  author={Nguyen, Tri and Rosenberg, Mir and Song, Xia},
  year={2016}
}

@inproceedings{khattab2020,
  title = {duplicate},
  year = {2020},
}
`

test('parseBib reads entries, nested braces, quoted and bare values, and line numbers', () => {
  const entries = parseBib(SAMPLE)
  assert.equal(entries.length, 3)
  const [first, second, third] = entries
  assert.equal(first.type, 'inproceedings')
  assert.equal(first.key, 'khattab2020')
  assert.equal(first.line, 2)
  assert.equal(first.fields.title, 'ColBERT: Efficient and {Effective} Passage Search')
  assert.equal(first.fields.year, '2020')
  assert.equal(first.fields.doi, '10.1145/3397271.3401075')
  assert.equal(second.key, 'nguyen2016')
  assert.equal(second.line, 9)
  assert.equal(third.fields.title, 'duplicate')
})

test('duplicateKeys and lacksLocator flag what Parsed draft warns about', () => {
  const entries = parseBib(SAMPLE)
  assert.deepEqual(duplicateKeys(entries), ['khattab2020'])
  assert.equal(lacksLocator(entries[0]), false)
  assert.equal(lacksLocator(entries[1]), true)
})

test('lacksLocator accepts the locator fields the gateway does: doi, url, eprint, arxiv', () => {
  const [doi, url, eprint, arxiv, none] = parseBib(
    [
      '@article{a, title={A}, doi={10.1/a}}',
      '@misc{b, title={B}, url={https://example.org/b}}',
      '@misc{c, title={C}, eprint={2112.01488}}',
      '@misc{d, title={D}, arxiv={2004.12832}}',
      '@misc{e, title={E}, arxivid={2004.12832}}',
    ].join('\n'),
  )
  assert.deepEqual([doi, url, eprint, arxiv].map(lacksLocator), [false, false, false, false])
  assert.equal(lacksLocator(none), true) // `arxivid` is not a field the gateway reads
})

test('serializeBib round-trips through parseBib', () => {
  const [entry] = parseBib(SAMPLE)
  const text = serializeBib(entry)
  const [again] = parseBib(text)
  assert.deepEqual(again.fields, entry.fields)
  assert.equal(again.key, entry.key)
})

test('shortAuthors abbreviates the way the design does', () => {
  assert.equal(shortAuthors('Khattab, Omar and Zaharia, Matei'), 'Khattab & Zaharia')
  assert.equal(shortAuthors('Santhanam, Keshav and Khattab, Omar and Zaharia, Matei'), 'Santhanam et al.')
  assert.equal(shortAuthors('Stephen Robertson'), 'Robertson')
  assert.equal(shortAuthors(''), '')
})
