/** lib/settings.ts reads localStorage once at import, and lib/useAccountSettings.ts fills the
 * teacher preferences from the server's blob. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, getSettings, resetSettings } from '../src/lib/settings'
import { getTeacherPreferences, resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { usePreferencesSync, useSetSetting, useSetTeacherPreference } from '../src/lib/useAccountSettings'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  resetTeacherPreferences()
})

/** A fresh copy of the settings module, so its first read of localStorage runs again. */
async function freshSettings() {
  vi.resetModules()
  return import('../src/lib/settings')
}

describe('the settings store on first load', () => {
  it('starts from what an earlier visit saved', async () => {
    localStorage.setItem('secretsource.settings', JSON.stringify({ theme: 'Dark', citationStyle: 'MLA 9th' }))
    const { getSettings } = await freshSettings()
    expect(getSettings().theme).toBe('Dark')
    expect(getSettings().citationStyle).toBe('MLA 9th')
  })

  it('falls back to the defaults when the saved text is not JSON', async () => {
    localStorage.setItem('secretsource.settings', '{not json')
    const { getSettings, SETTINGS_DEFAULTS } = await freshSettings()
    expect(getSettings()).toEqual(SETTINGS_DEFAULTS)
  })
})

describe('applyTheme', () => {
  it('sets data-theme for Light and Dark and clears it for Match system', () => {
    applyTheme('Light')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme('Dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('Match system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})

describe('usePreferencesSync', () => {
  it('copies the teacher-only keys of the server blob into the teacher store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hideStudentNames: true }), { status: 200 })),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(() => usePreferencesSync(true), { wrapper })

    await waitFor(() => expect(getTeacherPreferences().hideStudentNames).toBe(true))
  })
})

describe('useSetTeacherPreference', () => {
  it('puts the old value back when the server refuses the latest write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })))
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSetTeacherPreference(), { wrapper })

    result.current('hideStudentNames', true)
    expect(getTeacherPreferences().hideStudentNames).toBe(true)

    await waitFor(() => expect(getTeacherPreferences().hideStudentNames).toBe(false))
  })
})

describe('two components writing the same key', () => {
  /** Each PATCH waits until the test answers it, in the order it was sent. */
  function holdPatches() {
    const release: ((response: Response) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((resolve) => release.push(resolve))),
    )
    return release
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

  it('does not roll a setting back when an older write from another component fails', async () => {
    resetSettings()
    const release = holdPatches()
    const first = renderHook(() => useSetSetting(), { wrapper })
    const second = renderHook(() => useSetSetting(), { wrapper })

    first.result.current('displayName', 'A')
    second.result.current('displayName', 'AB')
    await waitFor(() => expect(release).toHaveLength(2))
    release[1](new Response('{}', { status: 200 }))
    release[0](new Response('no', { status: 500 }))
    await settle()

    expect(getSettings().displayName).toBe('AB')
  })

  it('does not roll a teacher preference back when an older write from another component fails', async () => {
    const release = holdPatches()
    const first = renderHook(() => useSetTeacherPreference(), { wrapper })
    const second = renderHook(() => useSetTeacherPreference(), { wrapper })

    first.result.current('sendReportsAs', 'A')
    second.result.current('sendReportsAs', 'AB')
    await waitFor(() => expect(release).toHaveLength(2))
    release[1](new Response('{}', { status: 200 }))
    release[0](new Response('no', { status: 500 }))
    await settle()

    expect(getTeacherPreferences().sendReportsAs).toBe('AB')
  })
})
