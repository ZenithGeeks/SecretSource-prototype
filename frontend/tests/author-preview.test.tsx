/**
 * The editor's live preview: LaTeX.js renders the thesis chapter inside a shadow root, the
 * \cite markers become numbered links coloured by verdict, and a flagged marker opens the
 * issue popover. The render is the real library; only the gateway is faked.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { parseBib } from '../src/lib/bibtex'
import { decorateCitations } from '../src/lib/latexPreview'
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
  const onFindReplacement = vi.fn()
  const onKeepMine = vi.fn()
  const view = render(
    <PreviewPane
      content={content}
      citations={citations}
      bibEntries={bib}
      verdictColors
      onToggleVerdictColors={() => undefined}
      onFindReplacement={onFindReplacement}
      onKeepMine={onKeepMine}
      {...extra}
    />,
  )
  return { ...view, onFindReplacement, onKeepMine }
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
    expect(page().querySelector('.ss-graphic')?.textContent).toBe('figure · figures/architecture.pdf')
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
  }, 20000)

  test('a source that will not compile keeps the last page and names the line', async () => {
    const { rerender } = renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('h2')?.textContent).toMatch(/Related work/), { timeout: 15000 })

    rerender(
      <PreviewPane
        content={RELATED_WORK_TEX.replace('\\section{Related work}', '\\section{Related work')}
        citations={citations}
        bibEntries={bib}
        verdictColors
        onToggleVerdictColors={() => undefined}
        onFindReplacement={() => undefined}
        onKeepMine={() => undefined}
      />,
    )
    const alert = await screen.findByRole('alert', {}, { timeout: 15000 })
    expect(alert).toHaveTextContent(/Line 1[89]: /)
    expect(alert).toHaveTextContent('showing the last good render')
    expect(page().querySelector('h2')?.textContent).toMatch(/Related work/)
  }, 20000)

  test('a flagged marker opens the popover; Find a replacement and Keep mine call back; Escape closes', async () => {
    const { onFindReplacement, onKeepMine } = renderPane(RELATED_WORK_TEX)
    await waitFor(() => expect(page().querySelector('.ss-cite[data-verdict="refutes"]')).toBeTruthy(), { timeout: 15000 })

    fireEvent.click(page().querySelector('.ss-cite[data-verdict="refutes"]')!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('source contradicts')
    expect(dialog).toHaveTextContent('[1] Khattab & Zaharia, 2020')
    expect(dialog).toHaveTextContent('1 of 3 issues')
    fireEvent.click(screen.getByRole('button', { name: /Find a replacement/ }))
    expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({ key: 'khattab2020', verdict: 'refutes' }))
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
