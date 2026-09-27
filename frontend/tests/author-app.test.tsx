/**
 * The Author role's shell: its nav is Home, Library, Find a source and History — no Graph —
 * and its History screen is the Researcher's History component (through useHistoryWorkspace),
 * not a copy. Against the fake gateway, with login off.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { AuthorApp } from '../src/roles/author/AuthorApp'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
// The Researcher's History screen, stubbed so the test can tell the shared component from a fork.
vi.mock('../src/roles/researcher/screens/History', () => ({
  History: (props: { selected: string | null }) => <div data-testid="researcher-history">researcher history · selected={String(props.selected)}</div>,
}))

let gateway: FakeGateway

function renderApp(search = '') {
  window.history.replaceState(null, '', search || window.location.pathname)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onChangeRole = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthorApp onChangeRole={onChangeRole} />
    </QueryClientProvider>,
  )
  return { onChangeRole }
}

/** The sidebar nav — screens have their own buttons with the same names (Find a source). */
function nav() {
  return within(screen.getAllByRole('navigation')[0])
}

function navLabels(): string[] {
  return nav()
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '')
}

beforeEach(() => {
  gateway = installFakeGateway({ files: THESIS_FILES })
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', window.location.pathname)
})

describe('AuthorApp', () => {
  test('the nav is exactly Home, Library, Find a source, History — no Graph', async () => {
    renderApp()
    await screen.findAllByRole('navigation')
    expect(navLabels()).toEqual(['Home', 'Library', 'Find a source', 'History'])
    expect(nav().queryByRole('button', { name: 'Graph' })).toBeNull()
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  test('each tab opens its screen and the URL follows', async () => {
    renderApp()
    await screen.findAllByRole('navigation')
    fireEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(nav().getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('library')
    expect(await screen.findByRole('button', { name: /Unsorted sources/ })).toBeInTheDocument()

    fireEvent.click(nav().getByRole('button', { name: 'Find a source' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('find-source')
    expect(screen.getByRole('textbox', { name: 'Search for a source' })).toBeInTheDocument()

    fireEvent.click(nav().getByRole('button', { name: 'History' }))
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('history')
    expect(screen.getByTestId('researcher-history')).toBeInTheDocument()
  })

  test('History renders the Researcher History component, with ?analysis= as the open one', async () => {
    renderApp('?screen=history&analysis=a42')
    expect(await screen.findByTestId('researcher-history')).toHaveTextContent('selected=a42')
    expect(nav().getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    // the shared sidebar list is there too, fed by the same /analyses the Researcher reads
    expect(await screen.findByText('No analyses yet.')).toBeInTheDocument()
    expect(gateway.calls).toContain('GET /analyses')
  })
})
