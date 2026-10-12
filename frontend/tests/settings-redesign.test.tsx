/** SettingsModal redesign: Esc and Close dismiss it, and with no Save button the footer says
 * that changes save as you go. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { SettingsModal } from '../src/components/SettingsModal'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

function renderModal() {
  const onClose = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsModal open onClose={onClose} currentRole="researcher" onSwitchRole={vi.fn()} />
    </QueryClientProvider>,
  )
  return onClose
}

describe('settings modal redesign', () => {
  test('Esc closes the modal', () => {
    const onClose = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('the Close button is labelled and closes', () => {
    const onClose = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('there is no Save button, and the footer says changes save as you go', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Changes save as you go/)).toBeInTheDocument()
  })

  test('the sidebar groups sections under General, Role and the role heading', () => {
    renderModal()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getAllByText('Researcher').length).toBeGreaterThan(0)
  })
})
