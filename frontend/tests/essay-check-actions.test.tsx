import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResultsSummary } from '../src/components/ResultsSummary'
import { EssayCheckActions } from '../src/roles/teacher/screens/EssayCheckActions'
import { FeedbackDialog } from '../src/roles/teacher/screens/FeedbackDialog'

const counts = { refutes: 0, insufficient: 0, supports: 0, unchecked: 0, uncited: 0 }

describe('Essay Check action placement', () => {
  it('shows the PDF, Copy All, and CSV actions in the teacher summary header', () => {
    render(
      <ResultsSummary
        claims={[]}
        standings={[]}
        counts={counts}
        filter={null}
        onFilter={() => undefined}
        paper="essay.pdf"
        onOpenPaper={() => undefined}
        teacherMode
      />,
    )

    expect(screen.getByRole('button', { name: 'Copy all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument()
  })

  it('keeps feedback copy, report export, and send actions together in the bottom row', () => {
    const onCopy = vi.fn()
    const onDownloadReport = vi.fn()
    const onSend = vi.fn()
    render(
      <EssayCheckActions
        onCopy={onCopy}
        onDownloadReport={onDownloadReport}
        onSend={onSend}
        reportDisabled={false}
        sendDisabled={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Download feedback report' }))
    expect(onDownloadReport).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to student' })).toBeInTheDocument()
  })
})

describe('FeedbackDialog email delivery', () => {
  it('shows the real recipient and only offers sending when Gmail delivery is ready', () => {
    render(
      <FeedbackDialog
        open
        studentName="Patiharn Liangkobkit"
        recipientEmail="student@example.edu"
        senderEmail="teacher@example.edu"
        deliveryReady
        deliveryIssue=""
        preview="Feedback summary"
        onClose={() => undefined}
        onSend={async () => undefined}
      />,
    )

    expect(screen.getByText(/student@example\.edu/)).toBeInTheDocument()
    expect(screen.getByText(/teacher@example\.edu/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled()
    expect(screen.queryByText(/local delivery state only/i)).not.toBeInTheDocument()
  })

  it('explains the missing delivery setup and disables Send when Gmail is unavailable', () => {
    render(
      <FeedbackDialog
        open
        studentName="Patiharn Liangkobkit"
        recipientEmail=""
        senderEmail={null}
        deliveryReady={false}
        deliveryIssue="Refresh Classroom to sync the student's email address."
        preview="Feedback summary"
        onClose={() => undefined}
        onSend={async () => undefined}
      />,
    )

    expect(screen.getByText(/Refresh Classroom to sync/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled()
  })
})
