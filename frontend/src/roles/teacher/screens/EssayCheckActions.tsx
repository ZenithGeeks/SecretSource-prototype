import { Copy, Download, Send, Sheet } from 'lucide-react'

import { Button } from '../../../components/ui'

export function EssayCheckActions({
  onCopy,
  onDownloadReport,
  onDownloadCsv = () => {},
  onSend,
  reportDisabled,
  reportBusy = false,
  sendDisabled,
  sending = false,
  compact = false,
}: {
  onCopy: () => void
  onDownloadReport: () => void
  onDownloadCsv?: () => void
  onSend: () => void
  reportDisabled: boolean
  reportBusy?: boolean
  sendDisabled: boolean
  sending?: boolean
  compact?: boolean
}) {
  const actionClass = compact ? 'px-3 py-2 text-xs' : undefined
  return (
    <div className="flex flex-wrap gap-2">
      <Button className={actionClass} type="button" variant="ghost" onClick={onCopy}><Copy className="size-4" />Copy Markdown</Button>
      <Button className={actionClass} type="button" variant="ghost" onClick={onDownloadReport} disabled={reportDisabled || reportBusy}>
        <Download className="size-4" />{reportBusy ? 'Preparing PDF…' : 'Download feedback report'}
      </Button>
      <Button className={actionClass} type="button" variant="ghost" onClick={onDownloadCsv}>
        <Sheet className="size-4" />Download CSV
      </Button>
      <Button className={actionClass} type="button" onClick={onSend} disabled={sendDisabled || sending}>
        <Send className="size-4" />{sending ? 'Sending…' : 'Send to student'}
      </Button>
    </div>
  )
}
