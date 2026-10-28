/**
 * The editor's live preview: LaTeX.js renders the thesis chapter inside a shadow root, the
 * \cite markers become numbered links coloured by verdict, and a flagged marker opens the
 * issue popover. The render is the real library; only the gateway is faked.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { parseBib } from '../src/lib/bibtex'
import { decorateCitations } from '../src/lib/latexPreview'
import { UNSUPPORTED_PREAMBLE_TEX } from './fixtures/thesis'
import { PreviewPane } from '../src/roles/author/components/editor/PreviewPane'
import type { Citation } from '../src/types/draftCheck'
import { installFakeGateway, runCheck, type FakeGateway } from './fakeAuthorGateway'
import { MAIN_BIB, RELATED_WORK_TEX, THESIS_FILES } from './fixtures/thesis'

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Element.prototype.scrollIntoView = () => undefined
})

let gateway: FakeGateway
let citations: Citation[]
const bib = parseBib(MAIN_BIB)

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES, prechecked: false })
  citations = runCheck(gateway, 'd1').citations.filter((c) => c.file === 'related-work.tex')
})

afterEach(() => vi.unstubAllGlobals())

/** The rendered page lives in the preview host's shadow root. */
function page(): ShadowRoot {
  return screen.getByTestId('preview-page').shadowRoot!
}

function renderPane(content: string, extra: Partial<Parameters<typeof PreviewPane>[0]> = {}) {
  const onKeepMine = vi.fn()
  const view = render(
    <PreviewPane content={content} citations={citations} bibEntries={bib} verdictColors onToggleVerdictColors={() => undefined} onKeepMine={onKeepMine} {...extra} />,
  )
  return { ...view, onKeepMine }
}

describe('decorateCitations', () => {
  test('replaces markers with numbered links and wraps the sentence each one ends', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>First point holds. ColBERTv2 cuts index size ⟦c:khattab2020⟧. Unfinished ⟦c:?⟧</p>'
    decorateCitations(root, (key) => ({ id: 'c10', verdict: 'refutes', n: key === 'khattab2020' ? 1 : null }))
    const cites = root.querySelectorAll('.ss-cite')
    expect(cites).toHaveLength(2)
    expect(cites[0].textContent).toBe('[1]')
    expect(cites[0].getAttribute('href')).toBe('#ref-khattab2020')
    expect(cites[0].getAttribute('data-verdict')).toBe('refutes')
    expect(cites[1].textContent).toBe('[?]')
    const sentence = root.querySelector('.ss-sentence[data-verdict="refutes"]')!
    expect(sentence.textContent).toBe('ColBERTv2 cuts index size [1]')
    expect(root.textContent).toBe('First point holds. ColBERTv2 cuts index size [1]. Unfinished [?]')
  })
})

describe('PreviewPane', () => {
  test('renders the chapter in a shadow root with [n] markers, [?] for a missing key, and a References list', async () => {
    renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Related work/), { timeout: 15000 })

    const markers = [...page().querySelectorAll('.ss-cite')].map((el) => el.textContent)
    // robertson, khattab ×2, thakur, santhanam, nguyen, liu (not in the .bib)
    expect(markers).toEqual(['[3]', '[1]', '[1]', '[5]', '[4]', '[2]', '[?]'])
    expect(page().querySelectorAll('.ss-cite[data-verdict="refutes"]')).toHaveLength(2)
    expect(page().querySelector('.ss-sentence[data-verdict="refutes"]')?.textContent).toMatch(/token.level vectors/) // LaTeX.js sets a typographic hyphen

    const refs = [...page().querySelectorAll('.ss-refs li')].map((li) => li.textContent)
    expect(refs).toHaveLength(5)
    expect(refs[0]).toMatch(/^\[1\] O\. Khattab and M\. Zaharia\. ColBERT/)
    expect(refs[4]).toMatch(/^\[5\] N\. Thakur et al\./)
    // math, the figure box, the table rows and the footnote made it through the rewrites
    expect(page().querySelector('.katex-display')).toBeTruthy()
    expect(page().querySelector('.ss-graphic')?.textContent).toBe('Image not uploaded: figures/architecture.pdf')
    expect(page().textContent).toContain('ColBERTv2 │ 0.42 │ 20')
    expect(page().querySelector('.ss-footnote')?.textContent).toBe('[Reported on MS MARCO dev.]')
    // nothing of the page's styling reached the document
    expect(document.querySelector('.ss-refs')).toBeNull()
    expect(document.getElementById('ss-preview-fonts')).toBeTruthy()
  }, 20000)

  test('the editor preview renders a sample document with a heading and an inline equation, no errors', async () => {
    renderPane('\\section{Introduction}\nEnergy is $E = mc^2$ in every frame.\n', { citations: [], bibEntries: [] })
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Introduction/), { timeout: 15000 })
    expect(page().querySelector('.katex')).toBeTruthy()
    expect(page().textContent).toContain('in every frame.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('preview-ignored')).toBeNull()
  }, 20000)

  test('a preamble LaTeX.js cannot take renders anyway with a quiet notice naming what was left out, and multicols keeps its columns', async () => {
    renderPane(UNSUPPORTED_PREAMBLE_TEX, { citations: [], bibEntries: [] })
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Two columns/), { timeout: 15000 })
    expect(page().textContent).toContain('Left column text.')
    expect(page().textContent).toContain('Right column text.')
    expect(page().querySelector<HTMLElement>('.multicols')?.style.columnCount).toBe('2')
    expect(screen.queryByRole('alert')).toBeNull()
    const notice = screen.getByTestId('preview-ignored')
    expect(notice).toHaveTextContent('Ignored in the preview (LaTeX still compiles them): geometry, booktabs, \\newtheorem, \\DeclareMathOperator, \\hypersetup')
    expect(notice).not.toHaveTextContent('multicol')
  }, 20000)

  test('an unknown macro after a rewritten block is a grey box on the page and is listed with its line in the source file, with no alert', async () => {
    // \badmacro is on line 12 of a file whose 4-line align block was folded into one line
    const source = ['\\documentclass{article}', '\\begin{document}', '\\begin{align}', 'a &= b \\\\', 'c &= d', '\\end{align}', 'text', 'text', 'text', 'text', 'text', 'see \\badmacro here', '\\end{document}'].join('\n')
    renderPane(source, { citations: [], bibEntries: [] })
    await waitFor(() => expect(page().querySelector('.ss-unknown')).toBeTruthy(), { timeout: 15000 })
    expect(page().querySelector('.ss-unknown')?.textContent).toBe('\\badmacro')
    expect(page().textContent).toContain('see')
    expect(page().textContent).toContain('here')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('preview-ignored')).toHaveTextContent('Unknown to the preview, shown as grey boxes: \\badmacro (line 12)')
  }, 20000)

  test('a section that will not compile is left out with its line, inline and in the alert; the rest of the page renders', async () => {
    const { rerender } = renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Related work/), { timeout: 15000 })

    rerender(
      <PreviewPane
        content={RELATED_WORK_TEX.replace('\\section{Related work}', '\\section{Related work')}
        citations={citations}
        bibEntries={bib}
        verdictColors
        onToggleVerdictColors={() => undefined}
        onKeepMine={() => undefined}
      />,
    )
    const alert = await screen.findByRole('alert', {}, { timeout: 15000 })
    expect(alert).toHaveTextContent(/Line 1[89]: /)
    expect(alert).toHaveTextContent('that part is left out, the rest of the page is shown')
    expect(alert).not.toHaveTextContent('last good render')
    expect(page().querySelector('.ss-block-error')?.textContent).toMatch(/^Line 1[89]: .* · this part is left out of the preview$/)
    // the broken section is gone; its subsection, numbered as in the whole file, still renders
    expect([...page().querySelectorAll('h2, h3')].map((h) => h.textContent?.replace(/\s+/g, ' '))).toEqual(['1.1 Distillation', 'References'])
  }, 20000)

  test('when nothing compiles (a broken preamble) the last good page stays and the alert names the line', async () => {
    const { rerender } = renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Related work/), { timeout: 15000 })

    rerender(
      <PreviewPane
        content={RELATED_WORK_TEX.replace(/\\title\{/, '\\title{{')}
        citations={citations}
        bibEntries={bib}
        verdictColors
        onToggleVerdictColors={() => undefined}
        onKeepMine={() => undefined}
      />,
    )
    const alert = await screen.findByRole('alert', {}, { timeout: 15000 })
    expect(alert).toHaveTextContent('showing the last good render')
    expect(page().querySelector('h2')?.textContent).toMatch(/Related work/)
  }, 20000)

  test("a file with its own thebibliography is numbered by it, lists it itself, and the .bib's list is not added", async () => {
    const source = ['\\documentclass{article}', '\\begin{document}', 'Both \\cite{b} and \\cite{a}.', '\\begin{thebibliography}{9}', '\\bibitem{a} First.', '\\bibitem{b} Second.', '\\end{thebibliography}', '\\end{document}'].join('\n')
    renderPane(source, { citations: [], bibEntries: bib })
    await waitFor(() => expect(page().querySelectorAll('.ss-cite')).toHaveLength(2), { timeout: 15000 })
    expect([...page().querySelectorAll('.ss-cite')].map((el) => el.textContent)).toEqual(['[2]', '[1]'])
    expect(page().querySelector('.ss-refs')).toBeNull()
    expect(page().textContent).toContain('[1]\u00a0First.')
  }, 20000)

  test('a flagged marker opens the popover; Keep mine calls back; Escape closes', async () => {
    const { onKeepMine } = renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('.ss-cite[data-verdict="refutes"]')).toBeTruthy(), { timeout: 15000 })

    fireEvent.click(page().querySelector('.ss-cite[data-verdict="refutes"]')!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Source contradicts')
    expect(dialog).toHaveTextContent('[1] Khattab & Zaharia, 2020')
    expect(dialog).toHaveTextContent('1 of 3 issues')
    expect(screen.queryByRole('button', { name: /Find a replacement/ })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(page().querySelector('.ss-cite[data-verdict="insufficient"]')!)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    fireEvent.change(screen.getByLabelText('Why you are keeping this citation'), { target: { value: 'Table 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(onKeepMine).toHaveBeenCalledWith(expect.objectContaining({ key: 'thakur2021' }), 'Table 3')

    fireEvent.click(page().querySelector('.ss-cite[data-verdict="unavailable"]')!)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }, 20000)
})
