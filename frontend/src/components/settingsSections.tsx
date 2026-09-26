/**
 * The six sections shared by every role's Settings modal (Figma 22a–22f), plus the two
 * role-specific extras (Field map for researcher, Class and marking for teacher). One copy of
 * each — role differences are confined to Account/YourData's actions and the two extra tabs,
 * everything else reads and writes the same shared stores regardless of who is viewing.
 */

import type { ComponentType } from 'react'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { Role } from '../screens/Onboarding'
import { accountApi } from '../lib/accountApi'
import { API_BASE } from '../lib/api'
import { downloadText } from '../lib/csv'
import { researcherApi } from '../lib/researcher'
import { getSettings, updateSettings, useSettings } from '../lib/settings'
import type { ThemeChoice } from '../lib/settings'
import { authEnabled, supabase } from '../lib/supabase'
import { useTeacherPreferences } from '../lib/teacherPreferences'
import { useResetMockTeacherData, useTeacherClasses, useTeacherWorkspace } from '../lib/useTeacher'
import { classResultsCsv } from '../lib/teacherSelectors'
import { useSetSetting, useSetTeacherPreference } from '../lib/useAccountSettings'
import { useAuth } from '../lib/useAuth'
import { useClaims, useDrafts, useWriterActions } from '../lib/useWriter'
import { Avatar, Row, Section, Select, Toggle } from './settings'

function Notice({ text }: { text: string }) {
  if (!text) return null
  return (
    <p role="status" className="w-full rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink">
      {text}
    </p>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** `avatarUrl` round-trips through the server's freeform preferences blob (PreferencesPatch
 * accepts any JSON), so a crafted PATCH could point it at an external URL — and it feeds
 * AuthorizedImage, which attaches the signed-in user's Bearer token to whatever it's given.
 * Only ever trust our own gateway path, never fetch a stored URL as this user against
 * somewhere else. */
function isOwnAvatarUrl(url: string): boolean {
  return url.startsWith('/api/user/avatar/')
}

/** The stored value is the gateway's bare `/api/user/avatar/me?v=…` path; it is prefixed
 * with API_BASE only here, at render, the way figureImageUrl does, so it still reaches the
 * gateway when the frontend is served from another origin (VITE_GATEWAY_URL). */
function avatarPhotoUrl(stored: string): string | undefined {
  return stored && isOwnAvatarUrl(stored) ? `${API_BASE}${stored}` : undefined
}

export function AccountSection() {
  const settings = useSettings()
  const set = useSetSetting()
  const { session } = useAuth()
  const email = session?.user?.email ?? settings.email
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const pickAvatar = () => fileRef.current?.click()

  const uploadAvatar = async (file: File) => {
    if (!AVATAR_TYPES.has(file.type)) {
      setNotice('Avatars must be a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setNotice('Avatars must be under 2MB.')
      return
    }
    setBusy(true)
    // Optimistic local write plus PATCH, the same contract as useSetSetting — otherwise the
    // store would show the new photo while the server blob still had the old one, until the
    // next open quietly reverted it. Unlike useSetSetting there is no rollback once the upload
    // has gone through: the backend keeps one avatar file per user and the upload has already
    // replaced it (_replace_avatar), so the previous url would now serve this new photo, or
    // show initials over a photo that exists. The store follows the disk; the notice says the
    // account record is behind.
    let uploaded = false
    try {
      const { url } = await accountApi.uploadAvatar(file)
      uploaded = true
      updateSettings({ avatarUrl: url })
      await accountApi.patchPreferences({ avatarUrl: url })
      setNotice('')
    } catch {
      setNotice(
        uploaded
          ? 'The photo was uploaded, but it could not be saved to your account. Try again.'
          : 'The avatar could not be uploaded. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const removeAvatar = async () => {
    setBusy(true)
    const previous = getSettings().avatarUrl
    try {
      await accountApi.removeAvatar()
      updateSettings({ avatarUrl: '' })
      await accountApi.patchPreferences({ avatarUrl: '' })
    } catch {
      // The file may already be gone; the url then fails to load and Avatar shows initials.
      updateSettings({ avatarUrl: previous })
      setNotice('The avatar could not be removed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const changeEmail = async () => {
    if (!authEnabled || !supabase) {
      setNotice('Sign in to change your email address.')
      return
    }
    const next = window.prompt('New email address', email)?.trim()
    if (!next || next === email) return
    const { error } = await supabase.auth.updateUser({ email: next })
    setNotice(error ? error.message : 'Check your inbox to confirm the new address.')
  }

  const changePassword = async () => {
    if (!authEnabled || !supabase) {
      setNotice('Sign in to change your password.')
      return
    }
    const next = window.prompt('New password (min 8 characters)')
    if (!next) return
    if (next.length < 8) {
      setNotice('Password must be at least 8 characters.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: next })
    setNotice(error ? error.message : 'Password updated.')
  }

  return (
    <Section title="Account">
      {notice && <Notice text={notice} />}
      <Row
        label="Avatar"
        hint="Shown in the sidebar and on anything you share. Square image, at least 128px."
      >
        <Avatar
          initials={initials(settings.displayName)}
          photoUrl={avatarPhotoUrl(settings.avatarUrl)}
          size={48}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void uploadAvatar(file)
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={pickAvatar}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft disabled:opacity-50"
        >
          Upload
        </button>
        <button
          type="button"
          disabled={busy || !settings.avatarUrl}
          onClick={() => void removeAvatar()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft disabled:opacity-50"
        >
          Remove
        </button>
      </Row>
      <Row label="Display name" hint="Used in greetings and on shared reports.">
        <input
          value={settings.displayName}
          onChange={(e) => set('displayName', e.target.value)}
          // Stored as typed while editing (a trailing space may be mid-name), tidied on blur.
          // Readers cope with '' (initials show "?", the greeting drops the name).
          onBlur={(e) => {
            const trimmed = e.target.value.trim()
            if (trimmed !== e.target.value) set('displayName', trimmed)
          }}
          className="h-9 w-[180px] rounded-lg border border-border-subtle bg-canvas px-3 text-sm outline-none focus-visible:border-accent"
        />
      </Row>
      <Row label="Email" hint="Sign-in address and where the weekly digest is sent.">
        <span className="text-sm text-ink-muted">{email}</span>
        <button
          type="button"
          onClick={() => void changeEmail()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft"
        >
          Change
        </button>
      </Row>
      <Row label="Password" hint="Last changed 3 months ago.">
        <button
          type="button"
          onClick={() => void changePassword()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft"
        >
          Change password
        </button>
      </Row>
    </Section>
  )
}

export function RoleSection({
  roleLabel,
  roleIcon: RoleIcon,
  onSwitchRole,
}: {
  roleLabel: string
  roleIcon: ComponentType<{ className?: string }>
  onSwitchRole: () => void
}) {
  return (
    <Section title="Role and home screen">
      <Row label="Current role" hint="Picks your home screen and quick actions. Change it any time.">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
          <RoleIcon className="size-4" />
          {roleLabel}
        </span>
        <button
          type="button"
          onClick={onSwitchRole}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft"
        >
          Switch role
        </button>
      </Row>
    </Section>
  )
}

export function CheckingSection() {
  const s = useSettings()
  const set = useSetSetting()
  return (
    <Section title="Checking defaults">
      <Row label="Citation style" hint="Used when a replacement citation is suggested.">
        <Select
          value={s.citationStyle}
          options={['APA 7th', 'MLA 9th', 'Chicago']}
          onChange={(v) => set('citationStyle', v)}
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
  )
}

export function NotificationsSection() {
  const s = useSettings()
  const set = useSetSetting()
  return (
    <Section title="Notifications">
      <Row label="Weekly digest" hint="What changed in your library, sent to your email.">
        <Toggle on={s.weeklyDigest} onChange={(v) => set('weeklyDigest', v)} />
      </Row>
      <Row label="Send it on">
        <Select
          value={s.digestDay}
          disabled={!s.weeklyDigest}
          options={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}
          onChange={(v) => set('digestDay', v)}
        />
      </Row>
      <Row label="When a check finishes" hint="Only for papers you left running.">
        <Toggle on={s.notifyDone} onChange={(v) => set('notifyDone', v)} />
      </Row>
    </Section>
  )
}

export function AppearanceSection() {
  const s = useSettings()
  const set = useSetSetting()
  return (
    <Section title="Appearance">
      <Row label="Theme" hint="Dark is tuned for long reading sessions in the page viewer.">
        <Select
          value={s.theme}
          options={['Match system', 'Light', 'Dark']}
          onChange={(v) => set('theme', v as ThemeChoice)}
        />
      </Row>
      <Row
        label="Colour the verdict badges"
        hint="Off shows verdicts as plain text, for printing and screenshots."
      >
        <Toggle on={s.colorBadges} onChange={(v) => set('colorBadges', v)} />
      </Row>
    </Section>
  )
}

function papers(n: number): string {
  return `${n} ${n === 1 ? 'paper' : 'papers'}`
}

function ResearcherYourData({ isPreview }: { isPreview: boolean }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const exportLibrary = async () => {
    setBusy(true)
    try {
      const projects = await researcherApi.getProjects()
      const libraries = Object.fromEntries(
        await Promise.all(
          projects.map(async (p) => [p.id, await researcherApi.getLibrary(p.id)] as const),
        ),
      )
      downloadText(
        'secretsource-library.json',
        JSON.stringify({ projects, libraries }, null, 2),
        'application/json',
      )
      setNotice('Library exported.')
    } finally {
      setBusy(false)
    }
  }

  const deleteAll = async () => {
    if (!window.confirm('Delete all uploaded papers? This removes the files and every check made on them. This cannot be undone.')) return
    setBusy(true)
    try {
      const { deleted, skipped } = await accountApi.deleteAllData()
      await queryClient.invalidateQueries({ queryKey: ['researcher'] })
      await queryClient.invalidateQueries({ queryKey: ['analyses'] })
      setNotice(
        skipped > 0
          ? `${papers(deleted)} deleted. ${papers(skipped)} still being checked ${skipped === 1 ? 'was' : 'were'} kept; delete again once ${skipped === 1 ? 'it finishes' : 'they finish'}.`
          : 'Every uploaded paper was deleted.',
      )
    } catch {
      setNotice('Delete failed — the papers are still there. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Your data">
      {notice && <Notice text={notice} />}
      <Row label="Export your library" hint="Papers, claims and verdicts as a JSON file.">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportLibrary()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft disabled:opacity-50"
        >
          Export
        </button>
      </Row>
      <Row
        label="Delete all uploaded papers"
        hint={
          isPreview
            ? 'Removes the files and every check made on them. Switch to Researcher to delete.'
            : 'Removes the files and every check made on them. This cannot be undone.'
        }
      >
        <button
          type="button"
          disabled={busy || isPreview}
          onClick={() => void deleteAll()}
          className="text-sm font-medium text-refutes hover:underline disabled:opacity-50"
        >
          Delete all
        </button>
      </Row>
    </Section>
  )
}

function WriterYourData({ isPreview }: { isPreview: boolean }) {
  const drafts = useDrafts()
  const claims = useClaims()
  const actions = useWriterActions()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const exportLibrary = () => {
    downloadText(
      'secretsource-library.json',
      JSON.stringify({ drafts: drafts.data ?? [], claims: claims.data ?? [] }, null, 2),
      'application/json',
    )
    setNotice('Library exported.')
  }

  const deleteAll = () => {
    if (!window.confirm('Delete all drafts? This removes every draft and check made on them. This cannot be undone.')) return
    setBusy(true)
    try {
      actions.deleteAll()
      setNotice('Every draft was deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Your data">
      {notice && <Notice text={notice} />}
      <Row label="Export your library" hint="Drafts and claims as a JSON file.">
        <button
          type="button"
          disabled={!drafts.data || !claims.data}
          onClick={exportLibrary}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft disabled:opacity-50"
        >
          Export
        </button>
      </Row>
      <Row
        label="Delete all drafts"
        hint={
          isPreview
            ? 'Removes every draft and check made on them. Switch to Author to delete.'
            : 'Removes every draft and check made on them. This cannot be undone.'
        }
      >
        <button
          type="button"
          disabled={busy || isPreview}
          onClick={deleteAll}
          className="text-sm font-medium text-refutes hover:underline disabled:opacity-50"
        >
          Delete all
        </button>
      </Row>
    </Section>
  )
}

function TeacherYourData({ isPreview }: { isPreview: boolean }) {
  const teacher = useTeacherPreferences()
  const workspace = useTeacherWorkspace(teacher.defaultClassId)
  const resetData = useResetMockTeacherData()
  const [notice, setNotice] = useState('')

  const exportResults = () => {
    if (!workspace.data) {
      setNotice('The local class data is still loading.')
      return
    }
    downloadText('class-results.csv', classResultsCsv(workspace.data), 'text/csv;charset=utf-8')
    setNotice('Class results exported locally.')
  }

  const deleteAll = () => {
    if (!window.confirm('Reset the local essay data? This cannot affect Classroom, Drive, or student files.')) return
    resetData.mutate(undefined, { onSuccess: () => setNotice('Local uploaded essay data was reset.') })
  }

  return (
    <Section title="Your data">
      {notice && <Notice text={notice} />}
      <Row label="Export class results" hint="A CSV of the selected local class — this is a browser-only file, not a backend export.">
        <button
          type="button"
          onClick={exportResults}
          className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-accent-soft"
        >
          Export
        </button>
      </Row>
      <Row
        label="Delete local essay data"
        hint={
          isPreview
            ? 'Resets the mock essay review data in this browser. Switch to Teacher to delete.'
            : 'Resets the mock essay review data in this browser. This cannot be undone.'
        }
      >
        <button
          type="button"
          disabled={resetData.isPending || isPreview}
          onClick={deleteAll}
          className="text-sm font-medium text-refutes hover:underline disabled:opacity-50"
        >
          Delete all
        </button>
      </Row>
    </Section>
  )
}

export function YourDataSection({ role, isPreview }: { role: Role; isPreview: boolean }) {
  if (role === 'researcher') return <ResearcherYourData isPreview={isPreview} />
  if (role === 'writer') return <WriterYourData isPreview={isPreview} />
  return <TeacherYourData isPreview={isPreview} />
}

/** `isPreview`: the modal is showing this role's tabs to someone signed in as another role
 * (Roles group in the aside). The controls still show the stored values but cannot save. */
export function FieldMapSection({ isPreview }: { isPreview: boolean }) {
  const s = useSettings()
  const set = useSetSetting()
  return (
    <Section title="Field map">
      {isPreview && <Notice text="You are previewing Researcher settings. Switch to Researcher to change them." />}
      <Row
        label="Group papers by"
        hint="Meaning puts papers that make the same claim together. Citations group by who cites whom."
      >
        <Select
          value={s.groupBy}
          options={['Meaning', 'Citations']}
          onChange={(v) => set('groupBy', v)}
          disabled={isPreview}
        />
      </Row>
      <Row label="Smallest group to draw" hint="Anything smaller stays folded until you open the cluster.">
        <Select
          value={s.smallestGroup}
          options={['2 papers', '3 papers', '4 papers', '5 papers']}
          onChange={(v) => set('smallestGroup', v)}
          disabled={isPreview}
        />
      </Row>
      <Row
        label="Mark disagreements on the map"
        hint="Draws a marked edge wherever two papers answer the same claim differently."
      >
        <Toggle on={s.markDisagreements} onChange={(v) => set('markDisagreements', v)} disabled={isPreview} />
      </Row>
    </Section>
  )
}

/** Same `isPreview` contract as FieldMapSection. */
export function ClassMarkingSection({ isPreview }: { isPreview: boolean }) {
  const teacher = useTeacherPreferences()
  const classes = useTeacherClasses()
  const set = useSetTeacherPreference()
  return (
    <Section title="Class and marking">
      {isPreview && <Notice text="You are previewing Teacher settings. Switch to Teacher to change them." />}
      <Row label="Default class" hint="The class used when exporting results.">
        <Select
          value={teacher.defaultClassId}
          options={(classes.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.section}` }))}
          onChange={(v) => set('defaultClassId', v)}
          disabled={isPreview}
        />
      </Row>
      <Row label="Hide student names" hint="Use initials in review lists.">
        <Toggle on={teacher.hideStudentNames} onChange={(v) => set('hideStudentNames', v)} disabled={isPreview} />
      </Row>
      <Row label="Show student report" hint="Allow a report preview to be prepared.">
        <Toggle
          on={teacher.studentReportVisibility}
          onChange={(v) => set('studentReportVisibility', v)}
          disabled={isPreview}
        />
      </Row>
      <Row label="Send reports as" hint="Displayed sender name.">
        <input
          value={teacher.sendReportsAs}
          onChange={(e) => set('sendReportsAs', e.target.value)}
          disabled={isPreview}
          className="h-9 w-[180px] rounded-lg border border-border-subtle bg-canvas px-3 text-sm outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
      </Row>
    </Section>
  )
}
