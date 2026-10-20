/** Ask is in the Author and Teacher toolbars too, and opens the same panel there (#574). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { AuthorApp } from '../src/roles/author/AuthorApp'
import { TeacherApp } from '../src/roles/teacher/TeacherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function renderAt(search: string, app: ReactNode) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', search)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{app}</QueryClientProvider>)
}

function openAsk() {
  fireEvent.click(screen.getByRole('button', { name: 'Ask', pressed: false }))
  return within(screen.getByRole('complementary', { name: 'Ask' }))
}

test('an author asks the library from Library and keeps the chat on History', () => {
  renderAt('?role=author&screen=library', <AuthorApp />)

  expect(openAsk().getByText('About: your library')).toBeInTheDocument()

  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'History' }))
  expect(screen.getByRole('complementary', { name: 'Ask' })).toBeInTheDocument()
})

test('a teacher asks the library from Home, with no hint about opening a paper', () => {
  renderAt('?role=teacher', <TeacherApp />)

  const panel = openAsk()
  expect(panel.getByText('About: your library')).toBeInTheDocument()
  expect(panel.queryByText(/select a graph node/)).not.toBeInTheDocument()
})
