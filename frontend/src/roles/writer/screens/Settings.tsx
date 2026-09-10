/**
 * Settings (Writer) — account, checking defaults, notifications, appearance, data. Mirrors
 * researcher Settings' structure exactly (same shared `lib/settings.ts` module — settings are
 * account-scoped, not per-role — same Section/Row/Toggle/Select helpers), showing only the
 * fields that make sense for a writer instead of a researcher's library/field-map ones.
 * "Switch role" hands back to onboarding; "Delete all" clears writerStore's drafts/claims.
 */

import type { ReactNode } from 'react'

import { Button, Input } from '../../../components/ui'
import { useWriterActions } from '../../../lib/useWriter'
import { store } from '../../../lib/writerStore'
import type { Settings as SettingsType } from '../../../lib/settings'
import { updateSettings, useSettings } from '../../../lib/settings'
import { cn } from '../../../lib/utils'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-border-subtle',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border-subtle bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus-visible:border-accent"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function Settings({ onChangeRole }: { onChangeRole?: () => void }) {
  // TODO gateway: GET/PATCH /settings. Persisted to localStorage until then.
  const s = useSettings()
  const actions = useWriterActions()
  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) =>
    updateSettings({ [key]: value } as Partial<SettingsType>)

  const changeEmail = () => {
    const email = window.prompt('New email address', s.email)?.trim()
    if (email) set('email', email)
  }
  const changePassword = () => {
    if (window.prompt('New password (min 8 characters)')) window.alert('Password updated.')
  }

  const exportData = () => {
    const data = JSON.stringify({ drafts: store.drafts(), claims: store.claims() }, null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'secretsource-writer-data.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const deleteAll = () => {
    if (window.confirm('Delete all drafts and their checks? This cannot be undone.')) {
      actions.deleteAll()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-ink-muted">Changes apply to new checks. Nothing already checked is re-run.</p>
      </header>

      <Section title="Account">
        <Row label="Display name" hint="Used in greetings and on shared reports.">
          <Input value={s.displayName} onChange={(e) => set('displayName', e.target.value)} className="w-56" />
        </Row>
        <Row label="Email" hint="Sign-in address and where the weekly digest is sent.">
          <span className="mr-3 text-sm text-ink-muted">{s.email}</span>
          <Button variant="ghost" onClick={changeEmail}>
            Change
          </Button>
        </Row>
        <Row label="Password" hint="Last changed 3 months ago.">
          <Button variant="ghost" onClick={changePassword}>
            Change password
          </Button>
        </Row>
      </Section>

      <Section title="Role and home screen">
        <Row label="Current role" hint="Picks your home screen and quick actions. Change it any time.">
          <span className="mr-3 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">Writer</span>
          <Button variant="ghost" onClick={onChangeRole}>
            Switch role
          </Button>
        </Row>
      </Section>

      <Section title="Checking defaults">
        <Row
          label="How strict a match must be"
          hint="Balanced asks the source to state the claim. Strict also asks for the same numbers."
        >
          <Select value={s.strictness} options={['Lenient', 'Balanced', 'Strict']} onChange={(v) => set('strictness', v)} />
        </Row>
        <Row label="Flag quotes that differ from the source" hint="Word-for-word comparison for anything in quote marks.">
          <Toggle on={s.flagQuotes} onChange={(v) => set('flagQuotes', v)} />
        </Row>
      </Section>

      <Section title="Notifications">
        <Row label="Weekly digest" hint="What changed in your drafts, sent to your email.">
          <Toggle on={s.weeklyDigest} onChange={(v) => set('weeklyDigest', v)} />
        </Row>
        <Row label="Send it on">
          <Select
            value={s.digestDay}
            options={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}
            onChange={(v) => set('digestDay', v)}
          />
        </Row>
        <Row label="When a re-check finishes" hint="Only for claims you left running.">
          <Toggle on={s.notifyDone} onChange={(v) => set('notifyDone', v)} />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme" hint="Dark is tuned for long reading sessions.">
          <Select value={s.theme} options={['Match system', 'Light', 'Dark']} onChange={(v) => set('theme', v as SettingsType['theme'])} />
        </Row>
        <Row label="Colour the verdict badges" hint="Off shows verdicts as plain text, for printing and screenshots.">
          <Toggle on={s.colorBadges} onChange={(v) => set('colorBadges', v)} />
        </Row>
      </Section>

      <Section title="Your data">
        <Row label="Export your data" hint="Drafts, claims and verdicts as a JSON file.">
          <Button variant="ghost" onClick={exportData}>
            Export
          </Button>
        </Row>
        <Row label="Delete all drafts" hint="Removes every draft and the checks made on them. This cannot be undone.">
          <button type="button" onClick={deleteAll} className="text-sm font-medium text-refutes hover:underline">
            Delete all
          </button>
        </Row>
      </Section>
    </div>
  )
}
