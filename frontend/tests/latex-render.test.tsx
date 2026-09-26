/**
 * LaTeX.js itself, on the thesis chapter: with the preprocessing and the custom macros the
 * chapter renders without a single error; a package or environment the library cannot take,
 * or a syntax error, becomes a readable message with the line, never an exception.
 */

import { describe, expect, test } from 'vitest'

import { prepareSource, renderLatex, type RenderFailure } from '../src/lib/latexPreview'
import { BROKEN_TEX, RELATED_WORK_TEX, UNSUPPORTED_TEX } from './fixtures/thesis'

async function failure(source: string): Promise<RenderFailure> {
  try {
    await renderLatex(prepareSource(source))
  } catch (error) {
    return error as RenderFailure
  }
  throw new Error('rendered without an error')
}

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
    expect(root.querySelector('.ss-graphic')?.textContent).toBe('figure · figures/architecture.pdf')
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

  test('a package and an environment LaTeX.js cannot take give a readable error with the line', async () => {
    const error = await failure(UNSUPPORTED_TEX)
    expect(error.message).toBe('The tikzpicture environment is not supported by the preview (LaTeX.js). It still compiles with LaTeX.')
    expect(error.line).toBe(6)
  }, 20000)

  test('a syntax error names the line it stopped at', async () => {
    const error = await failure(BROKEN_TEX)
    expect(error.line).toBe(4)
    expect(error.message).toMatch(/textbf/)
  }, 20000)

  test('an unknown macro is reported as unsupported, with the line', async () => {
    const error = await failure('\\documentclass{article}\n\\begin{document}\nfine\n\nthen \\foobar{x}\n\\end{document}\n')
    expect(error).toEqual({ message: '\\foobar is not supported by the preview (LaTeX.js). It still compiles with LaTeX.', line: 5 })
  }, 20000)
})
