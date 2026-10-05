import { describe, expect, it } from 'vitest'

import { defaultFeedbackSharing, teacherFeedbackCsv, teacherFeedbackMarkdown } from '../src/lib/teacherFeedbackExport'

describe('teacher feedback exports', () => {
  it('defaults automated findings and evidence on, with teacher-only fields private', () => {
    expect(defaultFeedbackSharing).toEqual({ automated: true, evidence: true, teacherDecision: false, teacherNote: false })
  })

  it('writes feedback as structured Markdown and CSV', () => {
    const report = {
      course: 'Writing 101',
      assignment: 'Argument essay',
      fileName: 'draft.pdf',
      student: 'A. Student',
      feedback: 'Revise the claim.',
      claims: [{
        claim: 'Exercise improves sleep.',
        sentence: 'Exercise helps you sleep.',
        sourcePage: 2,
        standing: 'supports',
        judgment: 'Supports',
        reasoning: 'The study reports a positive association.',
        evidence: 'Participants slept longer.',
        sourceName: 'Sleep study',
      }],
    }

    const markdown = teacherFeedbackMarkdown(report)
    expect(markdown).toContain('# Essay feedback')
    expect(markdown).toContain('**Submission:** draft.pdf')
    expect(markdown).toContain('**What the source says**')
    expect(teacherFeedbackCsv(report)).toContain('"Student","Course","Assignment","Submission","Teacher feedback"')
    expect(teacherFeedbackCsv(report)).toContain('Sleep study')
  })
})
