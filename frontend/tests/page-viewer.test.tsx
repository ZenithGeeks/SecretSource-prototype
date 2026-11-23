/** PageViewer: icon-only buttons are named, Esc closes, the quote panel names the page. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { PageViewer, type Target } from '../src/components/PageViewer'

vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('../src/lib/useAuthorizedUrl', () => ({
  useAuthorizedUrl: () => ({ url: 'blob:paper', failed: false }),
}))

const target: Target = {
  paper: 'paper.pdf',
  label: 'Claim 1 in this paper',
  quote: 'Internal covariate shift slows training.',
  source: null,
  page: 3,
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
})

afterEach(() => vi.unstubAllGlobals())

test('every icon-only button has an accessible name', () => {
  render(<PageViewer target={target} onClose={() => {}} />)
  for (const name of [
    'Previous page',
    'Next page',
    'Zoom in',
    'Zoom out',
    'Fit to view',
    'Close',
  ]) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('link', { name: 'Open original PDF' })).toBeInTheDocument()
})

test('Escape closes the viewer', () => {
  const onClose = vi.fn()
  render(<PageViewer target={target} onClose={onClose} />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('the quote panel heading names the page', () => {
  render(<PageViewer target={target} onClose={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Quoted passage · page 3' })).toBeInTheDocument()
})

test('labeler paperRole mode merges header and quote into one line and renders toolbarLead', () => {
  const onClose = vi.fn()
  const { rerender } = render(
    <PageViewer
      target={{ ...target, paperRole: 'reference', label: '[b33] Peters 2018', detail: 'Peters 2018' }}
      onClose={onClose}
      toolbarLead={<span>Picker</span>}
    />,
  )
  expect(screen.getByRole('heading', { name: /\[b33\] Peters 2018/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Internal covariate shift slows training\./ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Quoted passage/ })).not.toBeInTheDocument()
  expect(screen.getByText('Picker')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Fill the window' }))
  expect(screen.getByRole('button', { name: 'Back to the side panel' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(1)

  rerender(<PageViewer target={{ ...target, paperRole: 'reference', error: 'Lookup failed' }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Lookup failed')
})
