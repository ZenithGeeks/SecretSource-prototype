/** roles/*App.tsx: the old per-role Settings screen answered `?screen=settings`; the modal
 * that replaced it must open for that bookmark instead of dropping to Home. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'
import { TeacherApp } from '../src/roles/teacher/TeacherApp'
import { AuthorApp } from '../src/roles/author/AuthorApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
// ResearcherApp reaches PageViewer, and react-pdf's pdf.js needs canvas globals jsdom lacks.
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const APPS: [string, ComponentType<{ onChangeRole?: () => void }>][] = [
  ['writer', AuthorApp],
  ['researcher', ResearcherApp],
  ['teacher', TeacherApp],
]

function renderApp(App: ComponentType<{ onChangeRole?: () => void }>, search: string) {
  // The researcher app fetches on mount; an empty gateway is enough to render Home.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', search)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

for (const [role, App] of APPS) {
  test(`${role}: a bookmarked ?screen=settings opens the Settings modal over Home`, () => {
    renderApp(App, `?role=${role}&screen=settings`)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  test(`${role}: without the legacy param the modal stays closed`, () => {
    renderApp(App, `?role=${role}&screen=home`)
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })
}
