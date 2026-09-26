import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBib } from '../src/lib/bibtex.ts'
import { expandNewcommands, formatAuthors, formatReference, prepareSource, referenceNumbers, REWRITES } from '../src/lib/latexPreview.ts'
import { MAIN_BIB, RELATED_WORK_TEX } from './fixtures/thesis.ts'

test('prepareSource turns \\cite into markers, [?] for an unfinished one, and drops what LaTeX.js cannot take', () => {
  const src = String.raw`\documentclass{article}
\usepackage{hyperref}
\usepackage{tikz}
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
  assert.ok(out.includes('\\usepackage{hyperref}'), 'a built-in package stays')
  assert.ok(!out.includes('tikz'), 'a package LaTeX.js cannot load is dropped')
  assert.ok(!out.includes('\\input'))
  assert.ok(!out.includes('\\bibliography'))
  assert.ok(out.includes('\\documentclass{article}'))
  assert.ok(out.includes('\\end{document}'))
})

test('prepareSource rewrites the thesis chapter the way REWRITES documents', () => {
  const out = prepareSource(RELATED_WORK_TEX)
  assert.ok(out.includes('\\[\n  S(q, d) = \\sum_{i \\in q} \\max_{j \\in d} E_{q_i} \\cdot E_{d_j}\n\\]') || /\\\[\s*S\(q, d\)[\s\S]*?\\\]/.test(out), 'equation → \\[ \\]')
  assert.ok(!/\\label\{eq:maxsim\}/.test(out), 'the label inside math is removed')
  assert.ok(/\\\[\\begin\{aligned\}[\s\S]*a &= b \+ c[\s\S]*\\end\{aligned\}\\\]/.test(out), 'align → aligned inside display math')
  assert.ok(!out.includes('\\begin{figure}') && out.includes('\\begin{center}'), 'figure → center')
  assert.ok(out.includes('\\ssgraphic{figures/architecture.pdf}'), 'includegraphics → the custom box')
  assert.ok(!out.includes('\\begin{tabular}'))
  assert.ok(out.includes('\\texttt{ColBERT │ 0.40 │ 154}'), 'tabular rows → text rows')
  assert.ok(!out.includes('\\toprule'))
  assert.ok(out.includes('ColBERT{} keeps one vector') || out.includes('ColBERT keeps one vector'), '\\colbert expanded')
  assert.ok(out.includes('(e.g.\\ 768 dimensions)'), '\\eg{...} expanded with its argument')
  assert.ok(!out.includes('\\newcommand'))
  assert.ok(!out.includes('\\usepackage{booktabs}'))
  assert.ok(!out.includes('\\usepackage{amsmath}'), 'amsmath is not loadable either; KaTeX handles the math')
  assert.ok(out.includes('\\usepackage{hyperref}'))
  assert.ok(REWRITES.some((r) => r.construct.startsWith('equation')))
})

test('expandNewcommands handles no-argument and positional bodies and leaves the rest alone', () => {
  const src = String.raw`\newcommand{\vc}{vector}
\newcommand{\pair}[2]{(#1, #2)}
\renewcommand{\emph}[1]{\textit{#1}}
A \vc{} and \pair{a}{b} and \emph{x} and \unknown{y}.`
  const out = expandNewcommands(src)
  assert.equal(out.trim(), String.raw`A vector{} and (a, b) and \textit{x} and \unknown{y}.`)
})

test('referenceNumbers numbers the cited keys by first author, duplicates collapsed', () => {
  const entries = parseBib(MAIN_BIB)
  assert.equal(entries.length, 7)
  const all = referenceNumbers(entries)
  assert.equal(all.size, 6)
  assert.equal(all.get('karpukhin2020'), 1)

  const cited = referenceNumbers(entries, new Set(['khattab2020', 'thakur2021', 'santhanam2022', 'nguyen2016', 'liu2023', 'robertson2009']))
  assert.deepEqual([...cited.entries()], [
    ['khattab2020', 1],
    ['nguyen2016', 2],
    ['robertson2009', 3],
    ['santhanam2022', 4],
    ['thakur2021', 5],
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
