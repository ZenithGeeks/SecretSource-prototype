/** lib/supabase.ts reads its settings from import.meta.env when it is imported, so each case
 * sets the environment and imports a fresh copy. */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function load(url: string, key: string) {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key)
  vi.resetModules()
  return import('../src/lib/supabase')
}

describe('supabase client', () => {
  it('is on when both the URL and the key are set, and names the session key after the project', async () => {
    const module = await load('https://abcdef.supabase.co', 'anon-key')
    expect(module.authEnabled).toBe(true)
    expect(module.supabase).not.toBeNull()
    expect(module.sessionStorageKey).toBe('sb-abcdef-auth-token')
  })

  it('uses the Auth endpoint and saves a password sign-in under the existing session key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        user: { id: 'test-user' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const { supabase } = await load('https://test-project.supabase.co/proxy/', 'test-anon-key')
    const auth = supabase!.auth
    const storageKey = 'sb-test-project-auth-token'
    try {
      const { error } = await auth.signInWithPassword({ email: 'reader@example.test', password: 'test-password' })
      expect(error).toBeNull()
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledWith(
        'https://test-project.supabase.co/proxy/auth/v1/token?grant_type=password',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-anon-key', apikey: 'test-anon-key' }),
        }),
      )
      expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ access_token: 'test-access-token' })
    } finally {
      await auth.stopAutoRefresh()
      localStorage.removeItem(storageKey)
    }
  })

  it('rejects a configured URL that does not use HTTP or HTTPS', async () => {
    await expect(load('ftp://abcdef.supabase.co', 'anon-key')).rejects.toThrow(/HTTP or HTTPS/)
  })

  it('is off when the key is missing', async () => {
    const module = await load('https://abcdef.supabase.co', '')
    expect(module.authEnabled).toBe(false)
    expect(module.supabase).toBeNull()
    expect(module.sessionStorageKey).toBe('')
  })

  it('is off when nothing is set', async () => {
    const module = await load('', '')
    expect(module.authEnabled).toBe(false)
  })
})
