/** lib/supabase.ts reads its settings from import.meta.env when it is imported, so each case
 * sets the environment and imports a fresh copy. */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
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
