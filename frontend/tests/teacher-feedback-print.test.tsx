import { describe, expect, it, vi } from 'vitest'

import { printTeacherFeedbackReport, teacherFeedbackReport } from '../src/lib/teacherFeedbackExport'

describe('teacher feedback export', () => {
  it('exports teacher feedback, claim judgments, and cropped evidence for the student', () => {
    const report = teacherFeedbackReport({
      course: 'Research Writing',
      assignment: 'Source analysis',
      student: 'Anan P.',
      feedback: 'Please revise this claim using the source accurately.',
      claims: [{
        claim: 'The treatment doubled the outcome.',
        sentence: 'The treatment doubled the outcome [1].',
        sourcePage: 3,
        standing: 'refutes',
        judgment: 'Contradicts',
        teacherDecision: 'Contradicts',
        reasoning: 'The source reports no measurable change.',
        evidence: 'No measurable change was observed.',
        cropDataUrl: 'data:image/png;base64,cropped-passage',
      }],
    })

    expect(report).toContain('Please revise this claim using the source accurately.')
    expect(report).toContain('The treatment doubled the outcome.')
    expect(report).toContain('The source reports no measurable change.')
    expect(report).toContain('Teacher’s final decision')
    expect(report).toContain('No measurable change was observed.')
    expect(report).toContain('src="data:image/png;base64,cropped-passage"')
    expect(report).toContain('page 3')
  })

  it('prints the feedback report so the teacher can save it as a PDF', async () => {
    const document = { open: vi.fn(), write: vi.fn(), close: vi.fn(), images: [] }
    const printWindow = {
      document,
      focus: vi.fn(),
      print: vi.fn(),
      setTimeout: (callback: () => void) => callback(),
    } as unknown as Window

    await printTeacherFeedbackReport(printWindow, '<html>Teacher feedback with evidence crops</html>')

    expect(document.open).toHaveBeenCalledOnce()
    expect(document.write).toHaveBeenCalledWith('<html>Teacher feedback with evidence crops</html>')
    expect(document.close).toHaveBeenCalledOnce()
    expect(printWindow.focus).toHaveBeenCalledOnce()
    expect(printWindow.print).toHaveBeenCalledOnce()
  })

  it('waits for report fonts and browser layout before printing', async () => {
    let finishFonts!: () => void
    const fontsReady = new Promise<void>((resolve) => { finishFonts = resolve })
    const events: string[] = []
    const document = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      images: [],
      fonts: { ready: fontsReady },
      body: { get offsetHeight() { events.push('layout'); return 600 } },
    }
    const printWindow = {
      document,
      focus: vi.fn(),
      print: vi.fn(() => events.push('print')),
      requestAnimationFrame: (callback: FrameRequestCallback) => { events.push('frame'); callback(0); return 1 },
      setTimeout: (callback: () => void) => callback(),
    } as unknown as Window

    const printing = printTeacherFeedbackReport(printWindow, '<html><body>Full report</body></html>')
    await Promise.resolve()
    expect(events).not.toContain('print')

    finishFonts()
    await printing

    expect(events).toEqual(['frame', 'frame', 'layout', 'print'])
  })
})
