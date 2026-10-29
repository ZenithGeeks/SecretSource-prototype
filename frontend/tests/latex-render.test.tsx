/**
 * LaTeX.js itself, on the thesis chapter: with the preprocessing and the custom macros the
 * chapter renders without a single error; a macro or environment the library does not know
 * becomes a grey placeholder and is listed with its lines; only a syntax error becomes a
 * readable message with the line, never an exception.
 */

import { beforeEach, describe, expect, test } from 'vitest'

import { forgetUnknowns, prepareSource, previewStats, renderLatex, type RenderFailure } from '../src/lib/latexPreview'
import { BROKEN_TEX, BUNDLED_PACKAGES_TEX, RELATED_WORK_TEX, UNSUPPORTED_PREAMBLE_TEX, UNSUPPORTED_TEX } from './fixtures/thesis'

async function failure(source: string): Promise<RenderFailure> {
  try {
    await renderLatex(prepareSource(source))
  } catch (error) {
    return error as RenderFailure
  }
  throw new Error('rendered without an error')
}

beforeEach(() => forgetUnknowns())

describe('LaTeX.js on a thesis chapter', () => {
  test('renders sections, math, the figure, the table, lists, the footnote, the URL and the expanded \\newcommand with zero errors', async () => {
    const { root } = await renderLatex(prepareSource(RELATED_WORK_TEX))
    const text = root.textContent ?? ''
    expect(root.querySelector('.title')?.textContent).toMatch(/^Late Interaction Retrieval for Open.Domain QA$/) // LaTeX.js sets a typographic hyphen
    // LaTeX.js puts a non-breaking space after the number
    expect([...root.querySelectorAll('h2, h3')].map((h) => h.textContent?.replace(/\s+/g, ' '))).toEqual(['1 Related work', '1.1 Distillation'])
    expect(root.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3) // $6$, $10\times$, the equation, the align
    expect(root.querySelectorAll('.katex-display')).toHaveLength(2)
    // LaTeX.js leaves a zero-width space where `{}` was and its own spacing where `\ ` was
    expect(text.replace(/​/g, '').replace(/\s+/g, ' ')).toContain('as in Equation (eq:maxsim), and ColBERT keeps one vector per token (e.g. 768 dimensions).')
    expect(root.querySelector('.ss-footnote')?.textContent).toBe('[Reported on MS MARCO dev.]')
    expect(root.querySelector('a[href="https://github.com/stanford-futuredata/ColBERT"]')).toBeTruthy()
    expect(root.querySelectorAll('ul li')).toHaveLength(2)
    expect(root.querySelector('.ss-graphic')?.textContent).toBe('Image not uploaded: figures/architecture.pdf')
    expect([...root.querySelectorAll('.ss-caption')].map((c) => c.textContent?.replace(/‐/g, '-'))).toEqual([
      'The late-interaction architecture.',
      'Index size and quality on MS MARCO.',
    ])
    expect(text).toContain('Model │ nDCG@10 │ Index (GiB)')
    expect(text).toContain('ColBERT │ 0.40 │ 154')
    // the figure became a centered block, so its \label has no figure counter to resolve to
    expect(text).toMatch(/See Figure\s\S+ and Section\s1\./)
    expect(text).toContain('⟦c:khattab2020⟧') // the marker survives, for decorateCitations
    expect(text).not.toContain('\\bibliography')
  }, 20000)

  test('a small document — a section heading and an inline equation — renders through LaTeX.js without throwing', async () => {
    const { root } = await renderLatex(prepareSource('\\section{Introduction}\nEnergy is $E = mc^2$ in every frame.\n'))
    expect(root.querySelector('h2')?.textContent?.replace(/\s+/g, ' ')).toBe('1 Introduction')
    const math = root.querySelector('.katex') // LaTeX.js typesets math with its bundled KaTeX
    expect(math).toBeTruthy()
    expect(math?.querySelector('annotation')?.textContent).toBe('E = mc^2')
    expect(root.textContent?.replace(/\s+/g, ' ')).toContain('Energy is')
    expect(root.textContent).toContain('in every frame.')
  })

  test('an environment and a macro LaTeX.js does not know become placeholders, listed with their lines; the rest of the page renders', async () => {
    const { root, unknown } = await renderLatex(prepareSource(UNSUPPORTED_TEX))
    expect(root.querySelector('h2')?.textContent?.replace(/\s+/g, ' ')).toBe('1 Diagram')
    expect(root.textContent).toContain('Text before.')
    expect([...root.querySelectorAll('.ss-unknown')].map((el) => el.textContent)).toEqual(['\\begin tikzpicture', '\\draw', '\\end tikzpicture'])
    expect(unknown).toEqual([
      { what: 'tikzpicture environment', lines: [6] },
      { what: '\\draw', lines: [7] },
    ])
  }, 20000)

  test('the packages LaTeX.js bundles load: textgreek, gensymb and multicol render, and nothing is reported', async () => {
    const { root, unknown } = await renderLatex(prepareSource(BUNDLED_PACKAGES_TEX))
    // LaTeX.js leaves a zero-width space where `\ ` was
    const text = root.textContent?.replace(/​/g, '').replace(/\s+/g, ' ') ?? ''
    expect(text).toContain('The α particle scatters at 90° and β decay follows.')
    const columns = root.querySelector<HTMLElement>('.multicols')
    expect(columns?.style.columnCount).toBe('2')
    expect(columns?.textContent).toContain('Left column text.')
    expect(columns?.textContent).toContain('Right column text.')
    expect(unknown).toEqual([])
    expect(root.querySelector('.ss-unknown')).toBeNull()
  }, 20000)

  test('a \\setcounter of a counter LaTeX.js does not have is dropped and listed, not fatal', async () => {
    const { root, unknown } = await renderLatex(prepareSource('\\documentclass{article}\n\\begin{document}\n\\setcounter{page}{3}\nthe text\n\\end{document}\n'))
    expect(root.textContent).toContain('the text')
    expect(unknown).toEqual([{ what: '\\setcounter{page}', lines: [3] }])
  }, 20000)

  test('a syntax error names the line it stopped at', async () => {
    const error = await failure(BROKEN_TEX)
    expect(error.line).toBe(4)
    expect(error.message).toMatch(/textbf/)
  }, 20000)

  test('a preamble full of packages and commands LaTeX.js cannot load still renders, and multicols keeps its columns', async () => {
    const { root, unknown } = await renderLatex(prepareSource(UNSUPPORTED_PREAMBLE_TEX))
    expect(root.querySelector('.title')?.textContent).toBe('Two columns')
    expect(root.querySelector('h2')?.textContent?.replace(/\s+/g, ' ')).toBe('1 Two columns')
    expect(root.querySelector<HTMLElement>('.multicols')?.style.columnCount).toBe('2')
    const text = root.textContent ?? ''
    expect(text).toContain('Left column text.')
    expect(text).toContain('Right column text.')
    expect(unknown).toEqual([])
  }, 20000)

  test('an unknown macro after a folded align block is listed on its line in the source file, and a syntax error there names it too', async () => {
    const before = '\\documentclass{article}\n\\begin{document}\n\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\ntext\ntext\n'
    const { unknown } = await renderLatex(prepareSource(`${before}\\badmacro\n\\end{document}\n`))
    expect(unknown).toEqual([{ what: '\\badmacro', lines: [9] }])
    const error = await failure(`${before}\\textbf{never\n\\end{document}\n`)
    expect(error.line).toBe(9)
    expect(error.message).toMatch(/textbf/)
  }, 20000)

  test('what one render learnt is applied before the next parses: the same unknowns cost one parse, and one that is gone is forgotten', async () => {
    const before = previewStats.parses
    const first = await renderLatex(prepareSource(UNSUPPORTED_TEX))
    expect(previewStats.parses - before).toBe(3) // the first try, then one per unknown found
    expect(first.unknown.map((u) => u.what)).toEqual(['tikzpicture environment', '\\draw'])

    const again = previewStats.parses
    const second = await renderLatex(prepareSource(UNSUPPORTED_TEX.replace('Text before.', 'Text before, edited.')))
    expect(previewStats.parses - again).toBe(1)
    expect(second.unknown).toEqual(first.unknown)
    expect(second.root.textContent).toContain('Text before, edited.')
    expect(second.root.querySelectorAll('.ss-unknown')).toHaveLength(3)

    // \\draw is gone from the file: it is not listed, and a new unknown still costs one more parse
    const third = previewStats.parses
    const edited = await renderLatex(prepareSource(UNSUPPORTED_TEX.replace('\\draw (0,0) -- (1,1);', '\\node at (0,0) {};')))
    expect(previewStats.parses - third).toBe(2)
    expect(edited.unknown.map((u) => u.what)).toEqual(['tikzpicture environment', '\\node'])
  }, 30000)

  test('the cache keeps the eight most recently rendered package sets; an older one is re-learnt', async () => {
    const doc = (packages: string[], body = 'plain text') =>
      prepareSource(`\\documentclass{article}\n${packages.map((p) => `\\usepackage{${p}}`).join('\n')}\n\\begin{document}\n${body}\n\\end{document}\n`)
    // A scope with something to learn: \zz is unknown, so its second render normally costs one parse.
    const first = await renderLatex(doc(['multicol'], 'a \\zz{b} c'))
    expect(first.unknown.map((u) => u.what)).toEqual(['\\zz'])
    let before = previewStats.parses
    await renderLatex(doc(['multicol'], 'a \\zz{b} c, edited'))
    expect(previewStats.parses - before).toBe(1)

    // Eight other package sets rendered since: the cap holds and the first scope is the one dropped.
    const others = [[], ['textgreek'], ['gensymb'], ['textcomp'], ['hyperref'], ['graphicx'], ['xcolor'], ['textgreek', 'gensymb']]
    for (const packages of others) await renderLatex(doc(packages))
    expect(previewStats.scopes).toBe(8)

    before = previewStats.parses
    const relearnt = await renderLatex(doc(['multicol'], 'a \\zz{b} c, again'))
    expect(previewStats.parses - before).toBe(2) // the first try, then one for \zz
    expect(relearnt.unknown.map((u) => u.what)).toEqual(['\\zz'])
    expect(previewStats.scopes).toBe(8)
  }, 60000)

  test('what one file taught about a macro does not reach a file whose packages define it', async () => {
    // latexsym, which no other test loads: LaTeX.js keeps a package's symbols for the whole
    // process once loaded, so this must be the first render in the file to meet \\Box.
    const without = await renderLatex(prepareSource('\\documentclass{article}\n\\begin{document}\na \\Box\\ here\n\\end{document}\n'))
    expect(without.unknown).toEqual([{ what: '\\Box', lines: [3] }])
    const withSym = await renderLatex(prepareSource('\\documentclass{article}\n\\usepackage{latexsym}\n\\begin{document}\na \\Box\\ here\n\\end{document}\n'))
    expect(withSym.unknown).toEqual([])
    expect(withSym.root.textContent).toContain('□')
    expect(withSym.root.querySelector('.ss-unknown')).toBeNull()
  }, 20000)

  test('with \\usepackage{comment}, a comment environment shows nothing, is not an unknown, and the line count holds', async () => {
    const source = '\\documentclass{article}\n\\usepackage{comment}\n\\begin{document}\nshown before\n\\begin{comment}\nhidden text\n\\foo{also hidden}\n\\end{comment}\nshown after\n\\end{document}\n'
    const { root, unknown } = await renderLatex(prepareSource(source))
    const text = root.textContent?.replace(/\\s+/g, ' ') ?? ''
    expect(text).toContain('shown before')
    expect(text).toContain('shown after')
    expect(text).not.toContain('hidden')
    expect(unknown).toEqual([])
    expect(root.querySelector('.ss-unknown')).toBeNull()
  }, 20000)

  test('an unknown macro used twice is one placeholder per use, listed once, and its argument still shows', async () => {
    const { root, unknown } = await renderLatex(prepareSource('\\documentclass{article}\n\\begin{document}\nfine\n\nthen \\foobar{x} and \\foobar{y}\n\\end{document}\n'))
    expect(unknown).toEqual([{ what: '\\foobar', lines: [5] }])
    expect(root.querySelectorAll('.ss-unknown')).toHaveLength(2)
    expect(root.textContent?.replace(/​/g, '').replace(/\s+/g, ' ')).toContain('then \\foobarx and \\foobary')
  }, 20000)
})
