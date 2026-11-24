/** PageViewer: the PDF's own links, drawn by pdf.js as empty boxes, get names a screen reader reads. */

import { render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { PageViewer } from '../src/components/PageViewer'

// A one-page PDF whose annotation layer has a citation link, a web link and a bare in-paper link.
vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }: { children: ReactNode; onLoadSuccess: (pdf: unknown) => void }) => {
    useEffect(() => {
      onLoadSuccess({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 1, height: 1 }) }) })
    }, [onLoadSuccess])
    return <div>{children}</div>
  },
  // pdf.js adds the links to the layer some time after react-pdf reports the layer as rendered.
  Page: () => {
    const layer = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const timer = setTimeout(() => {
        layer.current!.innerHTML =
          '<section tabindex="1000"><a href="#page=9" title="Peters et al."></a></section><a href="https://cloud.google.com/tpu/"></a><a href="#"></a>'
      }, 10)
      return () => clearTimeout(timer)
    }, [])
    return <div ref={layer} className="annotationLayer" />
  },
  pdfjs: { GlobalWorkerOptions: {}, version: '0' },
}))
vi.mock('../src/lib/useAuthorizedUrl', () => ({
  useAuthorizedUrl: () => ({ url: 'blob:paper', failed: false }),
}))

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private report: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() {
        this.report([{ contentRect: { width: 800 } }])
      }
      disconnect() {}
    },
  )
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  Element.prototype.scrollTo = () => {} // jsdom has no scrolling
})

afterEach(() => vi.unstubAllGlobals())

test("names each of the PDF's links by its title, its address, or as a place in the paper", async () => {
  render(<PageViewer target={{ paper: 'paper.pdf', label: 'Reference', source: null, page: 1 }} />)
  await waitFor(() => expect(screen.getByRole('link', { name: 'Peters et al.' })).toBeInTheDocument())
  expect(screen.getByRole('link', { name: 'Open https://cloud.google.com/tpu/' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to a place in this paper' })).toBeInTheDocument()
})

test("keeps the PDF's links and pdf.js's annotation boxes out of the Tab order", async () => {
  const { container } = render(<PageViewer target={{ paper: 'paper.pdf', label: 'Reference', source: null, page: 1 }} />)
  await waitFor(() => expect(screen.getByRole('link', { name: 'Peters et al.' })).toBeInTheDocument())
  for (const stop of container.querySelectorAll<HTMLElement>('.annotationLayer a, .annotationLayer section')) {
    expect(stop.tabIndex).toBe(-1)
  }
})

test('the panel label is a heading, so the quoted passage heading sits under it', () => {
  render(<PageViewer target={{ paper: 'paper.pdf', label: 'Reference', quote: 'a quote', source: null, page: 1 }} />)
  expect(screen.getByRole('heading', { level: 2, name: 'Reference' })).toBeInTheDocument()
})

test('takes a PDF link back out of the Tab order when pdf.js puts it back in after drawing it', async () => {
  const { container } = render(<PageViewer target={{ paper: 'paper.pdf', label: 'Reference', source: null, page: 1 }} />)
  const link = await screen.findByRole('link', { name: 'Peters et al.' })
  link.tabIndex = 0
  await waitFor(() => expect(link.tabIndex).toBe(-1))
  expect(container.querySelector<HTMLElement>('.annotationLayer section')?.tabIndex).toBe(-1)
})
