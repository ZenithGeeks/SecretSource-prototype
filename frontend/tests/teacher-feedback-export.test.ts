import { describe, expect, it } from 'vitest'

import { defaultFeedbackSharing, teacherFeedbackCsv, teacherFeedbackMarkdown } from '../src/lib/teacherFeedbackExport'
import { teacherFeedbackPdfHtml } from '../src/lib/teacherFeedbackPdf'

describe('teacher feedback exports', () => {
  it('includes teacher decisions and notes by default for citations added to feedback', () => {
    expect(defaultFeedbackSharing).toEqual({ automated: true, evidence: true, teacherDecision: true, teacherNote: true })
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

  it('includes shared teacher decisions and notes in the PDF report', () => {
    const html = teacherFeedbackPdfHtml({
      course: 'Writing', assignment: 'Essay', student: 'Student', feedback: 'Please revise.',
      claims: [{ claim: 'A claim', standing: 'supports', judgment: 'Supports', teacherDecision: 'Contradicts', teacherNote: 'Check the evidence.' }],
    })
    expect(html).toContain('Contradicts')
    expect(html).toContain('Check the evidence.')
  })

  it('uses the shared teacher decision for the citation label and identifies the automated result separately', () => {
    const html = teacherFeedbackPdfHtml({
      course: 'Writing', assignment: 'Essay', student: 'Student', feedback: 'Please revise.',
      claims: [{ claim: 'A claim', standing: 'unchecked', judgment: 'Not checked', teacherDecision: 'Contradicts' }],
    })
    expect(html).toContain('Teacher decision: Contradicts')
    expect(html).toContain('Automated result: Not checked')
    expect(html).toContain('teacher-decision contradicts')
  })
})
