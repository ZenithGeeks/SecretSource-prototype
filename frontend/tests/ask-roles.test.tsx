/** Ask is in the Author and Teacher toolbars too, and opens the same panel there (#574). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import * as api from '../src/lib/api'
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
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI', pressed: false }))
  return within(screen.getByRole('complementary', { name: 'Ask' }))
}

test('an author asks the library from Library and keeps the chat on History', () => {
  renderAt('?role=author&screen=library', <AuthorApp />)

  expect(openAsk().getByText('About: your library')).toBeInTheDocument()

  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'History' }))
  expect(screen.getByRole('complementary', { name: 'Ask' })).toBeInTheDocument()
})

test('an author’s Do it asks the Author agent and can open the Author screens', async () => {
  const posts: { path: string; body: unknown }[] = []
  vi.spyOn(api, 'postEvents').mockImplementation(async (path, body, onEvent) => {
    posts.push({ path, body: body as unknown })
    const event = onEvent as (value: object) => void
    event({ type: 'session', id: 's1' })
    const message = (body as { message?: string }).message
    if (message === 'Open the library') event({ type: 'tool', id: 'c1', name: 'open_screen', args: { screen: 'library' } })
    event({ type: 'done' })
  })
  renderAt('?role=author', <AuthorApp />)

  const panel = openAsk()
  fireEvent.click(panel.getByRole('button', { name: 'Do it' }))
  const field = screen.getByRole('textbox', { name: 'What should the AI do?' })
  fireEvent.change(field, { target: { value: 'Open the library' } })
  fireEvent.submit(field.closest('form')!)

  await waitFor(() => expect(posts[0]).toMatchObject({ path: '/agent/runs', body: { role: 'writer', screen: 'home', message: 'Open the library' } }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('screen')).toBe('library'))
})

test('a teacher asks the library from Home, with no hint about opening a paper', () => {
  renderAt('?role=teacher', <TeacherApp />)

  const panel = openAsk()
  expect(panel.getByText('About: your library')).toBeInTheDocument()
  expect(panel.queryByText(/select a graph node/)).not.toBeInTheDocument()
})
