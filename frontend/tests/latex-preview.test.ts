import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBib } from '../src/lib/bibtex.ts'
import { formatAuthors, formatReference, prepareSource, referenceNumbers } from '../src/lib/latexPreview.ts'
import { MOCK_DRAFTS } from '../src/mocks/author.ts'

test('prepareSource turns \\cite into markers, [?] for an unfinished one, and drops what LaTeX.js cannot take', () => {
  const src = String.raw`\documentclass{article}
\usepackage{hyperref}
\begin{document}
Text~\cite{a}. More~\citep[p.~4]{b, c}.
Typing~\cite{san
\input{intro}
\bibliographystyle{plainnat}
\bibliography{main}
\end{document}`
  const out = prepareSource(src)
  assert.ok(out.includes('Text~⟦c:a⟧.'))
  assert.ok(out.includes('More~⟦c:b⟧⟦c:c⟧.'))
  assert.ok(out.includes('Typing~⟦c:?⟧'))
  assert.ok(!out.includes('\\usepackage'))
  assert.ok(!out.includes('\\input'))
  assert.ok(!out.includes('\\bibliography'))
  assert.ok(out.includes('\\documentclass{article}'))
  assert.ok(out.includes('\\end{document}'))
})

test('referenceNumbers numbers the cited keys by first author, duplicates collapsed', () => {
  const bib = MOCK_DRAFTS[0].files.find((f) => f.name === 'main.bib')!
  const entries = parseBib(bib.content)
  const all = referenceNumbers(entries)
  assert.equal(all.size, 17)
  assert.equal(all.get('devlin2019'), 1)

  const cited = referenceNumbers(entries, new Set(['khattab2020', 'thakur2021', 'santhanam2022', 'nguyen2016', 'liu2023']))
  assert.deepEqual([...cited.entries()], [
    ['khattab2020', 1],
    ['nguyen2016', 2],
    ['santhanam2022', 3],
    ['thakur2021', 4],
  ])
})

test('formatAuthors and formatReference write a plainnat-style entry', () => {
  assert.equal(formatAuthors('Khattab, Omar and Zaharia, Matei'), 'O. Khattab and M. Zaharia')
  assert.equal(formatAuthors('Thakur, Nandan and Reimers, Nils and R{\\"u}ckl{\\\'e}, Andreas and Srivastava, Abhishek'), 'N. Thakur et al.')
  assert.equal(formatAuthors('Stephen Robertson'), 'S. Robertson')
  const [entry] = parseBib(String.raw`@inproceedings{khattab2020,
  title = {ColBERT: Efficient and Effective Passage Search.},
  author = {Khattab, Omar and Zaharia, Matei},
  booktitle = {SIGIR},
  year = {2020},
}`)
  assert.equal(formatReference(entry), 'O. Khattab and M. Zaharia. ColBERT: Efficient and Effective Passage Search. SIGIR, 2020.')
})
