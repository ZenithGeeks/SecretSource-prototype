import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { parseBib } from '../src/lib/bibtex'
import { authorStore } from '../src/lib/authorStore'
import { decorateCitations } from '../src/lib/latexPreview'
import { PreviewPane } from '../src/roles/author/components/editor/PreviewPane'

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Element.prototype.scrollIntoView = () => undefined
})

beforeEach(() => authorStore.reset())

function d1() {
  const run = authorStore.checkRun('d1')!
  const related = run.draft.files.find((f) => f.name === 'related-work.tex')!
  const bib = parseBib(run.draft.files.find((f) => f.name === 'main.bib')!.content)
  return { run, related, bib, citations: run.citations.filter((c) => c.file === 'related-work.tex') }
}

function renderPane(content: string, extra: Partial<Parameters<typeof PreviewPane>[0]> = {}) {
  const { bib, citations } = d1()
  const onReplace = vi.fn()
  const onKeepMine = vi.fn()
  const view = render(
    <PreviewPane
      content={content}
      citations={citations}
      bibEntries={bib}
      verdictColors
      onToggleVerdictColors={() => undefined}
      onReplace={onReplace}
      onKeepMine={onKeepMine}
      {...extra}
    />,
  )
  return { ...view, onReplace, onKeepMine }
}

describe('decorateCitations', () => {
  test('replaces markers with numbered links and wraps the sentence each one ends', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>First point holds. ColBERTv2 cuts index size ⟦c:khattab2020⟧. Unfinished ⟦c:?⟧</p>'
    decorateCitations(root, (key) => ({ id: 'c10', verdict: 'refutes', n: key === 'khattab2020' ? 1 : null }))
    const cites = root.querySelectorAll('.ss-cite')
    expect(cites).toHaveLength(2)
    expect(cites[0].textContent).toBe('[1]')
    expect(cites[0].getAttribute('data-verdict')).toBe('refutes')
    expect(cites[1].textContent).toBe('[?]')
    const sentence = root.querySelector('.ss-sentence[data-verdict="refutes"]')!
    expect(sentence.textContent).toBe('ColBERTv2 cuts index size [1]')
    expect(root.textContent).toBe('First point holds. ColBERTv2 cuts index size [1]. Unfinished [?]')
  })
})

describe('PreviewPane', () => {
  test('renders the file with [n] markers, the [?] for the unfinished cite, and a References list', async () => {
    const { related } = d1()
    renderPane(related.content)
    await waitFor(() => expect(screen.getByRole('heading', { name: /Related work/ })).toBeInTheDocument(), { timeout: 8000 })

    const markers = [...document.querySelectorAll('.ss-cite')].map((el) => el.textContent)
    expect(markers).toEqual(['[1]', '[1]', '[4]', '[3]', '[2]', '[?]'])
    expect(document.querySelector('.ss-cite[data-verdict="refutes"]')?.textContent).toBe('[1]')
    expect(document.querySelector('.ss-sentence[data-verdict="refutes"]')?.textContent).toContain('ColBERTv2 further reduces')

    const refs = [...document.querySelectorAll('.ss-refs li')].map((li) => li.textContent)
    expect(refs).toHaveLength(4)
    expect(refs[0]).toMatch(/^\[1\] O\. Khattab and M\. Zaharia\. ColBERT/)
    expect(refs[3]).toMatch(/^\[4\] N\. Thakur et al\./)
  }, 10000)

  test('a source that will not compile keeps the last page and shows the line', async () => {
    const { related } = d1()
    const { rerender } = renderPane(related.content)
    await waitFor(() => expect(screen.getByRole('heading', { name: /Related work/ })).toBeInTheDocument(), { timeout: 8000 })

    const { bib, citations } = d1()
    rerender(
      <PreviewPane
        content={related.content.replace('\\section{Related work}', '\\section{Related work')}
        citations={citations}
        bibEntries={bib}
        verdictColors
        onToggleVerdictColors={() => undefined}
        onReplace={() => undefined}
        onKeepMine={() => undefined}
      />,
    )
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 })
    expect(alert).toHaveTextContent(/Line 4: /)
    expect(alert).toHaveTextContent('showing the last good render')
    expect(screen.getByRole('heading', { name: /Related work/ })).toBeInTheDocument()
  }, 10000)

  test('a flagged marker opens the popover; Replace and Keep mine call back; Escape closes', async () => {
    const { related } = d1()
    const { onReplace, onKeepMine } = renderPane(related.content)
    await waitFor(() => expect(document.querySelector('.ss-cite[data-verdict="refutes"]')).toBeTruthy(), { timeout: 8000 })

    fireEvent.click(document.querySelector('.ss-cite[data-verdict="refutes"]')!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('source contradicts')
    expect(dialog).toHaveTextContent('[1] Khattab & Zaharia, 2020')
    expect(dialog).toHaveTextContent('1 of 3 issues')
    fireEvent.click(screen.getByRole('button', { name: /Replace with \[3\]/ }))
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ id: 'c10' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(document.querySelector('.ss-cite[data-verdict="insufficient"]')!)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    fireEvent.change(screen.getByLabelText('Why you are keeping this citation'), { target: { value: 'Table 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(onKeepMine).toHaveBeenCalledWith(expect.objectContaining({ id: 'c11' }), 'Table 3')

    fireEvent.click(document.querySelector('.ss-cite[data-verdict="unavailable"]')!)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }, 15000)
})
