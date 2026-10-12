import { Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/ui'
import { TeacherDialog } from '../components/TeacherDialog'

export function FeedbackDialog({ open, studentName, recipientEmail, senderEmail, deliveryReady, deliveryIssue, preview, onClose, onSend, onRefreshClassroom, onReconnectGoogle, refreshingClassroom = false, refreshClassroomError }: {
  open: boolean
  studentName: string
  recipientEmail: string | null | undefined
  senderEmail: string | null | undefined
  deliveryReady: boolean
  deliveryIssue: string
  preview: string
  onClose: () => void
  onSend: () => Promise<void>
  onRefreshClassroom?: () => void
  onReconnectGoogle?: () => void
  refreshingClassroom?: boolean
  refreshClassroomError?: string
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await onSend()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Feedback could not be sent.')
    } finally {
      setSending(false)
    }
  }

  const close = () => {
    if (!sending) onClose()
  }

  return (
    <TeacherDialog open={open} title={`Send feedback to ${studentName}?`} description="Review the feedback summary and recipient before emailing it to the student." onClose={close}>
      <div className="rounded-xl border border-border-subtle bg-canvas p-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Feedback summary</p><p className="mt-3 text-sm leading-6 text-ink">{preview}</p></div>
      <div className="mt-4 flex gap-2 rounded-lg bg-accent-soft/45 p-3 text-xs leading-5 text-ink-muted">
        {deliveryReady ? <Mail className="mt-0.5 size-4 shrink-0 text-accent" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />}
        {deliveryReady
          ? <span>Email will be sent from <strong className="font-semibold text-ink">{senderEmail}</strong> to <strong className="font-semibold text-ink">{recipientEmail}</strong> through the connected Gmail account.</span>
          : <span>{deliveryIssue} No email will be sent until this is resolved.</span>}
      </div>
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
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close} disabled={sending}>Keep editing</Button><Button type="button" onClick={() => void send()} disabled={sending || !deliveryReady}><Send className="size-4" />{sending ? 'Sending...' : 'Send email'}</Button></div>
    </TeacherDialog>
  )
}
