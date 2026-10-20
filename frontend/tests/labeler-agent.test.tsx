/** The labeler can be worked by a coding agent over MCP like the researcher: ?connect=agent opens
 * the connect screen, and Allow shows the Agent pill beside the toolbar. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { LabelerApp } from '../src/roles/labeler/LabelerApp'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

function renderLabeler(search: string) {
  // An empty gateway is enough: the queue shows, and the bridge stream finds nothing to run.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  window.history.replaceState(null, '', search)
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LabelerApp />
    </QueryClientProvider>,
  )
}

test('?connect=agent opens the connect screen, and Allow puts the Agent pill in the toolbar', () => {
  renderLabeler('?role=labeler&connect=agent')

  expect(screen.getByRole('dialog', { name: 'Let your coding agent use this tab' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

  expect(screen.queryByRole('dialog', { name: 'Let your coding agent use this tab' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Agent/ })).toBeInTheDocument()
  expect(window.location.search).not.toContain('connect=')
})

test('without ?connect=agent no connect screen shows', () => {
  renderLabeler('?role=labeler')

  expect(screen.queryByRole('dialog', { name: 'Let your coding agent use this tab' })).not.toBeInTheDocument()
})
