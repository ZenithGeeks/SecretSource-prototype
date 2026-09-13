/**
 * Settings (Researcher) — account, checking defaults, field-map, notifications, appearance,
 * data. Local state for now; each control maps to a future user-settings endpoint (settings
 * are account-scoped, shared across roles). "Switch role" hands back to onboarding.
 */

import { Button, Input } from '../../../components/ui'
import { researcherApi } from '../../../lib/researcher'
import type { Settings as SettingsType } from '../../../lib/settings'
import { updateSettings, useSettings } from '../../../lib/settings'
import { cn } from '../../../lib/utils'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-ink">
        {title}
      </h2>
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
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

function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
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
  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) =>
    updateSettings({ [key]: value } as Partial<SettingsType>)

  const changeEmail = () => {
    const email = window.prompt('New email address', s.email)?.trim()
    if (email) set('email', email)
  }
  const changePassword = () => {
    if (window.prompt('New password (min 8 characters)')) window.alert('Password updated.')
  }

  const exportLibrary = async () => {
    const projects = await researcherApi.getProjects()
    const libraries = Object.fromEntries(
      await Promise.all(projects.map(async (p) => [p.id, await researcherApi.getLibrary(p.id)] as const)),
    )
    const data = JSON.stringify({ projects, libraries }, null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'secretsource-library.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const deleteAll = () => {
    // TODO gateway: DELETE /researcher/papers — for now just confirm the destructive intent.
    window.confirm(
      'Delete all uploaded papers? This removes the files and every check made on them. This cannot be undone.',
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[22px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-ink-muted">
          Changes apply to new checks. Nothing already checked is re-run.
        </p>
      </header>

      <Section title="Account">
        <Row label="Display name" hint="Used in greetings and on shared reports.">
          <Input
            value={s.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            className="w-56"
          />
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
          <span className="mr-3 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
            Researcher
          </span>
          <Button variant="ghost" onClick={onChangeRole}>
            Switch role
          </Button>
        </Row>
      </Section>

      <Section title="Checking defaults">
        <Row
          label="Paper version to check"
          hint="When a preprint and a published version both exist, check the newer one."
        >
          <Select
            value={s.paperVersion}
            options={['Newest', 'Published', 'Preprint']}
            onChange={(v) => set('paperVersion', v)}
          />
        </Row>
        <Row
          label="How strict a match must be"
          hint="Balanced asks the source to state the claim. Strict also asks for the same numbers."
        >
          <Select
            value={s.strictness}
            options={['Lenient', 'Balanced', 'Strict']}
            onChange={(v) => set('strictness', v)}
          />
        </Row>
        <Row
          label="Check a paper as soon as it is added"
          hint="Otherwise papers are indexed and wait for you."
        >
          <Toggle on={s.checkOnAdd} onChange={(v) => set('checkOnAdd', v)} />
        </Row>
        <Row
          label="Flag quotes that differ from the source"
          hint="Word-for-word comparison for anything in quote marks."
        >
          <Toggle on={s.flagQuotes} onChange={(v) => set('flagQuotes', v)} />
        </Row>
      </Section>

      <Section title="Field map">
        <Row
          label="Group papers by"
          hint="Meaning puts papers that make the same claim together. Citations group by who cites whom."
        >
          <Select
            value={s.groupBy}
            options={['Meaning', 'Citations']}
            onChange={(v) => set('groupBy', v)}
          />
        </Row>
        <Row
          label="Smallest group to draw"
          hint="Anything smaller stays folded until you open the cluster."
        >
          <Select
            value={s.smallestGroup}
            options={['2 papers', '3 papers', '4 papers', '5 papers']}
            onChange={(v) => set('smallestGroup', v)}
          />
        </Row>
        <Row
          label="Mark disagreements on the map"
          hint="Draws a marked edge wherever two papers answer the same claim differently."
        >
          <Toggle on={s.markDisagreements} onChange={(v) => set('markDisagreements', v)} />
        </Row>
      </Section>

      <Section title="Notifications">
        <Row label="Weekly digest" hint="What changed in your library, sent to your email.">
          <Toggle on={s.weeklyDigest} onChange={(v) => set('weeklyDigest', v)} />
        </Row>
        <Row label="Send it on">
          <Select
            value={s.digestDay}
            options={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}
            onChange={(v) => set('digestDay', v)}
          />
        </Row>
        <Row
          label="When a new paper conflicts with your library"
          hint="A saved paper and a new one disagree about the same claim."
        >
          <Toggle on={s.notifyConflict} onChange={(v) => set('notifyConflict', v)} />
        </Row>
        <Row label="When a check finishes" hint="Only for papers you left running.">
          <Toggle on={s.notifyDone} onChange={(v) => set('notifyDone', v)} />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme" hint="Dark is tuned for long reading sessions in the page viewer.">
          <Select
            value={s.theme}
            options={['Match system', 'Light', 'Dark']}
            onChange={(v) => set('theme', v as SettingsType['theme'])}
          />
        </Row>
        <Row
          label="Colour the verdict badges"
          hint="Off shows verdicts as plain text, for printing and screenshots."
        >
          <Toggle on={s.colorBadges} onChange={(v) => set('colorBadges', v)} />
        </Row>
      </Section>

      <Section title="Your data">
        <Row label="Export your library" hint="Papers, claims and verdicts as a JSON file.">
          <Button variant="ghost" onClick={exportLibrary}>
            Export
          </Button>
        </Row>
        <Row
          label="Delete all uploaded papers"
          hint="Removes the files and every check made on them. This cannot be undone."
        >
          <button
            type="button"
            onClick={deleteAll}
            className="text-sm font-medium text-refutes hover:underline"
          >
            Delete all
          </button>
        </Row>
      </Section>
    </div>
  )
}
