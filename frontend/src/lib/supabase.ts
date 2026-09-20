/**
 * Supabase browser client for auth. Configured from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * (the anon key is public — safe in the frontend). When unset, `authEnabled` is false and the
 * app runs without a login gate (the prototype's current behaviour); set both to turn auth on.
 */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// VITE_USE_MOCKS=1 is a no-backend dev mode; skip the login gate too, so the whole app runs
// from fixtures with one command and no Supabase.
export const authEnabled = Boolean(url && anonKey) && import.meta.env.VITE_USE_MOCKS !== '1'

export const supabase = authEnabled ? createClient(url as string, anonKey as string) : null

/** Where supabase-js keeps the session in localStorage: `sb-<project ref>-auth-token`, the
 * default it derives from the URL. */
export const sessionStorageKey = authEnabled ? `sb-${new URL(url as string).hostname.split('.')[0]}-auth-token` : ''
