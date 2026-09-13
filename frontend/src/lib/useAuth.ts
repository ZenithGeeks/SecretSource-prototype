/** Current Supabase auth session, kept live. When auth is disabled (no env), returns no
 * session and never loads, so the app renders open. */

import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

import { sessionStorageKey, supabase } from './supabase'

export function useAuth(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  return { session, loading }
}

export async function signOut(): Promise<void> {
  // scope:'local' signs out only this browser (the default 'global' revokes the user's
  // refresh tokens on every device). The SIGNED_OUT listener in main.tsx then clears the
  // React Query cache and resets the settings store so the next user starts clean.
  await supabase?.auth.signOut({ scope: 'local' })
}

/**
 * Sign out on this browser because the gateway can no longer be told who is asking: there is
 * no session to send, or the gateway refused the one sent (#147). The sign-in screen follows.
 *
 * When a token refresh fails on a network error, auth-js keeps the dead session in storage, and
 * its signOut then returns that error without signing out, so the app would stay on screen
 * with no working session. In that case the stored session is removed first; the second
 * signOut finds none and fires SIGNED_OUT, which clears the cache and shows the sign-in screen.
 */
export async function endSession(): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (!error) return
  try {
    localStorage.removeItem(sessionStorageKey)
  } catch {
    /* storage unavailable: nothing stored to remove */
  }
  await supabase.auth.signOut({ scope: 'local' })
}
