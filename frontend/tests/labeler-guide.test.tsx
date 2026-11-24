import { readFileSync } from 'node:fs'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GUIDE_SECTIONS, labelerGuide, parseGuide, parseInline, RENAMED } from '../src/lib/guideMarkdown'
import { emptyLabel } from '../src/lib/labeling'
import { GuideButton } from '../src/roles/labeler/components/GuideButton'
import { LabelForm } from '../src/roles/labeler/components/LabelForm'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const copy = read('../src/roles/labeler/annotation-guideline.md')

// Run from frontend/ after changing docs/annotation-guideline.md.
const REGENERATE = `node -e "import('./src/lib/guideMarkdown.ts').then((m) => { const fs = require('fs'); fs.writeFileSync('src/roles/labeler/annotation-guideline.md', m.labelerGuide(fs.readFileSync('../docs/annotation-guideline.md', 'utf8'))) })"`

describe('the guideline copy in the app', () => {
  it('is the labeler part of docs/annotation-guideline.md', () => {
    // The production image is built from frontend/ alone, so the app reads a copy, cut down to
    // what labelers see so the team-only text never ships.
    expect(copy, `Out of date. Regenerate it from frontend/:\n${REGENERATE}\n`).toBe(labelerGuide(read('../../docs/annotation-guideline.md')))
  })

  it('still has every section the labeler is shown, numbered from 1 with no gap', () => {
    const headings = parseGuide(copy).flatMap((block) => (block.kind === 'heading' && block.level <= 2 ? [block.text] : []))
    const title = (heading: string) => heading.replace(/^\d+\. /, '')
    expect(headings.map(title)).toEqual(GUIDE_SECTIONS.map((section) => RENAMED[title(section)] ?? title(section)))
    const numbers = headings.flatMap((heading) => (/^\d+\./.test(heading) ? [parseInt(heading)] : []))
    expect(numbers).toEqual(numbers.map((_, index) => index + 1))
  })
})

describe('parseGuide', () => {
  it('reads headings, paragraphs, lists and tables', () => {
    const markdown = [
      '# Title',
      'One line',
      'and the next.',
      '',
      '- first',
      '  carried on',
      '- second',
      '1. ordered',
      '',
      '| A | B |',
      '|---|:-:|',
      '| a | b |',
      '| c | d',
    ].join('\r\n')
    expect(parseGuide(markdown)).toEqual([
      { kind: 'heading', level: 1, text: 'Title', id: 'guide-title' },
      { kind: 'paragraph', text: 'One line and the next.' },
      { kind: 'list', ordered: false, items: ['first carried on', 'second'] },
      { kind: 'list', ordered: true, items: ['ordered'] },
      { kind: 'table', head: ['A', 'B'], rows: [['a', 'b'], ['c', 'd']] },
    ])
  })

  it('gives a heading an id from its words', () => {
    expect(parseGuide('## 5. Evidence: which passages count')[0]).toMatchObject({ id: 'guide-5-evidence-which-passages-count' })
  })

  it('keeps anything else as paragraph text', () => {
    expect(parseGuide('> a quote')).toEqual([{ kind: 'paragraph', text: '> a quote' }])
  })
})

describe('parseInline', () => {
  it('splits out bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d` 3 * 4')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' 3 * 4' },
    ])
  })
})

describe('labelerGuide', () => {
  it('keeps the listed sections and drops paragraphs about the judge', () => {
    const markdown = ['# Title', 'Intro.', '## 1. The task', 'Do this.', 'The judge reads it.', '### Detail', 'More.', '## 8. Agreement and adjudication', 'Team only.'].join('\r\n\r\n')
    expect(labelerGuide(markdown)).toBe('## 1. The task\n\nDo this.\n\n### Detail\n\nMore.\n')
  })
})

describe('labelerGuide numbering', () => {
  it('numbers the shown sections from 1 with no gap, and shows a renamed heading', () => {
    const markdown = ['## 1. The task', 'Do this.', '## 8. Agreement and adjudication', 'Team only.', '## 9. Fields the labeler needs to record', 'Fields.', '## 10. Hard cases', 'Cases.'].join('\n\n')
    expect(labelerGuide(markdown)).toBe('## 1. The task\n\nDo this.\n\n## 2. Fields to record\n\nFields.\n\n## 3. Hard cases\n\nCases.\n')
  })
})

describe('GuideButton', () => {
  async function openGuide() {
    render(<GuideButton />)
    const button = screen.getByRole('button', { name: 'Labeling guide' })
    button.focus()
    fireEvent.click(button)
    return { button, dialog: await screen.findByRole('dialog', { name: 'Labeling guide' }) }
  }

  it('shows the labeler sections, with the team-only parts left out', async () => {
    const { dialog } = await openGuide()
    expect(within(dialog).getByRole('heading', { name: '7. The four levels' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('table').length).toBeGreaterThan(0)
    expect(within(dialog).queryByRole('heading', { name: '8. Agreement and adjudication' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: /Annotation guideline/ })).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/judge/)
    expect(within(dialog).getAllByText('atomic')[0].tagName).toBe('EM')
  })

  it('scrolls to a section from the list at the top', async () => {
    const { dialog } = await openGuide()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const nav = within(dialog).getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(nav).getByRole('button', { name: '9. Hard cases' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, gives focus back to its button, and keeps keys from the page', async () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      const { button, dialog } = await openGuide()
      fireEvent.keyDown(dialog, { key: '1' })
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onKey).not.toHaveBeenCalled()
      await waitFor(() => expect(button).toHaveFocus())
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it('closes from its Close button', async () => {
    const { dialog } = await openGuide()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is at the end of "How to judge" on each reference', () => {
    render(<LabelForm tag="[7]" title="Ref B" active label={emptyLabel()} others={[]} onChange={() => {}} />)
    const details = screen.getByText('How to judge').closest('details') as HTMLElement
    expect(within(details).getByRole('button', { name: 'Labeling guide', hidden: true })).toBeInTheDocument()
  })
})
