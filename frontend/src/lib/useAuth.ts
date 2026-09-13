/** Current Supabase auth session, kept live. When auth is disabled (no env), returns no
 * session and never loads, so the app renders open. */

import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

import { supabase } from './supabase'

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
