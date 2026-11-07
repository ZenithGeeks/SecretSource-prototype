import { escapeHtml, type TeacherFeedbackReport } from './teacherFeedbackExport'

/** Build the same printable report for download and email attachments. */
export function teacherFeedbackPdfHtml(report: TeacherFeedbackReport): string {
  const title = report.title?.trim() || 'Essay feedback'
  const metadata = [
    ['Student', report.student],
    ['Course', report.course],
    ['Assignment', report.assignment],
    ...(report.fileName ? [['Submission', report.fileName]] : []),
  ].map(([label, value]) => `<div class="meta-row"><span class="meta-label">${escapeHtml(label)}</span><span class="meta-value">${escapeHtml(value)}</span></div>`).join('')

  const cards = report.claims.map((claim, index) => {
    const automatedResult = claim.judgment || claim.standing
    const result = claim.teacherDecision || automatedResult
    const resultClass = result.toLowerCase().includes('support') ? 'supports'
      : result.toLowerCase().includes('contradict') ? 'contradicts' : 'inconclusive'
    const resultLabel = claim.teacherDecision ? `Teacher decision: ${result}` : `Automated result: ${result}`
    return `<article class="citation">
      <div class="citation-heading"><span class="citation-number">CITATION ${String(index + 1).padStart(2, '0')}</span></div>
      <h3>${escapeHtml(claim.claim)}</h3>
      ${result ? `<div class="teacher-decision ${resultClass}">${escapeHtml(resultLabel)}</div>` : ''}
      ${claim.sentence ? `<div class="passage"><div class="label">PASSAGE IN THE ESSAY${claim.sourcePage ? ` · PAGE ${claim.sourcePage}` : ''}</div><p>“${escapeHtml(claim.sentence)}”</p></div>` : ''}
      ${claim.cropDataUrl ? `<figure><img alt="Passage from the submitted paper" src="${escapeHtml(claim.cropDataUrl)}"><figcaption>Passage from the submitted essay</figcaption></figure>` : ''}
      ${claim.sourceName ? `<div class="detail"><div class="label">CITED SOURCE</div><p>${escapeHtml(claim.sourceName)}</p></div>` : ''}
      ${claim.evidence ? `<div class="detail"><div class="label">SOURCE EVIDENCE</div><p>“${escapeHtml(claim.evidence)}”</p></div>` : ''}
      ${claim.teacherDecision && automatedResult ? `<div class="detail"><div class="label">AUTOMATED FINDING</div><p>${escapeHtml(`Automated result: ${automatedResult}`)}</p></div>` : ''}
      ${claim.reasoning ? `<div class="detail"><div class="label">AUTOMATED EXPLANATION</div><p>${escapeHtml(claim.reasoning)}</p></div>` : ''}
      ${claim.teacherNote ? `<div class="teacher-note"><div class="label">TEACHER NOTE</div><p>${escapeHtml(claim.teacherNote)}</p></div>` : ''}
    </article>`
  }).join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)} - ${escapeHtml(report.student)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { color: #202b3b; font: 10pt/1.5 Inter, "Segoe UI", Arial, sans-serif; }
  .masthead { padding: 0 0 10px; border-bottom: 2px solid #334f70; }
  .brand { color: #263d5c; font-size: 12pt; font-weight: bold; }
  .brand-accent { color: #7063a8; }
  .document-type { margin-top: 4px; color: #65758a; font-size: 8pt; }
  .intro { padding: 22px 0 16px; }
  .eyebrow, .label, .citation-number { color: #536783; font-size: 7.5pt; font-weight: bold; }
  h1 { margin: 5px 0 4px; color: #1c304b; font-size: 25pt; line-height: 1.15; }
  .intro p { margin: 0; color: #65758a; font-size: 9pt; }
  .metadata { margin-bottom: 22px; }
  .meta-row { padding: 6px 9px; border-bottom: 1px solid #dfe5ed; }
  .meta-label { color: #65758a; font-size: 8pt; font-weight: bold; }
  .meta-value { display: block; color: #263649; font-size: 9pt; overflow-wrap: anywhere; }
  .section-heading { margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #bac7d7; }
  .section-heading h2 { margin: 0; color: #233b58; font-size: 14pt; }
  .section-heading p { margin: 2px 0 0; color: #65758a; font-size: 8pt; }
  .feedback { margin-bottom: 26px; padding: 13px 15px; background: #f1f5fa; border-left: 3px solid #526d9a; }
  .feedback p, .detail p, .teacher-note p, .passage p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .citation { margin: 0 0 20px; padding: 0 0 14px; border-bottom: 1px solid #cbd5e1; }
  .citation-heading { margin-bottom: 5px; }
  .citation h3 { margin: 0 0 9px; color: #1f3048; font-size: 11.5pt; line-height: 1.35; }
  .teacher-decision { padding: 7px 10px; margin: 0 0 10px; font-size: 9pt; font-weight: bold; background: #f3f0e7; color: #70551d; border-left: 3px solid #a58749; }
  .teacher-decision.supports { background: #e9f5ef; color: #21613f; border-left: 3px solid #28714e; }
  .teacher-decision.contradicts { background: #fbebeb; color: #922c35; border-left: 3px solid #a13f48; }
  .passage { margin: 9px 0; padding: 9px 11px; background: #f7f8fa; border-left: 2px solid #c0cad9; }
  .passage p { color: #344258; font-style: italic; }
  .detail { margin: 10px 0; }
  .detail p { font-size: 9pt; }
  .teacher-note { margin-top: 11px; padding: 10px 12px; background: #f2f5fa; border-left: 3px solid #8191b2; }
  figure { margin: 10px 0; } img { max-width: 100%; max-height: 75mm; } figcaption { color: #65758a; font-size: 8pt; }
  .empty { color: #65758a; }
  .report-footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #cbd5e1; color: #77869a; font-size: 8pt; }
</style></head><body>
  <header class="masthead"><div class="brand">Secret<span class="brand-accent">Source</span></div><div class="document-type">TEACHER FEEDBACK REPORT</div></header>
  <section class="intro"><div class="eyebrow">ESSAY REVIEW</div><h1>${escapeHtml(title)}</h1><p>Feedback on the essay and its cited sources</p></section>
  <div class="metadata" aria-label="Submission details">${metadata}</div>
  <section class="section-heading"><h2>Teacher feedback</h2><p>Comments for the student</p></section>
  <div class="feedback"><p>${escapeHtml(report.feedback || 'No written feedback was added.')}</p></div>
  <section class="section-heading"><h2>Citation review</h2><p>${report.claims.length} selected citation${report.claims.length === 1 ? '' : 's'}</p></section>
  ${cards || '<p class="empty">No citations were selected for this feedback.</p>'}
  <footer class="report-footer">SecretSource · Teacher feedback report</footer>
</body></html>`
}
