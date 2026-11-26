/** lib/useAuth.ts: the live session, signing out, and ending a session the gateway refused. */

import type { Session } from '@supabase/auth-js'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endSession, signOut, useAuth } from '../src/lib/useAuth'

// A getter, so a test can switch between "auth is off" and a fake client.
const mocked = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../src/lib/supabase', () => ({
  get supabase() {
    return mocked.client
  },
  authEnabled: true,
  sessionStorageKey: 'sb-test-auth-token',
}))

const session = { access_token: 'tok' } as Session

function fakeClient() {
  const unsubscribe = vi.fn()
  let listener: (event: string, next: Session | null) => void = () => {}
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session } }),
    onAuthStateChange: vi.fn((cb: typeof listener) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  return { auth, unsubscribe, emit: (next: Session | null) => listener('SIGNED_IN', next) }
}

let client: ReturnType<typeof fakeClient>

beforeEach(() => {
  client = fakeClient()
  mocked.client = client
})
afterEach(() => {
  mocked.client = null
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useAuth', () => {
  it('loads the stored session, follows later changes and stops listening on unmount', async () => {
    const { result, unmount } = renderHook(() => useAuth())
    expect(result.current).toEqual({ session: null, loading: true })

    await waitFor(() => expect(result.current).toEqual({ session, loading: false }))

    act(() => client.emit(null))
    expect(result.current.session).toBeNull()

    unmount()
    expect(client.unsubscribe).toHaveBeenCalled()
  })

  it('returns no session and never loads when auth is off', () => {
    mocked.client = null
    const { result } = renderHook(() => useAuth())
    expect(result.current).toEqual({ session: null, loading: false })
  })
})

describe('signOut', () => {
  it('signs out this browser only', async () => {
    await signOut()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('does nothing when auth is off', async () => {
    mocked.client = null
    await expect(signOut()).resolves.toBeUndefined()
  })
})

describe('endSession', () => {
  it('signs out once when that works', async () => {
    await endSession()
    expect(client.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('does nothing when auth is off', async () => {
    mocked.client = null
    await expect(endSession()).resolves.toBeUndefined()
  })

  it('removes the stored session and signs out again when the first sign-out fails', async () => {
    localStorage.setItem('sb-test-auth-token', 'dead session')
    client.auth.signOut.mockResolvedValueOnce({ error: new Error('network') })

    await endSession()

    expect(localStorage.getItem('sb-test-auth-token')).toBeNull()
    expect(client.auth.signOut).toHaveBeenCalledTimes(2)
  })

  it('still signs out again when storage cannot be written', async () => {
    client.auth.signOut.mockResolvedValueOnce({ error: new Error('network') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    await endSession()

    expect(client.auth.signOut).toHaveBeenCalledTimes(2)
  })
})
