/** The researcher's History screen is called Analyses now; old `?screen=history` links must
 * still open it, with the renamed nav item active and the URL rewritten to `analyses`. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderAt(search: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', search)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ResearcherApp />
    </QueryClientProvider>,
  )
}

for (const param of ['history', 'analyses']) {
  test(`?screen=${param} opens Analyses, the active nav item`, () => {
    renderAt(`?role=researcher&screen=${param}`)
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Analyses', 'Library', 'Graph'])
    expect(nav.getByRole('button', { name: 'Analyses' })).toHaveAttribute('aria-current', 'page')
    expect(nav.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('analyses')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Analyses')).toBeInTheDocument()
  })
}
