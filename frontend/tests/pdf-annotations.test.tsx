import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { PdfAnnotations } from '../src/components/PdfAnnotations'
import { normalizedRects } from '../src/lib/pdfAnnotations'
import type { PaperAnnotation } from '../src/lib/api'

const { getPaperAnnotations, savePaperAnnotations } = vi.hoisted(() => ({
  getPaperAnnotations: vi.fn(),
  savePaperAnnotations: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({
  api: {
    getPaperAnnotations: (...args: unknown[]) => getPaperAnnotations(...args as []),
    savePaperAnnotations: (...args: unknown[]) => savePaperAnnotations(...args as [string, PaperAnnotation[]]),
  },
}))
vi.mock('../src/lib/supabase', () => ({ authEnabled: true }))
vi.mock('../src/lib/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'user-ada' } }, loading: false }) }))

function Reader({ paper = 'paper.pdf' }: { paper?: string }) {
  return (
    <PdfAnnotations paper={paper}>
      <PdfAnnotations.Toolbar />
      <div data-page="1" className="relative" style={{ width: 100, height: 200 }}>
        <span>Paper passage</span>
        <PdfAnnotations.Page page={1} />
      </div>
    </PdfAnnotations>
  )
}

beforeEach(() => {
  getPaperAnnotations.mockResolvedValue({ annotations: [] })
  savePaperAnnotations.mockImplementation(async (_paper, annotations) => ({ annotations }))
})

afterEach(() => vi.clearAllMocks())

test('the reusable toolbar loads cloud annotations and exposes all reader tools', async () => {
  const existing: PaperAnnotation = {
    id: 'highlight-1',
    kind: 'highlight',
    page: 1,
    color: 'yellow',
    rects: [{ x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.25 }],
  }
  getPaperAnnotations.mockResolvedValue({ annotations: [existing] })
  render(<Reader />)

  await screen.findByText('Saved')
  fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
  expect(await screen.findByRole('button', { name: 'Remove annotation on page 1' })).toBeInTheDocument()
  for (const name of ['Highlight', 'Pen', 'Note', 'Eraser', 'Highlight yellow', 'Highlight green']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(getPaperAnnotations).toHaveBeenCalledWith('paper.pdf')
})

test('a page-placed plain text note is saved to the cloud for its paper', async () => {
  const { container } = render(<Reader />)
  const page = container.querySelector('[data-page="1"]') as HTMLElement
  page.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200,
    toJSON: () => ({}),
  })

  await screen.findByText('Saved')
  fireEvent.click(screen.getByRole('button', { name: 'Note' }))
  fireEvent.pointerDown(container.querySelector('[aria-label="Annotations on page 1"]')!, { clientX: 60, clientY: 120, pointerId: 1 })
  fireEvent.change(await screen.findByRole('textbox', { name: 'Note text on page 1' }), {
    target: { value: 'Compare this result with table 2.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

  await waitFor(() => expect(savePaperAnnotations).toHaveBeenCalled())
  const [, saved] = savePaperAnnotations.mock.calls.at(-1)!
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ kind: 'note', page: 1, x: 0.5, y: 0.5, text: 'Compare this result with table 2.' })
})

test('the eraser removes the selected annotation and persists the new document', async () => {
  getPaperAnnotations.mockResolvedValue({ annotations: [{
    id: 'ink-1', kind: 'ink', page: 1, color: 'blue', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
  }] })
  render(<Reader />)
  fireEvent.click(await screen.findByRole('button', { name: 'Eraser' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove annotation on page 1' }))

  await waitFor(() => expect(savePaperAnnotations).toHaveBeenCalledWith('paper.pdf', []))
})

test('selection rectangles are stored in page-relative coordinates', () => {
  const normalized = normalizedRects(
    [{ left: 20, top: 40, right: 70, bottom: 60, width: 50, height: 20 } as DOMRect],
    { left: 10, top: 20, width: 100, height: 200 } as DOMRect,
  )

  expect(normalized).toEqual([{ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.2 }])
})

test('selecting PDF text creates a persistent highlight in the selected color', async () => {
  const { container } = render(<Reader />)
  await screen.findByText('Saved')
  const page = container.querySelector('[data-page="1"]') as HTMLElement
  page.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200,
    toJSON: () => ({}),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Highlight green' }))
  const textNode = screen.getByText('Paper passage').firstChild!
  const rect = { left: 20, top: 40, right: 70, bottom: 60, width: 50, height: 20 } as DOMRect
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: textNode, getClientRects: () => [rect] }),
  } as unknown as Selection)

  document.dispatchEvent(new MouseEvent('mouseup'))

  await waitFor(() => expect(savePaperAnnotations).toHaveBeenCalled())
  const [, saved] = savePaperAnnotations.mock.calls.at(-1)!
  expect(saved[0]).toMatchObject({ kind: 'highlight', color: 'green', page: 1, rects: [{ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.2 }] })
})

test('pen pointer strokes become persistent page-relative ink', async () => {
  const { container } = render(<Reader />)
  await screen.findByText('Saved')
  const page = container.querySelector('[data-page="1"]') as HTMLElement
  page.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200,
    toJSON: () => ({}),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Pen' }))
  const layer = container.querySelector('[aria-label="Annotations on page 1"]')!
  fireEvent.pointerDown(layer, { clientX: 20, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(layer, { clientX: 60, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(layer, { pointerId: 1 })

  await waitFor(() => expect(savePaperAnnotations).toHaveBeenCalled())
  const [, saved] = savePaperAnnotations.mock.calls.at(-1)!
  expect(saved[0]).toMatchObject({ kind: 'ink', page: 1, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.4 }] })
})

test('a failed annotation save is visible and can be retried', async () => {
  savePaperAnnotations
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockImplementation(async (_paper: string, annotations: PaperAnnotation[]) => ({ annotations }))
  const { container } = render(<Reader />)
  const page = container.querySelector('[data-page="1"]') as HTMLElement
  page.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200,
    toJSON: () => ({}),
  })
  await screen.findByText('Saved')
  fireEvent.click(screen.getByRole('button', { name: 'Note' }))
  fireEvent.pointerDown(container.querySelector('[aria-label="Annotations on page 1"]')!, { clientX: 60, clientY: 120, pointerId: 1 })
  fireEvent.change(await screen.findByRole('textbox', { name: 'Note text on page 1' }), {
    target: { value: 'Keep this in mind.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }))

  expect(await screen.findByText('Not saved')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving annotations' }))
  await waitFor(() => expect(savePaperAnnotations).toHaveBeenCalledTimes(2))
  expect(screen.getByText('Saved')).toBeInTheDocument()
})
