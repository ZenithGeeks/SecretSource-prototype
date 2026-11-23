/** PageViewer: loading and failure, zoom, paging, the full-window and narrow layouts, text
 * selection, and the highlight and citation markers drawn over a page. react-pdf is stubbed
 * (pdf.js does not run in jsdom): its Document reports a three-page PDF and draws nothing. */

import { act, fireEvent, render as renderSync, screen, within } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stub = vi.hoisted(() => ({
  pdf: { url: 'blob:paper' as string | undefined, failed: false },
  numPages: 3,
  width: 800,
  narrow: false,
  mediaChange: undefined as (() => void) | undefined,
  intersect: undefined as ((entries: unknown[]) => void) | undefined,
  intersectLead: undefined as ((entries: unknown[]) => void) | undefined,
  intersectOptions: [] as IntersectionObserverInit[],
  documentOptions: undefined as unknown,
  authorizedFor: '' as string,
}))

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
    onLoadError,
    onItemClick,
    options,
  }: {
    children: ReactNode
    onLoadSuccess: (pdf: unknown) => void
    onLoadError: () => void
    onItemClick: (item: { pageNumber: number }) => void
    options: unknown
  }) => {
    stub.documentOptions = options
    const loaded = useRef(false)
    useEffect(() => {
      if (loaded.current) return
      loaded.current = true
      onLoadSuccess({ numPages: stub.numPages, getPage: async () => ({ getViewport: () => ({ width: 100, height: 150 }) }) })
    })
    return (
      <div>
        <button onClick={onLoadError}>fail to load</button>
        <button onClick={() => onItemClick({ pageNumber: 3 })}>pdf link to page 3</button>
        {children}
      </div>
    )
  },
  Page: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid={`drawn-${pageNumber}`} data-width={width} />
  ),
  pdfjs: { GlobalWorkerOptions: {}, version: '0', PDFWorker: { create: vi.fn(() => ({ worker: true })) } },
}))
vi.mock('../src/lib/useAuthorizedUrl', () => ({
  useAuthorizedUrl: (url: string) => {
    stub.authorizedFor = url
    return stub.pdf
  },
}))

import { PageViewer, type Target } from '../src/components/PageViewer'
import type { Citation, CitationMarker } from '../src/lib/api'

const location = {
  page: 2,
  boxes: [
    { x0: 10, y0: 20, x1: 60, y1: 40 },
    { x0: 10, y0: 45, x1: 30, y1: 60 },
  ],
  page_width: 100,
  page_height: 200,
}

const target: Target = { paper: 'my paper.pdf', label: 'Claim 1 in this paper', source: null, page: 1 }

const cite = (extra: Partial<Citation> = {}): Citation => ({
  title: 'Batch Normalization', authors: ['Ioffe'], year: '2015', doi: '10.1/bn', arxiv: '', url: '', ...extra,
})
const marker = (extra: Partial<CitationMarker> = {}): CitationMarker => ({
  ref: 'b1', text: '[1]', page: 1, x0: 20, y0: 10, x1: 30, y1: 20, page_width: 100, page_height: 100, ...extra,
})

function stubBrowser() {
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return stub.narrow
    },
    addEventListener: (_: string, handler: () => void) => (stub.mediaChange = handler),
    removeEventListener: () => {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private report: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() {
        this.report([{ contentRect: { width: stub.width } }])
      }
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: unknown[]) => void, options: IntersectionObserverInit) {
        stub.intersectOptions.push(options)
        // The page counter's own observer has no rootMargin; the one that only decides what to
        // draw ahead of the reader does (see PageViewer's two observers).
        if (options.rootMargin) stub.intersectLead = callback
        else stub.intersect = callback
      }
      observe() {}
      disconnect() {}
    },
  )
}

const scrollTo = vi.fn()

/** Renders, then lets the PDF finish loading: the page count arrives a tick later. */
async function render(ui: ReactNode) {
  const view = renderSync(ui)
  await act(async () => {})
  return view
}

beforeEach(() => {
  stub.pdf = { url: 'blob:paper', failed: false }
  stub.numPages = 3
  stub.width = 800
  stub.narrow = false
  stub.mediaChange = undefined
  stub.intersect = undefined
  stub.intersectLead = undefined
  stub.intersectOptions = []
  window.localStorage.clear()
  stubBrowser()
  Element.prototype.scrollTo = scrollTo as never
  scrollTo.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const toolbar = () => screen.getByRole('toolbar', { name: 'Page controls' })
const button = (name: string) => within(toolbar()).getByRole('button', { name })
const pageNode = (n: number) => document.querySelector(`[data-page="${n}"]`) as HTMLElement

describe('opening the paper', () => {
  it('asks the gateway for the paper by name, behind the signed-in token', async () => {
    await render(<PageViewer target={target} />)
    expect(stub.authorizedFor).toBe('/api/papers/my%20paper.pdf')
    expect(screen.getByRole('complementary', { name: 'my paper.pdf, page 1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open original PDF' })).toHaveAttribute('href', 'blob:paper')
  })

  it('says the paper is opening until the copy arrives', async () => {
    stub.pdf = { url: undefined, failed: false }
    await render(<PageViewer target={target} />)
    expect(screen.getByText('Opening the paper…')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open original PDF' })).not.toBeInTheDocument()
  })

  it('says the paper could not be opened when the gateway would not give it', async () => {
    stub.pdf = { url: undefined, failed: true }
    await render(<PageViewer target={target} />)
    expect(screen.getByText(/This paper could not be opened/)).toBeInTheDocument()
    expect(screen.queryByText('Opening the paper…')).not.toBeInTheDocument()
  })

  it('offers the original PDF when pdf.js cannot draw it', async () => {
    await render(<PageViewer target={target} />)
    expect(screen.queryByRole('link', { name: 'Original PDF' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'fail to load' }))
    expect(screen.getByRole('link', { name: 'Original PDF' })).toHaveAttribute('href', 'blob:paper')
  })

  it('draws nothing before it knows how wide the panel is', async () => {
    stub.width = 0
    await render(<PageViewer target={target} />)
    expect(screen.queryByRole('button', { name: 'fail to load' })).not.toBeInTheDocument()
    expect(screen.queryByText('Opening the paper…')).not.toBeInTheDocument()
  })

  it('shares one pdf.js worker between documents where the browser has Workers', async () => {
    vi.stubGlobal('Worker', class {})
    vi.resetModules()
    const { PageViewer: Fresh } = await import('../src/components/PageViewer')
    await render(<Fresh target={target} />)
    expect(stub.documentOptions).toEqual({ worker: { worker: true } })
  })

  it('leaves pdf.js its own worker without Workers', async () => {
    await render(<PageViewer target={target} />)
    expect(stub.documentOptions).toBeUndefined()
  })
})

describe('the header', () => {
  it('names the paper and where the passage was not found', async () => {
    await render(<PageViewer target={{ ...target, detail: 'Ioffe 2015', quote: 'A quote.' }} />)
    expect(screen.getByText('Ioffe 2015 · my paper.pdf · exact place not found, showing the page')).toBeInTheDocument()
  })

  it('does not claim a failed lookup when there was no passage, a location, or an error', async () => {
    const { rerender } = await render(<PageViewer target={target} />)
    expect(screen.getByText('my paper.pdf')).toBeInTheDocument()
    rerender(<PageViewer target={{ ...target, quote: 'q', source: location }} />)
    expect(screen.getByText('my paper.pdf')).toBeInTheDocument()
    rerender(<PageViewer target={{ ...target, quote: 'q', error: 'The lookup failed.' }} />)
    expect(screen.getByText('my paper.pdf')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The lookup failed.')
  })

  it('quotes the passage at full height or in two lines', async () => {
    const { rerender } = await render(<PageViewer target={{ ...target, quote: 'The passage.', source: location }} />)
    expect(screen.getByRole('heading', { name: 'Quoted passage · page 2' })).toBeInTheDocument()
    expect(screen.getByText('“The passage.”')).not.toHaveAttribute('title')
    rerender(<PageViewer target={{ ...target, quote: 'The passage.', source: location }} compactQuote />)
    expect(screen.getByText('“The passage.”')).toHaveAttribute('title', 'The passage.')
  })

  it('says which of two papers it is', async () => {
    const { rerender } = await render(<PageViewer target={{ ...target, paperRole: 'under-review' }} />)
    expect(screen.getByText(/Paper under review/)).toBeInTheDocument()
    rerender(<PageViewer target={{ ...target, paperRole: 'reference' }} />)
    expect(screen.getByText(/Cited reference/)).toBeInTheDocument()
  })

  it('has a close button only when it can be closed', async () => {
    const onClose = vi.fn()
    const { rerender } = await render(<PageViewer target={target} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<PageViewer target={target} />)
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})

describe('paging', () => {
  it('shows the page and the count, and scrolls to the target page when it is ready', async () => {
    await render(<PageViewer target={{ ...target, source: location }} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalled()
  })

  it('pages with the buttons and keeps them inside the paper', async () => {
    await render(<PageViewer target={target} />)
    expect(button('Previous page')).toBeDisabled()
    fireEvent.click(button('Next page'))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    fireEvent.click(button('Next page'))
    expect(button('Next page')).toBeDisabled()
    fireEvent.click(button('Previous page'))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('pages with the arrow keys, but not while typing, and not when keyboard is off', async () => {
    const { rerender } = await render(<PageViewer target={target} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    const field = document.body.appendChild(document.createElement('input'))
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    const area = document.body.appendChild(document.createElement('textarea'))
    fireEvent.keyDown(area, { key: 'ArrowRight' })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    rerender(<PageViewer target={target} keyboard={false} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    field.remove()
    area.remove()
  })

  it('stays on the first page with the arrows when the paper has no pages', async () => {
    stub.numPages = 0
    await render(<PageViewer target={target} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    expect(button('Next page')).toBeDisabled()
  })

  it('jumps to a page when the PDF link to it is clicked', async () => {
    await render(<PageViewer target={target} />)
    fireEvent.click(screen.getByRole('button', { name: 'pdf link to page 3' }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('follows the scroll to the page most in view', async () => {
    await render(<PageViewer target={target} />)
    act(() => {
      stub.intersect!([
        { isIntersecting: true, intersectionRatio: 0.3, target: pageNode(2) },
        { isIntersecting: true, intersectionRatio: 0.8, target: pageNode(3) },
        { isIntersecting: false, intersectionRatio: 0.9, target: pageNode(1) },
      ])
    })
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    act(() => {
      stub.intersect!([{ isIntersecting: false, intersectionRatio: 0, target: pageNode(1) }])
    })
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('draws a page the reader is about to scroll onto, without moving the page count', async () => {
    stub.numPages = 6
    await render(<PageViewer target={{ ...target, page: 1 }} />)
    expect(stub.intersectOptions.some((o) => !o.rootMargin)).toBe(true)
    expect(stub.intersectOptions.some((o) => o.rootMargin === '50% 0px')).toBe(true)
    expect(screen.queryByTestId('drawn-5')).not.toBeInTheDocument()
    act(() => {
      stub.intersectLead!([
        { isIntersecting: true, intersectionRatio: 0.3, target: pageNode(4) },
        { isIntersecting: true, intersectionRatio: 0.8, target: pageNode(5) },
      ])
    })
    expect(screen.getByTestId('drawn-5')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 6')).toBeInTheDocument()
    act(() => {
      stub.intersectLead!([{ isIntersecting: false, intersectionRatio: 0, target: pageNode(4) }])
    })
    expect(screen.getByTestId('drawn-5')).toBeInTheDocument()
  })

  it('scrolls to a highlighted box within its page', async () => {
    await render(<PageViewer target={{ ...target, source: location }} />)
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number) })
  })

  it('opens a new target at its page', async () => {
    const { rerender } = await render(<PageViewer target={target} />)
    rerender(<PageViewer target={{ ...target, page: 3 }} />)
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('falls back to page 1 for a target with no page', async () => {
    await render(<PageViewer target={{ paper: 'p.pdf', label: 'x', source: null }} />)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('draws only the pages near the one in view, and the target page', async () => {
    stub.numPages = 6
    await render(<PageViewer target={{ ...target, page: 6 }} />)
    expect(screen.getByTestId('drawn-6')).toBeInTheDocument()
    expect(screen.queryByTestId('drawn-3')).not.toBeInTheDocument()
    expect(screen.getByTestId('drawn-5')).toBeInTheDocument()
  })

  it('draws fewer pages when zoomed in', async () => {
    stub.numPages = 6
    await render(<PageViewer target={{ ...target, page: 3 }} />)
    expect(screen.getByTestId('drawn-1')).toBeInTheDocument()
    fireEvent.click(button('Zoom in'))
    expect(screen.queryByTestId('drawn-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('drawn-2')).toBeInTheDocument()
  })

  it('removes a page it no longer draws from its list', async () => {
    stub.numPages = 2
    const { unmount } = await render(<PageViewer target={target} />)
    expect(() => unmount()).not.toThrow()
  })
})

describe('zoom', () => {
  it('steps through the zoom levels and stops at both ends', async () => {
    await render(<PageViewer target={target} />)
    expect(screen.getByText('fit')).toBeInTheDocument()
    expect(button('Zoom out')).toBeDisabled()
    expect(button('Fit to view')).toBeDisabled()
    fireEvent.click(button('Zoom in'))
    expect(screen.getByText('1.25×')).toBeInTheDocument()
    for (let i = 0; i < 4; i++) fireEvent.click(button('Zoom in'))
    expect(screen.getByText('3×')).toBeInTheDocument()
    expect(button('Zoom in')).toBeDisabled()
    fireEvent.click(button('Zoom out'))
    expect(screen.getByText('2×')).toBeInTheDocument()
    fireEvent.click(button('Fit to view'))
    expect(screen.getByText('fit')).toBeInTheDocument()
  })

  it('draws at full density on a screen that does not report one', async () => {
    vi.stubGlobal('devicePixelRatio', 0)
    await render(<PageViewer target={target} />)
    expect(screen.getByTestId('drawn-1')).toBeInTheDocument()
  })

  it('makes the page as wide as the panel at fit, and caps it', async () => {
    stub.width = 5000
    stub.numPages = 1
    await render(<PageViewer target={target} />)
    fireEvent.click(button('Zoom in'))
    expect(screen.getByTestId('drawn-1')).toHaveAttribute('data-width', '2400')
  })

  it('remembers the zoom under its key and starts from it', async () => {
    const { unmount } = await render(<PageViewer target={target} zoomKey="zoom.test" />)
    fireEvent.click(button('Zoom in'))
    expect(window.localStorage.getItem('zoom.test')).toBe('1.25')
    unmount()
    await render(<PageViewer target={target} zoomKey="zoom.test" />)
    expect(screen.getByText('1.25×')).toBeInTheDocument()
  })

  it('ignores a remembered zoom that is not one of the steps', async () => {
    window.localStorage.setItem('zoom.test', '7')
    await render(<PageViewer target={target} zoomKey="zoom.test" />)
    expect(screen.getByText('fit')).toBeInTheDocument()
  })

  it('does not break when the browser will not keep the zoom', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await render(<PageViewer target={target} zoomKey="zoom.test" />)
    fireEvent.click(button('Zoom in'))
    expect(screen.getByText('1.25×')).toBeInTheDocument()
  })

  it('keeps no zoom without a key', async () => {
    await render(<PageViewer target={target} />)
    fireEvent.click(button('Zoom in'))
    expect(window.localStorage.length).toBe(0)
  })
})

describe('the toolbar and layout', () => {
  it('shortens the toolbar in a narrow panel and drops Fit to view', async () => {
    stub.width = 300
    await render(<PageViewer target={target} />)
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fit to view' })).not.toBeInTheDocument()
  })

  it('shows no page count before the paper loads', async () => {
    stub.numPages = 0
    stub.width = 300
    await render(<PageViewer target={target} />)
    expect(toolbar()).toHaveTextContent('1fit')
    expect(toolbar()).not.toHaveTextContent('/')
  })

  it('fills the window on request, and goes back from the button, the backdrop or Escape', async () => {
    const onClose = vi.fn()
    const { container } = await render(<PageViewer target={target} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fill the window' }))
    expect(screen.getByRole('button', { name: 'Back to the side panel' })).toBeInTheDocument()
    fireEvent.click(container.querySelector('[aria-hidden].fixed') as HTMLElement)
    expect(screen.getByRole('button', { name: 'Fill the window' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fill the window' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Fill the window' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fill the window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to the side panel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes the whole screen on a narrow one, with no fill button, and follows the screen size', async () => {
    stub.narrow = true
    await render(<PageViewer target={{ ...target, paperRole: 'reference' }} />)
    expect(screen.getByRole('complementary')).toHaveClass('fixed', 'inset-0')
    expect(screen.queryByRole('button', { name: 'Fill the window' })).not.toBeInTheDocument()
    stub.narrow = false
    act(() => stub.mediaChange!())
    expect(screen.getByRole('button', { name: 'Fill the window' })).toBeInTheDocument()
  })

  it('closes on Escape on a narrow screen even after expanding', async () => {
    const onClose = vi.fn()
    stub.narrow = true
    await render(<PageViewer target={target} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does nothing on Escape without a close handler, or for other keys', async () => {
    await render(<PageViewer target={target} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('takes the height it is given', async () => {
    await render(<PageViewer target={target} className="h-80" />)
    expect(screen.getByRole('complementary')).toHaveClass('h-80')
  })
})

describe('selecting text', () => {
  /** Makes the window report this selection. */
  function select(node: Node | null, text: string, collapsed = false) {
    vi.spyOn(window, 'getSelection').mockReturnValue({ anchorNode: node, isCollapsed: collapsed, toString: () => text } as Selection)
  }
  const scroller = () => toolbar().nextElementSibling as HTMLElement

  it('reports the text with its whitespace squeezed and the page it is on', async () => {
    const onSelectText = vi.fn()
    await render(<PageViewer target={target} onSelectText={onSelectText} />)
    const text = document.createTextNode('words')
    pageNode(2).append(text)
    select(text, '  some   selected\n words ')
    fireEvent.mouseUp(scroller())
    expect(onSelectText).toHaveBeenCalledWith({ text: 'some selected words', page: 2 })
    fireEvent.keyUp(scroller())
    fireEvent.touchEnd(scroller())
    expect(onSelectText).toHaveBeenCalledTimes(3)
  })

  it('reports an element anchor, and no page when the anchor is outside a page', async () => {
    const onSelectText = vi.fn()
    await render(<PageViewer target={target} onSelectText={onSelectText} />)
    select(pageNode(3), 'inside page')
    fireEvent.mouseUp(scroller())
    expect(onSelectText).toHaveBeenLastCalledWith({ text: 'inside page', page: 3 })
    select(scroller(), 'between pages')
    fireEvent.mouseUp(scroller())
    expect(onSelectText).toHaveBeenLastCalledWith({ text: 'between pages', page: null })
  })

  it.each([
    ['a collapsed selection', () => ({ node: pageNode(1), text: 'x', collapsed: true })],
    ['a selection outside the viewer', () => ({ node: document.body, text: 'x', collapsed: false })],
    ['a selection with no anchor', () => ({ node: null, text: 'x', collapsed: false })],
    ['a selection of only spaces', () => ({ node: pageNode(1), text: '   ', collapsed: false })],
  ])('reports nothing for %s', async (_name, make) => {
    const onSelectText = vi.fn()
    await render(<PageViewer target={target} onSelectText={onSelectText} />)
    const { node, text, collapsed } = make()
    select(node, text, collapsed)
    fireEvent.mouseUp(scroller())
    expect(onSelectText).not.toHaveBeenCalled()
  })

  it('reports nothing when the window has no selection, or nobody listens', async () => {
    const onSelectText = vi.fn()
    const { rerender } = await render(<PageViewer target={target} onSelectText={onSelectText} />)
    vi.spyOn(window, 'getSelection').mockReturnValue(null)
    fireEvent.mouseUp(scroller())
    expect(onSelectText).not.toHaveBeenCalled()
    select(pageNode(1), 'x')
    rerender(<PageViewer target={target} />)
    fireEvent.mouseUp(scroller())
    expect(onSelectText).not.toHaveBeenCalled()
  })
})

describe('the highlight', () => {
  const boxes = () => document.querySelectorAll('.ring-2.pointer-events-none')

  it('outlines each box of the passage on its page', async () => {
    await render(<PageViewer target={{ ...target, source: location }} />)
    expect(pageNode(2).querySelectorAll('.pointer-events-none')).toHaveLength(2)
    expect(pageNode(1).querySelectorAll('.pointer-events-none')).toHaveLength(0)
    expect(boxes()[0]).toHaveStyle({ left: '10%', top: '10%', width: '50%', height: '10%' })
    expect(boxes()[0]).toHaveClass('bg-accent/20')
  })

  it.each([
    ['supports', 'bg-supports/20'],
    ['refutes', 'bg-refutes/20'],
    ['insufficient', 'bg-insufficient/20'],
  ] as const)('colors the passage by a %s verdict', async (verdict, cls) => {
    await render(<PageViewer target={{ ...target, source: location, verdict }} />)
    expect(boxes()[0]).toHaveClass(cls)
  })
})

describe('citation markers', () => {
  const references = { b1: cite({ ref: 'b1' }), b2: cite({ title: 'No link', doi: '', url: '' }) }
  const markers = [marker(), marker({ ref: 'b9', text: '[9]' }), marker({ ref: 'b2', text: '[2]', page: 2 })]
  const open = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }))

  it('draws a button only for a marker whose reference is known', async () => {
    await render(<PageViewer target={target} markers={markers} references={references} />)
    expect(screen.getAllByRole('button', { name: /^Cited paper/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /\[9\]/ })).not.toBeInTheDocument()
  })

  it('opens the cited paper card with its link, closes it again from the marker and from Escape', async () => {
    const onClose = vi.fn()
    await render(<PageViewer target={target} markers={markers} references={references} onClose={onClose} />)
    open(/\[1\]/)
    const card = screen.getByRole('dialog', { name: 'Cited paper' })
    expect(card).toHaveTextContent('Cited paper · [1]')
    expect(within(card).getByRole('link', { name: /Open the paper/ })).toHaveAttribute('href', 'https://doi.org/10.1/bn')
    expect(screen.getByRole('button', { name: /\[1\]/ })).toHaveAttribute('aria-expanded', 'true')
    open(/\[1\]/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    open(/\[1\]/)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the card above a marker near the bottom of the page, and without a link or a marker text', async () => {
    const low = marker({ ref: 'b2', text: '', y0: 85, y1: 90, x0: 90, x1: 95 })
    await render(<PageViewer target={target} markers={[low]} references={references} />)
    open(/Cited paper/)
    const card = screen.getByRole('dialog', { name: 'Cited paper' })
    expect(card).toHaveStyle({ left: '50%' })
    expect(card.style.bottom).toContain('calc(')
    expect(card).toHaveTextContent(/^Cited paperIoffe/)
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
  })

  it('closes the card when the target changes', async () => {
    const { rerender } = await render(<PageViewer target={target} markers={markers} references={references} />)
    open(/\[1\]/)
    rerender(<PageViewer target={{ ...target }} markers={markers} references={references} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hands the marker to the screen instead of opening a card', async () => {
    const onCitation = vi.fn()
    await render(<PageViewer target={target} markers={markers} references={references} onCitation={onCitation} />)
    open(/\[1\]/)
    expect(onCitation).toHaveBeenCalledWith(markers[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a card for one marker at a time', async () => {
    await render(<PageViewer target={target} markers={markers} references={references} />)
    open(/\[1\]/)
    open(/\[2\]/)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('draws no markers or card when it is given none', async () => {
    await render(<PageViewer target={target} />)
    expect(screen.queryByRole('button', { name: /^Cited paper/ })).not.toBeInTheDocument()
  })
})

describe('the links inside the PDF', () => {
  it('names a link that has no label, from its title or its address', async () => {
    await render(<PageViewer target={target} />)
    const layer = document.createElement('div')
    layer.className = 'annotationLayer'
    layer.innerHTML = '<a href="#p" title="Ref 3"></a><a href="https://x.org"></a><a href=""></a><a></a><a href="#q" aria-label="kept"></a>'
    pageNode(1).append(layer)
    await vi.waitFor(() => expect(layer.querySelectorAll('a:not([aria-label])')).toHaveLength(0))
    const names = [...layer.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))
    expect(names).toEqual(['Ref 3', 'Open https://x.org', 'Go to a place in this paper', 'Go to a place in this paper', 'kept'])
  })
})
