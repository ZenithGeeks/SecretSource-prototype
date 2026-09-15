/**
 * Auth screens — Sign in / Sign up / Forgot / Check email / Reset — matching the Figma.
 * Email + password and Google OAuth via Supabase Auth. Shown by Root when auth is enabled and
 * there is no session; on success, onAuthStateChange updates the session and Root moves on.
 * When Supabase isn't configured (preview via ?auth=), the forms render but submit shows a note.
 */

import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, Input } from '../../components/ui'
import { supabase } from '../../lib/supabase'

type View = 'signin' | 'signup' | 'forgot' | 'check' | 'reset'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="font-serif text-[22px] font-semibold tracking-tight">
      <span className="text-ink">Secret</span>
      <span className="text-accent">Source</span>
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-[400px] max-w-full flex-col items-center gap-3.5 rounded-2xl border border-border-subtle bg-surface p-8 shadow-xl">
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  right,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  right?: React.ReactNode
}) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="flex items-center justify-between text-[13px] font-medium text-ink">
        {label}
        {right}
      </span>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full" />
    </label>
  )
}

function GoogleButton({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border-subtle bg-surface py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent disabled:opacity-60"
    >
      <GoogleIcon />
      {label}
    </button>
  )
}

function Divider() {
  return (
    <div className="flex w-full items-center gap-2.5 text-xs text-ink-muted">
      <span className="h-px flex-1 bg-border-subtle" />
      or
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}

function ErrorText({ error }: { error: string }) {
  return error ? <p className="w-full text-center text-xs text-refutes">{error}</p> : null
}

const VIEWS: View[] = ['signin', 'signup', 'forgot', 'check', 'reset']

export function Auth() {
  const [view, setView] = useState<View>(() => {
    const p = new URLSearchParams(window.location.search).get('auth')
    return VIEWS.includes(p as View) ? (p as View) : 'signin'
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Supabase sends the password-reset link back here and fires PASSWORD_RECOVERY.
  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setView('reset')
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const go = (v: View) => {
    setError('')
    setView(v)
  }

  async function run(fn: () => Promise<{ error: { message: string } | null }>, after?: () => void) {
    if (!supabase) {
      setError('Sign-in isn’t configured yet — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    setBusy(true)
    setError('')
    const { error } = await fn()
    setBusy(false)
    if (error) setError(error.message)
    else after?.()
  }

  const redirectTo = window.location.origin

  const google = () =>
    run(() =>
      supabase!.auth.signInWithOAuth({
        provider: 'google',
        // Force Google's account chooser every time, so after signing out a user can pick a
        // different account instead of being silently re-logged into the last one.
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      }),
    )
  const signIn = () => run(() => supabase!.auth.signInWithPassword({ email, password }))
  const signUp = () =>
    run(
      () =>
        supabase!.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: redirectTo },
        }),
      () => go('check'),
    )
  const forgot = () =>
    run(() => supabase!.auth.resetPasswordForEmail(email, { redirectTo }), () => go('check'))
  const reset = () => {
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    run(() => supabase!.auth.updateUser({ password }), () => go('signin'))
  }

  const heading = (title: string, sub: string) => (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <h1 className="font-serif text-lg font-semibold text-ink">{title}</h1>
      <p className="text-[13px] text-ink-muted">{sub}</p>
    </div>
  )

  if (view === 'signup') {
    return (
      <Card>
        <Wordmark />
        {heading('Create your account', 'Start checking what your sources actually say.')}
        <GoogleButton label="Sign up with Google" onClick={google} busy={busy} />
        <Divider />
        <Field label="Full name" value={name} onChange={setName} placeholder="Your name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" />
        <ErrorText error={error} />
        <Button className="w-full justify-center" onClick={signUp} disabled={busy}>
          Create account
        </Button>
        <p className="text-[13px] text-ink-muted">
          Already have an account?{' '}
          <button type="button" onClick={() => go('signin')} className="font-medium text-accent hover:underline">
            Sign in
          </button>
        </p>
      </Card>
    )
  }

  if (view === 'forgot') {
    return (
      <Card>
        <Wordmark />
        {heading('Forgot your password?', "Enter your email and we'll send a reset link.")}
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <ErrorText error={error} />
        <Button className="w-full justify-center" onClick={forgot} disabled={busy}>
          Send reset link
        </Button>
        <button type="button" onClick={() => go('signin')} className="text-[13px] text-ink-muted hover:text-ink">
          ← Back to <span className="font-medium text-accent">Sign in</span>
        </button>
      </Card>
    )
  }

  if (view === 'check') {
    return (
      <Card>
        <Wordmark />
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft">
          <Mail className="size-6 text-accent" />
        </span>
        {heading('Check your email', `We sent a link to ${email || 'your inbox'}. It expires in 30 minutes.`)}
        <Button variant="ghost" className="w-full justify-center" onClick={forgot} disabled={busy}>
          Resend link
        </Button>
        <button type="button" onClick={() => go('signin')} className="text-[13px] text-ink-muted hover:text-ink">
          ← Back to <span className="font-medium text-accent">Sign in</span>
        </button>
      </Card>
    )
  }

  if (view === 'reset') {
    return (
      <Card>
        <Wordmark />
        {heading('Set a new password', "Choose a strong password you don't use elsewhere.")}
        <Field label="New password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="Re-enter your password" />
        <ErrorText error={error} />
        <Button className="w-full justify-center" onClick={reset} disabled={busy}>
          Update password
        </Button>
      </Card>
    )
  }

  // signin
  return (
    <Card>
      <Wordmark />
      {heading('Sign in', 'Welcome back — check your citations.')}
      <GoogleButton label="Continue with Google" onClick={google} busy={busy} />
      <Divider />
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="••••••••"
        right={
          <button type="button" onClick={() => go('forgot')} className="text-xs font-normal text-accent hover:underline">
            Forgot?
          </button>
        }
      />
      <ErrorText error={error} />
      <Button className="w-full justify-center" onClick={signIn} disabled={busy}>
        Sign in
      </Button>
      <p className="text-[13px] text-ink-muted">
        New to SecretSource?{' '}
        <button type="button" onClick={() => go('signup')} className="font-medium text-accent hover:underline">
          Create account
        </button>
      </p>
    </Card>
  )
}
