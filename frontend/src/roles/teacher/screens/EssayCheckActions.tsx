import { Copy, Download, Send } from 'lucide-react'

import { Button } from '../../../components/ui'
import { toCsv } from '../../../lib/claims'
import { downloadText } from '../../../lib/csv'
import type { Claim } from '../../../lib/api'

export function EssayCheckActions({
  claims,
  onCopy,
  onDownloadReport,
  onSend,
  reportDisabled,
  reportBusy = false,
  sendDisabled,
  sending = false,
  csvDisabled = false,
}: {
  claims: Claim[]
  onCopy: () => void
  onDownloadReport: () => void
  onSend: () => void
  reportDisabled: boolean
  reportBusy?: boolean
  sendDisabled: boolean
  sending?: boolean
  csvDisabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" onClick={onCopy}><Copy className="size-4" />Copy</Button>
      <Button type="button" variant="ghost" onClick={onDownloadReport} disabled={reportDisabled || reportBusy}>
        <Download className="size-4" />{reportBusy ? 'Preparing PDF…' : 'Download feedback report'}
      </Button>
      <Button type="button" onClick={onSend} disabled={sendDisabled || sending}>
        <Send className="size-4" />{sending ? 'Sending…' : 'Send to student'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={csvDisabled}
        onClick={() => downloadText('claims.csv', toCsv(claims), 'text/csv;charset=utf-8')}
        title="Download the claims, their verdicts and their pages as CSV"
      >
        <Download className="size-4" />CSV
      </Button>
    </div>
  )
}
