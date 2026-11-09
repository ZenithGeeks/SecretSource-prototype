/** components/SettingsModal.tsx: the Tab key stays inside the dialog and keys the tab list does
 * not use are left alone. components/RememberedSection.tsx: the failure paths. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RememberedSection } from '../src/components/RememberedSection'
import { SettingsModal } from '../src/components/SettingsModal'
import type { Role } from '../src/lib/roles'
import { resetSettings } from '../src/lib/settings'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

function withQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  resetSettings()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SettingsModal keyboard', () => {
  const open = (currentRole: Role = 'writer') =>
    render(withQuery(<SettingsModal open onClose={vi.fn()} currentRole={currentRole} onSwitchRole={vi.fn()} />))
  const search = () => screen.getByRole('textbox', { name: 'Search settings' })
  const close = () => screen.getByRole('button', { name: 'Close' })

  it('goes away when it is closed', () => {
    const view = open()
    view.rerender(withQuery(<SettingsModal open={false} onClose={vi.fn()} currentRole="writer" onSwitchRole={vi.fn()} />))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('moves focus from the last control to the first on Tab', () => {
    open()
    close().focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(search()).toHaveFocus()
  })

  it('moves focus from the first control to the last on Shift+Tab', () => {
    open()
    search().focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(close()).toHaveFocus()
  })

  it('leaves Tab alone between the first and last control, and other keys everywhere', () => {
    open()
    const middle = screen.getByRole('tab', { name: 'Account' })
    middle.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(shiftTab)
    const letter = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    document.dispatchEvent(letter)

    expect(tab.defaultPrevented).toBe(false)
    expect(shiftTab.defaultPrevented).toBe(false)
    expect(letter.defaultPrevented).toBe(false)
    expect(middle).toHaveFocus()
  })

  it('does not move focus when the dialog has nothing to focus', () => {
    open()
    close().focus()
    vi.spyOn(HTMLElement.prototype, 'querySelectorAll').mockReturnValueOnce([] as unknown as NodeListOf<HTMLElement>)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(false)
    expect(close()).toHaveFocus()
  })

  it('ignores keys the tab list does not use', () => {
    open()
    const account = screen.getByRole('tab', { name: 'Account' })
    const press = fireEvent.keyDown(account, { key: 'a' })

    expect(press).toBe(true) // not cancelled
    expect(account).toHaveAttribute('aria-selected', 'true')
  })

  it('has no label for the viewed role when the signed-in role is unknown', () => {
    open('nobody' as Role)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Account' })).toBeInTheDocument()
  })
})

describe('RememberedSection failures', () => {
  const FACT = {
    id: 'f1',
    kind: 'paper',
    subject: 'ColBERTv2',
    summary: 'Late interaction.',
    analysis_id: null,
    session_id: 's1',
    created_at: '2026-10-20T08:00:00+00:00',
    updated_at: '2026-10-21T08:00:00+00:00',
  }

  it('offers Try again when the list could not be loaded, and loads it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify([FACT]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(withQuery(<RememberedSection isPreview={false} />))

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('ColBERTv2')).toBeInTheDocument()
  })

  it('says nothing was forgotten when "Forget everything" fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE' ? new Response('no', { status: 500 }) : new Response(JSON.stringify([FACT]), { status: 200 }),
      ),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(withQuery(<RememberedSection isPreview={false} />))

    await screen.findByText('ColBERTv2')
    const button = screen.getByRole('button', { name: 'Forget everything' })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nothing was forgotten. Try again.'))
  })
})
