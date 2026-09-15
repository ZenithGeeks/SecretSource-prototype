import { Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/ui'
import { TeacherDialog } from '../components/TeacherDialog'

export function FeedbackDialog({ open, studentName, preview, onClose, onSend }: {
  open: boolean
  studentName: string
  preview: string
  onClose: () => void
  onSend: () => Promise<void>
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
    <TeacherDialog open={open} title={`Send feedback to ${studentName}?`} description="Review this local feedback summary before sending it to the student preview." onClose={close}>
      <div className="rounded-xl border border-border-subtle bg-canvas p-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Feedback summary</p><p className="mt-3 text-sm leading-6 text-ink">{preview}</p></div>
      <div className="mt-4 flex gap-2 rounded-lg bg-accent-soft/45 p-3 text-xs leading-5 text-ink-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />This action records a local delivery state only; no email or Classroom message is sent.</div>
      {error && <p role="alert" className="mt-4 text-sm text-refutes">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close} disabled={sending}>Keep editing</Button><Button type="button" onClick={() => void send()} disabled={sending}><Send className="size-4" />{sending ? 'Sending...' : 'Send'}</Button></div>
    </TeacherDialog>
  )
}
