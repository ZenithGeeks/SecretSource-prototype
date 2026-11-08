/** Ask in the researcher toolbar opens the assistant panel, which stays open across screens and
 * asks about the library when no paper is open (#534). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ResearcherApp } from '../src/roles/researcher/ResearcherApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('Ask opens the panel, which stays open on another screen and closes again', () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', '?role=researcher&screen=library')
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ResearcherApp />
    </QueryClientProvider>,
  )

  const ask = screen.getByRole('button', { name: 'Ask AI', pressed: false })
  fireEvent.click(ask)
  expect(ask).toHaveAttribute('aria-pressed', 'true')
  expect(within(screen.getByRole('complementary', { name: 'Ask' })).getByText('About: your library')).toBeInTheDocument()

  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Home' }))
  expect(screen.getByRole('complementary', { name: 'Ask' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Close Ask' }))
  expect(screen.queryByRole('complementary', { name: 'Ask' })).not.toBeInTheDocument()
})

test('opening Ask moves focus into it, and Escape closes it and gives focus back', () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', '?role=researcher&screen=library')
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ResearcherApp />
    </QueryClientProvider>,
  )

  const ask = screen.getByRole('button', { name: 'Ask AI', pressed: false })
  ask.focus()
  fireEvent.click(ask)
  const panel = screen.getByRole('complementary', { name: 'Ask' })
  expect(panel.contains(document.activeElement)).toBe(true)

  fireEvent.keyDown(document.activeElement ?? panel, { key: 'Escape' })
  expect(screen.queryByRole('complementary', { name: 'Ask' })).not.toBeInTheDocument()
  expect(document.activeElement).toBe(ask)
})
