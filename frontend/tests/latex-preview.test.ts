import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBib } from '../src/lib/bibtex.ts'
import { expandNewcommands, formatAuthors, formatReference, preparePreview, prepareSource, referenceNumbers, REWRITES } from '../src/lib/latexPreview.ts'
import { BUNDLED_PACKAGES_TEX, MAIN_BIB, RELATED_WORK_TEX, UNSUPPORTED_PREAMBLE_TEX } from './fixtures/thesis.ts'

const lines = (text: string) => text.split('\n').length

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

test('preparePreview keeps the line count of every file it rewrites', () => {
  for (const source of [RELATED_WORK_TEX, UNSUPPORTED_PREAMBLE_TEX, BUNDLED_PACKAGES_TEX, 'no document here\n\\usepackage{tikz}\nfragment', '']) {
    const { source: out } = preparePreview(source)
    assert.equal(lines(out), lines(source), `line count changed for: ${source.slice(0, 40)}`)
  }
  // multi-line environments fold onto one line and are padded with comment lines
  const folded = preparePreview('\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\nafter')
  assert.equal(lines(folded.source), 5)
  // the two-line body keeps its own newline; the two lines the \begin/\end took become comments
  assert.equal(folded.source, '\\[\\begin{aligned}a &= b \\\\\nc &= d\\end{aligned}\\]%\n%\n\nafter')
  const table = preparePreview('\\begin{tabular}{lr}\na & 1 \\\\\nb & 2 \\\\\n\\end{tabular}\nafter')
  assert.equal(lines(table.source), 5)
  assert.ok(table.source.includes('\\texttt{a │ 1}\\\\ \\texttt{b │ 2}'))
  const multi = preparePreview('\\newcommand{\\long}{one\n  two}\nA \\long{} B')
  assert.equal(lines(multi.source), 3)
  assert.ok(multi.source.includes('A one two{} B'))
})

test('preparePreview keeps only what LaTeX.js accepts before \\begin{document} and names the rest', () => {
  const { source, ignored } = preparePreview(UNSUPPORTED_PREAMBLE_TEX)
  const preamble = source.slice(0, source.indexOf('\\begin{document}'))
  assert.ok(preamble.includes('\\documentclass[11pt]{article}'))
  assert.ok(preamble.includes('\\title{Two columns}'))
  assert.ok(preamble.includes('\\usepackage{hyperref}'), 'the built-in package survives out of a mixed \\usepackage')
  for (const gone of ['geometry', 'booktabs', 'newtheorem', 'DeclareMathOperator', 'hypersetup', 'colorlinks'])
    assert.ok(!preamble.includes(gone), `${gone} should be dropped`)
  assert.deepEqual(ignored, ['geometry', 'booktabs', '\\newtheorem', '\\DeclareMathOperator', '\\hypersetup'])
  assert.ok(preamble.includes('\\usepackage{multicol}'), 'a bundled package loads as written')
  assert.ok(source.includes('\\begin{multicols}{2}'), 'multicols is left for LaTeX.js, which renders real columns')
  assert.ok(source.includes('Left column text.'))
  // the bundled packages and a \setcounter LaTeX.js knows pass untouched
  const bundled = preparePreview(BUNDLED_PACKAGES_TEX)
  assert.deepEqual(bundled.ignored, [])
  for (const line of ['\\usepackage{textgreek}', '\\usepackage{gensymb}', '\\usepackage{multicol}', '\\setcounter{secnumdepth}{2}'])
    assert.ok(bundled.source.includes(line), `${line} should survive`)
  // a multi-line \usepackage: the options span lines, the built-in package stays
  const wrappedSource = '\\documentclass{article}\n\\usepackage[\n  a4paper,\n  margin=2cm\n]{geometry}\n\\usepackage[\n  colorlinks]{hyperref}\n\\begin{document}\nx\n\\end{document}'
  const wrapped = preparePreview(wrappedSource)
  assert.equal(lines(wrapped.source), lines(wrappedSource))
  assert.ok(wrapped.source.includes('\\usepackage{hyperref}'))
  assert.ok(!wrapped.source.includes('geometry'))
  assert.deepEqual(wrapped.ignored, ['geometry'])
  // a chapter that needs nothing dropped reports nothing
  assert.deepEqual(preparePreview('\\documentclass{article}\n\\usepackage{hyperref}\n\\title{T}\n\\begin{document}\nx\n\\end{document}').ignored, [])
  // the thesis chapter: booktabs is named; amsmath is dropped without a word, KaTeX covers it
  assert.deepEqual(preparePreview(RELATED_WORK_TEX).ignored, ['booktabs'])
})

test('preparePreview blanks comment environments when the comment package is loaded, keeping the lines and naming nothing', () => {
  const source = '\\documentclass{article}\n\\usepackage{comment}\n\\begin{document}\nshown\n\\begin{comment}\nhidden\n\\end{comment} tail\nafter\n\\end{document}'
  const { source: out, ignored } = preparePreview(source)
  assert.equal(lines(out), lines(source))
  assert.ok(!out.includes('hidden'))
  assert.ok(!out.includes('comment}'), 'the environment and the package line are gone')
  assert.ok(out.includes('%\n%\n tail\nafter'), 'the padding keeps the lines and the text after \\end{comment} stays')
  assert.deepEqual(ignored, [])
  // without the package the environment is left for LaTeX.js to report as unknown
  const bare = preparePreview('\\documentclass{article}\n\\begin{document}\n\\begin{comment}\nhidden\n\\end{comment}\n\\end{document}')
  assert.ok(bare.source.includes('\\begin{comment}'))
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
