/**
 * #721: every control on the Author screens takes the Home "Check" button's hover and focus
 * treatment (src/roles/author/hover.ts): a soft accent highlight, never an underline, and the
 * accent outline for keyboard focus. jsdom cannot hover, so the classes are what is read here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { TextButton } from '../src/components/ui'
import { FOCUS, HIGHLIGHT, LINK } from '../src/roles/author/hover'
import { Editor } from '../src/roles/author/screens/Editor'
import { Home } from '../src/roles/author/screens/Home'
import { Library } from '../src/roles/author/screens/Library'
import { installFakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as DOMRectList
  Element.prototype.scrollIntoView = () => undefined
})
beforeEach(() => {
  installFakeGateway({ files: THESIS_FILES })
})
afterEach(() => vi.unstubAllGlobals())

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/** Each button of the screen that does not take the treatment, by its name. CodeMirror's own
 * controls are not ours. */
function offenders(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button')]
    .filter((b) => !b.closest('.cm-editor'))
    .filter((b) => b.className.includes('hover:underline') || !b.className.includes('focus-visible:outline'))
    .map((b) => `${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 40)} :: ${b.className}`)
}

describe('One hover and focus treatment across the Author screens (#721)', () => {
  test('the shared classes are the Check button’s (Button ghost): highlight on hover, the accent outline on focus', () => {
    expect(HIGHLIGHT).toContain('hover:bg-accent-soft')
    expect(HIGHLIGHT).toContain('hover:no-underline')
    expect(HIGHLIGHT).toContain('focus-visible:outline-accent')
    expect(LINK).toContain(HIGHLIGHT)
    expect(FOCUS).toContain('focus-visible:outline-accent')
  })

  test('Home: no control underlines on hover, every one shows focus', async () => {
    const { container } = renderWithQuery(<Home draftId="d1" onSelectDraft={vi.fn()} onOpenEditor={vi.fn()} onOpenHistory={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Citations that need work' })
    await screen.findByRole('heading', { name: /^Evidence/ })
    expect(offenders(container)).toEqual([])
  })

  test('Library and a project page: the same', async () => {
    const library = renderWithQuery(<Library projectId={null} onOpenProject={vi.fn()} onOpenEditor={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open Related work — thesis ch.2' })
    expect(offenders(library.container)).toEqual([])
    library.unmount()

    const project = renderWithQuery(<Library projectId="proj1" onOpenProject={vi.fn()} onOpenEditor={vi.fn()} />)
    await screen.findByRole('heading', { name: /Check history/ })
    expect(offenders(project.container)).toEqual([])
  })

  test('the editor: the same, top bar and tabs included', async () => {
    const { container } = renderWithQuery(<Editor target={{ draftId: 'd1', file: 'related-work.tex' }} onFileChange={vi.fn()} onNavigate={vi.fn()} />)
    await screen.findByRole('tab', { name: /related-work\.tex/ })
    expect(offenders(container)).toEqual([])
  })

  test('the other roles keep the shared look: TextButton still underlines on hover outside the Author role', () => {
    render(<TextButton>retry</TextButton>)
    expect(screen.getByRole('button', { name: 'retry' }).className).toContain('hover:underline')
  })
})
