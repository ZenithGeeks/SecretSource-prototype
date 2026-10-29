/**
 * The preview on a real research paper (SCRUM-462): an image path with an underscore no longer
 * stops LaTeX.js, every image is drawn (from the draft's images) or a box of its width naming
 * the file, sub-figures and algorithms are flattened into readable blocks, page-style commands
 * are dropped with one accurate notice, and a block that will not compile is left out with its
 * line while the rest of the page renders.
 */

import { beforeEach, describe, expect, test } from 'vitest'

import { findImage, forgetUnknowns, graphicWidth, preparePreview, renderIsolated, renderLatex, type ImageMap } from '../src/lib/latexPreview'
import { GEMM_LINE, PAPER_TEX } from './fixtures/paper'

beforeEach(() => forgetUnknowns())

const doc = (body: string, preamble = '\\usepackage{graphicx}') => `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`

/** What a reader sees: KaTeX's hidden MathML copy left out, LaTeX.js's typographic hyphen and
 * non-breaking spaces as plain characters. */
function visible(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('.katex-mathml').forEach((m) => m.remove())
  return (copy.textContent ?? '').replace(/‐/g, '-').replace(/ /g, ' ')
}

async function render(source: string, images?: ImageMap) {
  const prepared = preparePreview(source)
  return { prepared, ...(await renderLatex(prepared.source, { images })) }
}

describe('\\includegraphics', () => {
  test('the reported line renders: the underscore in the path was what LaTeX.js rejected, not the width or the \\hfill', async () => {
    const { root, unknown } = await render(doc(`${GEMM_LINE}\nnext`))
    const box = root.querySelector<HTMLElement>('.ss-graphic')!
    expect(box.textContent).toBe('Image not uploaded: figures/gemm_spock.png')
    expect(box.style.width).toBe('49%')
    expect(root.textContent).toContain('next')
    expect(unknown).toEqual([])
  })

  test('widths: a fraction of \\textwidth or \\linewidth is a percentage, an absolute width a CSS length, and scale is kept as a scale', () => {
    expect(graphicWidth('[width=0.49\\textwidth]')).toBe('49%')
    expect(graphicWidth('[width=\\linewidth]')).toBe('100%')
    expect(graphicWidth('[width=.3\\columnwidth,height=2cm]')).toBe('30%')
    expect(graphicWidth('[width=5cm]')).toBe('5cm')
    expect(graphicWidth('[width=72bp]')).toBe('72pt')
    expect(graphicWidth('[scale=0.5]')).toBe('scale 0.5')
    expect(graphicWidth('[height=3cm]')).toBe('')
    expect(graphicWidth('')).toBe('')
  })

  test('a document whose images were never uploaded renders a sized, named box for each and reports nothing unknown', async () => {
    const body = ['\\includegraphics[width=\\linewidth]{a.png}', '\\includegraphics[width=5cm]{plots/b_c.pdf}', '\\includegraphics[scale=0.5]{c.jpg}', '\\includegraphics{d}'].join('\n')
    const { root, unknown, prepared } = await render(doc(body))
    const boxes = [...root.querySelectorAll<HTMLElement>('.ss-graphic')]
    expect(boxes.map((b) => [b.textContent, b.style.width])).toEqual([
      ['Image not uploaded: a.png', '100%'],
      ['Image not uploaded: plots/b_c.pdf', '5cm'],
      ['Image not uploaded: c.jpg', '50%'],
      ['Image not uploaded: d', ''],
    ])
    expect(unknown).toEqual([])
    expect(prepared.ignored).toEqual([])
  })

  test('an image the draft has is drawn at its width; paths match by file name and without an extension', async () => {
    const images: ImageMap = new Map([
      ['gemm_spock.png', 'blob:gemm'],
      ['figures/posv.jpg', 'blob:posv'],
    ])
    const { root } = await render(doc(`${GEMM_LINE}\n\\includegraphics[width=\\linewidth]{figures/posv}\n\\includegraphics{figures/missing.png}`), images)
    const imgs = [...root.querySelectorAll<HTMLImageElement>('img.ss-image')]
    expect(imgs.map((img) => [img.getAttribute('src'), img.alt, img.style.width])).toEqual([
      ['blob:gemm', 'figures/gemm_spock.png', '49%'],
      ['blob:posv', 'figures/posv', '100%'],
    ])
    expect(root.querySelector('.ss-graphic')?.textContent).toBe('Image not uploaded: figures/missing.png')
  })

  test('findImage: exact path first, then the same file name anywhere, and an extension-less path tries the image extensions', () => {
    const images: ImageMap = new Map([
      ['figures/a.png', 'exact'],
      ['other/a.png', 'elsewhere'],
      ['b.pdf', 'pdf'],
    ])
    expect(findImage(images, 'figures/a.png')).toBe('exact')
    expect(findImage(images, './figures/a.png')).toBe('exact')
    expect(findImage(images, 'img/a.png')).toBe('exact') // same file name: the first one listed
    expect(findImage(images, 'figures/b')).toBe('pdf')
    expect(findImage(images, 'figures/c.png')).toBeUndefined()
  })
})

describe('environments LaTeX.js lacks', () => {
  test('an algorithm becomes "Algorithm n:" with its caption and numbered, indented monospace lines; nothing is unknown', async () => {
    const body = [
      '\\begin{algorithm}',
      '\\caption{Sum}',
      '\\begin{algorithmic}[1]',
      '\\Require $n$',
      '\\State $s \\gets 0$',
      '\\For{$i = 1$ \\To $n$}',
      '\\State $s \\gets s + i$ \\Comment{add}',
      '\\EndFor',
      '\\State \\Return $s$',
      '\\end{algorithmic}',
      '\\end{algorithm}',
    ].join('\n')
    const { root, unknown, prepared } = await render(doc(body, '\\usepackage{algorithm}\n\\usepackage{algpseudocode}'))
    expect(unknown).toEqual([])
    expect(prepared.ignored).toEqual([])
    expect(visible(root)).toContain('Algorithm 1: Sum')
    const raw = [...root.querySelectorAll('.list.flushleft .tt')].map(visible)
    const lines = raw.map((line) => line.replace(/\s+/g, ' '))
    expect(lines).toEqual([' Require: n', ' 1: s←0', ' 2: for i=1 to n do', ' 3: s←s+i ▹ add', ' 4: end for', ' 5: return s'])
    // the loop body is indented two spaces more than the for
    expect(raw[3].indexOf('s')).toBe(raw[2].indexOf('for') + 2)
  })

  test('subfigure, \\subcaptionbox and \\subfloat keep their content and caption', async () => {
    const body = [
      '\\begin{figure}',
      '\\begin{subfigure}{0.49\\textwidth}\\includegraphics[width=\\linewidth]{a_b.png}\\caption{Left}\\end{subfigure}',
      '\\subcaptionbox{Middle}{\\includegraphics{m.png}}',
      '\\subfloat[Right]{\\includegraphics{r.png}}',
      '\\caption{Both}',
      '\\end{figure}',
    ].join('\n')
    const { root, unknown, prepared } = await render(doc(body, '\\usepackage{graphicx}\n\\usepackage{subcaption}'))
    expect(unknown).toEqual([])
    expect(prepared.ignored).toEqual([])
    expect([...root.querySelectorAll('.ss-caption')].map((c) => c.textContent)).toEqual(['Left', 'Middle', 'Right', 'Both'])
    expect([...root.querySelectorAll('.ss-graphic')].map((b) => b.textContent)).toEqual([
      'Image not uploaded: a_b.png',
      'Image not uploaded: m.png',
      'Image not uploaded: r.png',
    ])
  })

  test('page styles, headers and footers are dropped anywhere; the notice names fancyhdr once and \\algrenewcommand once', async () => {
    const preamble = ['\\usepackage{fancyhdr}', '\\pagestyle{fancy}', '\\fancyhf{}', '\\fancyfoot[C]{\\thepage}', '\\renewcommand{\\headrulewidth}{0pt}', '\\algrenewcommand\\algorithmicrequire{\\textbf{Input:}}'].join('\n')
    const { root, unknown, prepared } = await render(doc('\\thispagestyle{empty}\\fancyhead[L]{Draft}Body text.', preamble))
    expect(prepared.ignored).toEqual(['fancyhdr (page headers and footers are not shown)', '\\algrenewcommand'])
    expect(unknown).toEqual([])
    expect(root.textContent?.trim()).toBe('Body text.')
  })

  test('a page-style command takes only its own argument: a group on the next line is still text', async () => {
    const { root } = await render(doc('\\thispagestyle{empty}\n{\\bfseries My Thesis}\n\\fancyhead[L]{Draft}\n{Next line}'))
    expect(visible(root)).toContain('My Thesis')
    expect(visible(root)).toContain('Next line')
    expect(visible(root)).not.toContain('Draft')
  })

  test('thebibliography becomes a numbered References list and its keys are returned in order', async () => {
    const { root, prepared, unknown } = await render(doc('See \\cite{b}.\n\\begin{thebibliography}{9}\n\\bibitem{a} First.\n\\bibitem[X]{b} Second.\n\\end{thebibliography}'))
    expect(prepared.bibitems).toEqual(['a', 'b'])
    expect(unknown).toEqual([])
    expect(root.textContent).toContain('References')
    expect(root.textContent).toContain('[1]\u00a0First.')
    expect(root.textContent).toContain('[2]\u00a0Second.')
  })
})

describe('error isolation', () => {
  const broken = ['\\section{Alpha}', 'First part.', '\\section{Beta}', 'An \\textbf{unclosed group', '\\section{Gamma}', 'Third part.'].join('\n')

  test('a block that will not compile is an inline error with its line; the sections before and after render, numbered as in the whole file', async () => {
    const prepared = preparePreview(doc(broken))
    await expect(renderLatex(prepared.source)).rejects.toBeTruthy()
    const { root, failures } = await renderIsolated(prepared.source)
    expect(failures).toEqual([{ line: 7, message: expect.any(String) }])
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent?.replace(/\s+/g, ' '))).toEqual(['1 Alpha', '3 Gamma'])
    expect(root.textContent).toContain('First part.')
    expect(root.textContent).toContain('Third part.')
    const error = root.querySelector('.ss-block-error')!
    expect(error.textContent).toMatch(/^Line 7: .* · this part is left out of the preview$/)
    // in place: after Alpha, before Gamma
    const order = [...root.querySelectorAll('h2, .ss-block-error')].map((el) => el.className === 'ss-block-error' ? 'error' : el.textContent?.replace(/\s+/g, ' '))
    expect(order).toEqual(['1 Alpha', 'error', '3 Gamma'])
  })

  test('without headings the body is split at blank lines, never inside an environment', async () => {
    const body = ['Good paragraph.', '', '\\begin{center}', 'still one block', '', 'with a blank line', '\\end{center}', '', '\\textbf{broken', '', 'Last paragraph.'].join('\n')
    const { root, failures } = await renderIsolated(preparePreview(doc(body)).source)
    expect(failures).toHaveLength(1)
    expect(root.textContent).toContain('Good paragraph.')
    expect(root.textContent).toContain('still one block')
    expect(root.textContent).toContain('with a blank line')
    expect(root.textContent).toContain('Last paragraph.')
  })

  test('a broken preamble is still one failure for the whole file', async () => {
    const prepared = preparePreview('\\documentclass{article}\n\\title{x\n\\begin{document}\n\\section{A}\nText.\n\\section{B}\nMore.\n\\end{document}\n')
    await expect(renderIsolated(prepared.source)).rejects.toMatchObject({ message: expect.any(String) })
  })
})

describe('the whole paper', () => {
  test('renders with no failure and no grey box; the notice lists only what the preview really leaves out', async () => {
    const prepared = preparePreview(PAPER_TEX)
    const { root, unknown, failures } = await renderIsolated(prepared.source)
    expect(failures).toEqual([])
    expect(unknown).toEqual([])
    expect(prepared.ignored).toEqual(['fancyhdr (page headers and footers are not shown)', '\\algrenewcommand'])
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent?.replace(/\s+/g, ' '))).toEqual(['1 Introduction', '2 Results', '3 Method', '4 Conclusion'])
    expect([...root.querySelectorAll('.ss-graphic')].map((b) => b.textContent)).toEqual([
      'Image not uploaded: figures/gemm_spock.png',
      'Image not uploaded: figures/gemm_crusher.png',
      'Image not uploaded: figures/posv',
      'Image not uploaded: figures/getrf_batched.pdf',
    ])
    const text = visible(root)
    expect(text).toContain('Algorithm 1: Size-grouped batched launch')
    expect(text).toMatch(/4: {5}LaunchBatched\(g\) +▹ one kernel per group/)
    expect(text).toContain('References[1] J. Dongarra et al.')
    expect(prepared.bibitems).toEqual(['dongarra2016', 'abdelfattah2021'])
    // \ref to a section resolves to its number
    expect(text).toMatch(/Section 2 reports/)
  })

  test('preparing the preview never changes the source it reads', () => {
    const before = PAPER_TEX.slice()
    preparePreview(PAPER_TEX)
    expect(PAPER_TEX).toBe(before)
    expect(preparePreview(PAPER_TEX).source.split('\n')).toHaveLength(PAPER_TEX.split('\n').length)
  })
})
