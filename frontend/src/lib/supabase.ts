/**
 * Supabase browser client for auth. Configured from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * (the anon key is public — safe in the frontend). When unset, `authEnabled` is false and the
 * app runs without a login gate (the prototype's current behaviour); set both to turn auth on.
 */

import { AuthClient } from '@supabase/auth-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const authEnabled = Boolean(url && anonKey)

function createAuthConfig(url: string, key: string) {
  const base = url.trim()
  if (!/^https?:\/\//i.test(base)) throw new Error('Supabase URL must use HTTP or HTTPS.')
  const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`)
  // Keep existing sessions and the key used by endSession to clear a rejected session.
  const storageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
  const auth = new AuthClient({
    url: new URL('auth/v1', baseUrl).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    storageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  })
  return { auth, storageKey }
}

// The app only uses Supabase Auth. Keep the existing auth interface without bundling
// the database, storage, realtime and functions clients.
const config = url && anonKey ? createAuthConfig(url, anonKey) : null
export const supabase = config && { auth: config.auth }
export const sessionStorageKey = config?.storageKey ?? ''
