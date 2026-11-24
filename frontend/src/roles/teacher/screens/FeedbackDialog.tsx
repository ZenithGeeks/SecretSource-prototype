import { FileText, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/ui'
import { TeacherDialog } from '../components/TeacherDialog'

export function FeedbackDialog({ open, studentName, recipientEmail, senderEmail, deliveryReady, deliveryIssue, preview, defaultSubject = 'Essay feedback', subject: controlledSubject, onSubjectChange, onClose, onSend, onRefreshClassroom, onReconnectGoogle, refreshingClassroom = false, refreshClassroomError }: {
  open: boolean
  studentName: string
  recipientEmail: string | null | undefined
  senderEmail: string | null | undefined
  deliveryReady: boolean
  deliveryIssue: string
  preview: string
  defaultSubject?: string
  subject?: string
  onSubjectChange?: (subject: string) => void
  onClose: () => void
  onSend: (subject: string) => Promise<void>
  onRefreshClassroom?: () => void
  onReconnectGoogle?: () => void
  refreshingClassroom?: boolean
  refreshClassroomError?: string
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [localSubject, setLocalSubject] = useState(defaultSubject)
  const subject = controlledSubject ?? localSubject
  const [sent, setSent] = useState(false)

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await onSend(subject.trim())
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Feedback could not be sent.')
    } finally {
      setSending(false)
    }
  }

  const close = () => {
    if (!sending) { setSent(false); onClose() }
  }

  return (
    <TeacherDialog open={open} title={sent ? 'Feedback email sent' : `Send feedback to ${studentName}?`} description={sent ? 'Gmail accepted the email for sending.' : 'Review the email and recipient before sending.'} onClose={close}>
      {sent ? <><p role="status" className="text-sm text-ink">Email sent to {recipientEmail} with the feedback PDF attached.</p><div className="mt-6 flex justify-end"><Button type="button" onClick={close}>Done</Button></div></> : <>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="border-b border-border-subtle bg-canvas px-4 py-2 text-xs font-semibold text-ink-muted">Email preview</div>
        <div className="space-y-2 border-b border-border-subtle px-4 py-3 text-sm">
          <div className="flex gap-3"><span className="w-14 shrink-0 text-ink-muted">From</span><span className="break-all text-ink">{senderEmail || 'Not connected'}</span></div>
          <div className="flex gap-3"><span className="w-14 shrink-0 text-ink-muted">To</span><span className="break-all text-ink">{recipientEmail || 'Not available'}</span></div>
          <div className="flex items-center gap-3"><label className="w-14 shrink-0 text-ink-muted" htmlFor="feedback-email-subject">Subject</label><input id="feedback-email-subject" aria-label="Email subject" value={subject} maxLength={200} onChange={(event) => onSubjectChange ? onSubjectChange(event.target.value) : setLocalSubject(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink" /></div>
        </div>
        <div className="min-h-28 p-4"><p className="sr-only">Email message to the student</p><p className="whitespace-pre-wrap text-sm leading-6 text-ink">{preview}</p></div>
        <div className="border-t border-border-subtle px-4 py-3"><div className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-xs text-ink"><FileText className="size-4 text-accent" />essay-feedback.pdf</div></div>
      </div>
      {!deliveryReady && <div className="mt-4 flex gap-2 rounded-lg bg-accent-soft/45 p-3 text-xs leading-5 text-ink-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /><span>{deliveryIssue} No email will be sent until this is resolved.</span></div>}
      {!deliveryReady && !recipientEmail && onRefreshClassroom && <div className="mt-3">
        <Button type="button" variant="ghost" onClick={onRefreshClassroom} disabled={refreshingClassroom}>
          <RefreshCw className={refreshingClassroom ? 'size-4 animate-spin' : 'size-4'} />{refreshingClassroom ? 'Syncing Classroom…' : 'Sync Classroom now'}
        </Button>
      </div>}
      {!deliveryReady && onReconnectGoogle && <div className="mt-3">
        <Button type="button" variant="ghost" onClick={onReconnectGoogle}>Reconnect Google for student email access</Button>
      </div>}
      {refreshClassroomError && <p role="alert" className="mt-2 text-sm text-refutes">Classroom could not be synced: {refreshClassroomError}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-refutes">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close} disabled={sending}>Keep editing</Button><Button type="button" onClick={() => void send()} disabled={sending || !deliveryReady || !subject.trim()}><Send className="size-4" />{sending ? 'Sending...' : 'Send email'}</Button></div>
      </>}
    </TeacherDialog>
  )
}
