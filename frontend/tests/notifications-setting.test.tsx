/** Settings > Notifications > "When a paper finishes": the toggle asks the browser first, and
 * lib/desktopNotice.ts shows a notice only for a hidden tab with the setting on. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { NotificationsSection } from '../src/components/settingsSections'
import type { Analysis } from '../src/lib/api'
import { showDoneNotice } from '../src/lib/desktopNotice'
import { getSettings, resetSettings, updateSettings } from '../src/lib/settings'
import { useAnalysisNotices } from '../src/lib/useAnalysis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

/** A stand-in for the browser's Notification: records what was shown. */
class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static answer: NotificationPermission = 'granted'
  static shown: { title: string; body?: string; tag?: string }[] = []
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer
    return FakeNotification.answer
  })
  onclick: (() => void) | null = null
  constructor(title: string, options: NotificationOptions = {}) {
    FakeNotification.shown.push({ title, body: options.body, tag: options.tag })
  }
  close() {}
}

let hidden = true

beforeEach(() => {
  resetSettings()
  FakeNotification.permission = 'granted'
  FakeNotification.answer = 'granted'
  FakeNotification.shown = []
  FakeNotification.requestPermission.mockClear()
  hidden = true
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsSection />
    </QueryClientProvider>,
  )
}

describe('the "When a paper finishes" toggle', () => {
  test('is the only notification setting: no weekly digest, since nothing sends email', () => {
    renderSection()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.queryByText('Weekly digest')).toBeNull()
  })

  test('asks the browser for permission and turns on when it is granted', async () => {
    FakeNotification.permission = 'default'
    renderSection()
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(getSettings().notifyDone).toBe(true))
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce()
  })

  test('stays off and says how to allow it when the browser refuses', async () => {
    FakeNotification.permission = 'default'
    FakeNotification.answer = 'denied'
    renderSection()
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByText(/blocks notifications for this site/)).toBeInTheDocument()
    expect(getSettings().notifyDone).toBe(false)
  })

  test('shows off, and says why, when the browser took the permission back', () => {
    updateSettings({ notifyDone: true })
    FakeNotification.permission = 'denied'
    renderSection()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/blocks notifications for this site/)).toBeInTheDocument()
  })

  test('is disabled on plain http, where browsers offer no notifications', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    renderSection()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByText(/only on https/)).toBeInTheDocument()
  })
})

describe('showDoneNotice', () => {
  test('shows a notice for a hidden tab when the setting is on', () => {
    updateSettings({ notifyDone: true })
    showDoneNotice('Ready to label', 'MO-GRPO', 'a1')
    expect(FakeNotification.shown).toEqual([{ title: 'Ready to label', body: 'MO-GRPO', tag: 'a1' }])
  })

  test('gives up quietly where the browser has no `new Notification` (Chrome on Android)', () => {
    updateSettings({ notifyDone: true })
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function NoConstructor() {
          throw new TypeError('Illegal constructor')
        },
        { permission: 'granted' },
      ),
    )
    expect(() => showDoneNotice('Ready to label', 'MO-GRPO', 'a1')).not.toThrow()
  })

  test('shows nothing when the setting is off or the tab is in view', () => {
    showDoneNotice('Ready to label', 'MO-GRPO', 'a1')
    updateSettings({ notifyDone: true })
    hidden = false
    showDoneNotice('Ready to label', 'MO-GRPO', 'a1')
    expect(FakeNotification.shown).toEqual([])
  })
})

describe('useAnalysisNotices', () => {
  const analysis = (status: Analysis['status']) =>
    ({ id: 'a1', paper: 'mo-grpo.pdf', title: 'MO-GRPO', status, claims: [], stages: [] }) as Analysis

  test('announces a run this tab saw running once it ends, and not one that was already done', () => {
    updateSettings({ notifyDone: true })
    const { rerender } = renderHook(({ list }) => useAnalysisNotices(list, () => {}), {
      initialProps: { list: [analysis('done')] },
    })
    expect(FakeNotification.shown).toEqual([])

    rerender({ list: [analysis('running')] })
    rerender({ list: [analysis('done')] })
    expect(FakeNotification.shown.map((n) => n.title)).toEqual(['Analysis finished'])
  })
})
