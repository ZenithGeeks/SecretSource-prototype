import { Download, LockKeyhole, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button, Card, Input } from '../../../components/ui'
import { downloadText } from '../../../lib/csv'
import { classResultsCsv } from '../../../lib/teacherSelectors'
import { updateSettings, useSettings } from '../../../lib/settings'
import { useResetMockTeacherData, useTeacherClasses, useTeacherWorkspace } from '../../../lib/useTeacher'
import { updateTeacherPreferences, useTeacherPreferences } from '../../../lib/teacherPreferences'
import { TeacherDialog } from '../components/TeacherDialog'
import { PageHeading, StatusPill } from '../components/TeacherUi'

export function Settings() {
  const shared = useSettings()
  const teacher = useTeacherPreferences()
  const classes = useTeacherClasses()
  const workspace = useTeacherWorkspace(teacher.defaultClassId)
  const resetData = useResetMockTeacherData()
  const [notice, setNotice] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const notify = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3500)
  }
  const updateTeacher = <K extends keyof typeof teacher>(key: K, value: (typeof teacher)[K]) => updateTeacherPreferences({ [key]: value } as Partial<typeof teacher>)
  const exportResults = () => {
    if (!workspace.data) {
      notify('The local class data is still loading.')
      return
    }
    downloadText('class-results.csv', classResultsCsv(workspace.data), 'text/csv;charset=utf-8')
    notify('Class results exported locally.')
  }
  const deleteEssays = () => {
    resetData.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false)
        notify('Local uploaded essay data was reset.')
      },
    })
  }

  return (
    <div className="space-y-8">
      <PageHeading title="Settings" description="Manage your teacher workspace and local checking preferences." />
      {notice && <div role="status" className="rounded-lg border border-supports/30 bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}

      <SettingSection title="Account" description="Shared account details used across SecretSource.">
        <SettingRow label="Display name" hint="Shown in the teacher greeting and account chip."><Input value={shared.displayName} onChange={(event) => updateSettings({ displayName: event.target.value })} /></SettingRow>
        <SettingRow label="Email" hint={shared.email}><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-ink-muted">{shared.email}</span><Button type="button" variant="ghost" onClick={() => notify('Account changes are outside this frontend-only phase.')}>Change</Button></div></SettingRow>
        <SettingRow label="Password" hint="Keep your account secure."><Button type="button" variant="ghost" onClick={() => notify('Password changes are outside this frontend-only phase.')}>Change password</Button></SettingRow>
      </SettingSection>

      <SettingSection title="Role and home screen" description="These choices only affect this teacher frontend session.">
        <SettingRow label="Role" hint="Your current role"><StatusPill label="Teacher" tone="accent" /></SettingRow>
        <SettingRow label="Default class" hint="The class used when exporting results"><select value={teacher.defaultClassId} onChange={(event) => updateTeacher('defaultClassId', event.target.value)} className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm sm:max-w-sm">{(classes.data ?? []).map((course) => <option key={course.id} value={course.id}>{course.name} · {course.section}</option>)}</select></SettingRow>
      </SettingSection>

      <SettingSection title="Checking defaults" description="Set how local Essay Check screens should be prepared.">
        <SettingRow label="Citation style" hint="Used in feedback previews"><select value={teacher.citationStyle} onChange={(event) => updateTeacher('citationStyle', event.target.value)} className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm sm:max-w-sm"><option>APA 7th</option><option>MLA 9th</option><option>Chicago</option></select></SettingRow>
        <SettingRow label="Match strictness" hint="How much evidence should be surfaced"><select value={teacher.matchStrictness} onChange={(event) => updateTeacher('matchStrictness', event.target.value)} className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm sm:max-w-sm"><option>Balanced</option><option>Strict</option><option>Broad</option></select></SettingRow>
        <ToggleRow label="Check as submitted" hint="Prepare a local review when an essay is submitted." checked={teacher.checkOnSubmit} onChange={(value) => updateTeacher('checkOnSubmit', value)} />
        <ToggleRow label="Flag unsupported quotes" hint="Highlight passages that need a closer look." checked={teacher.flagQuotes} onChange={(value) => updateTeacher('flagQuotes', value)} />
      </SettingSection>

      <SettingSection title="Class and marking" description="Choose what students can see in local report previews.">
        <ToggleRow label="Hide student names" hint="Use initials in review lists." checked={teacher.hideStudentNames} onChange={(value) => updateTeacher('hideStudentNames', value)} />
        <ToggleRow label="Show student report" hint="Allow a report preview to be prepared." checked={teacher.studentReportVisibility} onChange={(value) => updateTeacher('studentReportVisibility', value)} />
        <SettingRow label="Send reports as" hint="Displayed sender name"><Input value={teacher.sendReportsAs} onChange={(event) => updateTeacher('sendReportsAs', event.target.value)} /></SettingRow>
      </SettingSection>

      <SettingSection title="Notifications" description="Choose which local reminders are shown in the workspace.">
        <ToggleRow label="Weekly digest" hint="A local summary of class activity." checked={teacher.weeklyDigest} onChange={(value) => updateTeacher('weeklyDigest', value)} />
        <SettingRow label="Digest day" hint="When the summary appears"><select value={teacher.digestDay} onChange={(event) => updateTeacher('digestDay', event.target.value)} className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm sm:max-w-sm"><option>Monday</option><option>Wednesday</option><option>Friday</option></select></SettingRow>
        <ToggleRow label="Batch finished notification" hint="Show a local notice when a review batch is ready." checked={teacher.batchFinishedNotification} onChange={(value) => updateTeacher('batchFinishedNotification', value)} />
      </SettingSection>

      <SettingSection title="Appearance" description="Theme and verdict colors are shared with the rest of the app.">
        <SettingRow label="Theme" hint="Applies immediately"><select value={shared.theme} onChange={(event) => updateSettings({ theme: event.target.value as typeof shared.theme })} className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm sm:max-w-sm"><option>Match system</option><option>Light</option><option>Dark</option></select></SettingRow>
        <ToggleRow label="Colour verdict badges" hint="Keep status colors visible in review lists." checked={shared.colorBadges} onChange={(value) => updateSettings({ colorBadges: value })} />
      </SettingSection>

      <SettingSection title="Your data" description="Exports and resets are local browser actions in this frontend-only build.">
        <SettingRow label="Export class results" hint="Download a CSV from the selected local class."><Button type="button" variant="ghost" onClick={exportResults}><Download className="size-4" />Export class results</Button></SettingRow>
        <SettingRow label="Delete uploaded essays" hint="Reset local mock essay and review data only."><Button type="button" variant="ghost" className="text-refutes hover:bg-refutes-soft" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" />Delete local data</Button></SettingRow>
        <div className="flex gap-3 rounded-lg bg-canvas p-3 text-xs leading-5 text-ink-muted"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-accent" />No Google Classroom, Drive, email, or backend operation is performed by these controls.</div>
      </SettingSection>

      <TeacherDialog open={deleteOpen} title="Delete local essay data?" description="This resets the mock essay review data in this browser session. It cannot affect Classroom, Drive, or student files." onClose={() => setDeleteOpen(false)}>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)} disabled={resetData.isPending}>Keep data</Button><Button type="button" className="bg-refutes hover:opacity-90" onClick={deleteEssays} disabled={resetData.isPending}><RotateCcw className="size-4" />{resetData.isPending ? 'Resetting...' : 'Reset local data'}</Button></div>
      </TeacherDialog>
    </div>
  )
}

function SettingSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="space-y-4"><div><h2 className="font-serif text-2xl font-semibold">{title}</h2><p className="mt-1 text-sm text-ink-muted">{description}</p></div><Card className="divide-y divide-border-subtle p-0">{children}</Card></section>
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs leading-5 text-ink-muted">{hint}</p></div><div className="w-full shrink-0 sm:w-auto sm:min-w-56">{children}</div></div>
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <SettingRow label={label} hint={hint}><label className="flex cursor-pointer items-center justify-end gap-3"><span className="text-xs font-medium text-ink-muted">{checked ? 'On' : 'Off'}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-5 accent-accent" aria-label={label} /></label></SettingRow>
}
