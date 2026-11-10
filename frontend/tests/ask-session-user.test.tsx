/** Whose Ask state to read while sign-in is still resolving (lib/askSession). */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  storageKey: 'sb-test-auth-token',
  loading: true,
  session: null as { user: { id: string } } | null,
}))

vi.mock('../src/lib/supabase', () => ({
  authEnabled: true,
  supabase: null,
  get sessionStorageKey() {
    return state.storageKey
  },
}))
vi.mock('../src/lib/useAuth', () => ({
  useAuth: () => ({ session: state.session, loading: state.loading }),
}))

import { signedInUserId, useAskUserId, userIdFromStoredSession } from '../src/lib/askSession'

beforeEach(() => {
  state.storageKey = 'sb-test-auth-token'
  state.loading = true
  state.session = null
  window.localStorage.clear()
})

describe('the user id in a stored session', () => {
  it('is none when the stored value is not an object', () => {
    expect(userIdFromStoredSession('null')).toBeNull()
    expect(userIdFromStoredSession('"ann"')).toBeNull()
    expect(userIdFromStoredSession('7')).toBeNull()
  })
})

describe('the user while sign-in resolves', () => {
  it('is the one this browser was signed in as', () => {
    window.localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'ann' } }))

    expect(signedInUserId()).toBe('ann')
    expect(renderHook(() => useAskUserId()).result.current).toBe('ann')
  })

  it('is nobody when nothing is stored, or login is off', () => {
    expect(renderHook(() => useAskUserId()).result.current).toBeNull()

    window.localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'ann' } }))
    state.storageKey = ''
    expect(signedInUserId()).toBeNull()
  })

  it('is the session’s user once sign-in has resolved, or nobody when signed out', () => {
    window.localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'ann' } }))
    state.loading = false
    state.session = { user: { id: 'bob' } }
    expect(renderHook(() => useAskUserId()).result.current).toBe('bob')

    state.session = null
    expect(renderHook(() => useAskUserId()).result.current).toBeNull()
  })
})
