import { escapeHtml, type TeacherFeedbackReport } from './teacherFeedbackExport'

/** Build the polished, self-contained A4 HTML document used for print-to-PDF and email. */
export function teacherFeedbackPdfHtml(report: TeacherFeedbackReport): string {
  const metadata = [
    ['Student', report.student],
    ['Course', report.course],
    ['Assignment', report.assignment],
    ...(report.fileName ? [['Submission', report.fileName]] : []),
  ].map(([label, value]) => `<div class="meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')

  const cards = report.claims.map((claim, index) => {
    const result = claim.judgment || claim.standing
    const resultClass = result.toLowerCase().includes('support') ? 'supports'
      : result.toLowerCase().includes('contradict') ? 'contradicts'
        : result ? 'inconclusive' : ''
    return `<article class="claim-card">
      <div class="claim-heading">
        <span class="claim-number">Citation ${String(index + 1).padStart(2, '0')}</span>
        ${result ? `<span class="result-badge ${resultClass}">${escapeHtml(result)}</span>` : ''}
      </div>
      <h3 class="claim-title">${escapeHtml(claim.claim)}</h3>
      ${claim.sentence ? `<div class="essay-passage"><span class="eyebrow">In your essay${claim.sourcePage ? ` · page ${claim.sourcePage}` : ''}</span><p>“${escapeHtml(claim.sentence)}”</p></div>` : ''}
      ${claim.cropDataUrl ? `<figure class="essay-crop"><img alt="Passage from your submitted paper${claim.sourcePage ? `, page ${claim.sourcePage}` : ''}" src="${claim.cropDataUrl}"><figcaption>Passage from your essay${claim.sourcePage ? ` · page ${claim.sourcePage}` : ''}</figcaption></figure>` : ''}
      <div class="details-grid">
        ${claim.sourceName ? `<section class="detail"><h4>Cited source</h4><p>${escapeHtml(claim.sourceName)}</p></section>` : ''}
        ${claim.evidence ? `<section class="detail evidence"><h4>What the source says</h4><blockquote>“${escapeHtml(claim.evidence)}”</blockquote></section>` : ''}
        ${claim.reasoning ? `<section class="detail reasoning"><h4>Automated reasoning</h4><p>${escapeHtml(claim.reasoning)}</p></section>` : ''}
        ${claim.teacherDecision ? `<section class="detail teacher-decision"><h4>Teacher’s decision</h4><p>${escapeHtml(claim.teacherDecision)}</p></section>` : ''}
        ${claim.teacherNote ? `<section class="detail teacher-note"><h4>Teacher note</h4><p>${escapeHtml(claim.teacherNote)}</p></section>` : ''}
      </div>
    </article>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Essay feedback - ${escapeHtml(report.student)}</title>
  <style>
    @page { size: A4; margin: 16mm 17mm 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0 auto; max-width: 190mm; color: #202433; font: 10pt/1.55 Inter, "Segoe UI", Arial, sans-serif; }
    .masthead { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 0 11px; border-bottom: 1px solid #e2e5ed; }
    .wordmark { color: #292c3c; font-size: 12pt; font-weight: 750; letter-spacing: -.35px; }
    .wordmark span { color: #5968c9; }
    .report-kind { color: #657087; font-size: 7.5pt; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
    .intro { padding: 24px 0 18px; }
    .eyebrow { display: block; margin-bottom: 5px; color: #626e87; font-size: 7.5pt; font-weight: 700; letter-spacing: .85px; text-transform: uppercase; }
    h1 { margin: 0; color: #202433; font-size: 25pt; font-weight: 720; letter-spacing: -.7px; line-height: 1.12; }
    .intro-copy { margin: 8px 0 0; color: #626b7c; font-size: 9pt; }
    .metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0 0 19px; }
    .meta-item { min-width: 0; padding: 10px 12px; border: 1px solid #e1e4ec; border-radius: 8px; background: #fbfbfd; }
    .meta-item span { display: block; margin-bottom: 3px; color: #687187; font-size: 7pt; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
    .meta-item strong { display: block; overflow-wrap: anywhere; color: #24283a; font-size: 9pt; font-weight: 650; }
    .teacher-feedback { margin: 0 0 25px; padding: 16px 18px; border: 1px solid #dfe3f5; border-left: 4px solid #6674d2; border-radius: 9px; background: #f7f8fd; }
    .teacher-feedback h2 { margin: 0 0 7px; color: #38458e; font-size: 10pt; }
    .teacher-feedback p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 11px; padding-bottom: 8px; border-bottom: 1px solid #e3e6ee; }
    .section-heading h2 { margin: 0; color: #252a3b; font-size: 14pt; letter-spacing: -.2px; }
    .count { color: #697187; font-size: 8pt; }
    .claim-card { margin: 0 0 12px; padding: 15px 16px; border: 1px solid #dfe3eb; border-radius: 9px; background: #fff; break-inside: avoid-page; page-break-inside: avoid; }
    .claim-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .claim-number { color: #68728a; font-size: 7pt; font-weight: 750; letter-spacing: .85px; text-transform: uppercase; }
    .result-badge { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #f0f1f6; color: #596174; font-size: 7pt; font-weight: 750; }
    .result-badge.supports { background: #e9f5ef; color: #28714e; }
    .result-badge.contradicts { background: #fbebeb; color: #a13f48; }
    .result-badge.inconclusive { background: #f3f0e7; color: #80652e; }
    .claim-title { margin: 0 0 11px; color: #252a3b; font-size: 11pt; font-weight: 650; line-height: 1.4; }
    .essay-passage { margin: 0 0 10px; padding: 9px 11px; border-radius: 6px; background: #f7f8fa; }
    .essay-passage .eyebrow { margin-bottom: 3px; font-size: 6.5pt; }
    .essay-passage p { margin: 0; color: #464e61; font-style: italic; }
    .essay-crop { margin: 10px 0; }
    .essay-crop img { display: block; max-width: 100%; max-height: 75mm; margin: 0 auto; border: 1px solid #e2e5ec; border-radius: 5px; }
    .essay-crop figcaption { margin-top: 4px; color: #737b8d; font-size: 7pt; text-align: center; }
    .details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .detail { min-width: 0; padding: 9px 10px; border-radius: 6px; background: #f8f9fc; }
    .detail h4 { margin: 0 0 4px; color: #626c83; font-size: 7pt; font-weight: 750; letter-spacing: .45px; text-transform: uppercase; }
    .detail p, .detail blockquote { margin: 0; color: #343a4b; font-size: 8.5pt; overflow-wrap: anywhere; }
    .detail blockquote { padding-left: 9px; border-left: 2px solid #c5cbed; }
    .reasoning { background: #f2f4fb; }
    .teacher-decision, .teacher-note { border: 1px solid #e7e9f1; background: #fff; }
    .empty { padding: 18px; border: 1px dashed #d7dbe5; border-radius: 8px; color: #687187; font-size: 9pt; text-align: center; }
    .report-footer { margin-top: 21px; padding-top: 8px; border-top: 1px solid #e2e5ed; color: #81889a; font-size: 7pt; }
    @media screen { body { margin: 28px auto; padding: 0 20px; } }
    @media print {
      body { max-width: none; margin: 0; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .metadata, .teacher-feedback, .claim-card { break-inside: avoid-page; page-break-inside: avoid; }
      .detail, .essay-passage { break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 600px) { .details-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header class="masthead"><div class="wordmark">Secret<span>Source</span></div><div class="report-kind">Teacher feedback report</div></header>
  <section class="intro"><span class="eyebrow">Writing review</span><h1>Essay feedback</h1><p class="intro-copy">A review of your essay claims and cited sources.</p></section>
  <section class="metadata" aria-label="Submission details">${metadata}</section>
  <section class="teacher-feedback"><h2>Feedback from your teacher</h2><p>${escapeHtml(report.feedback || 'No written feedback was added.')}</p></section>
  <section aria-labelledby="citation-heading"><div class="section-heading"><h2 id="citation-heading">Citation feedback</h2><span class="count">${report.claims.length} reviewed citation${report.claims.length === 1 ? '' : 's'}</span></div>${cards || '<p class="empty">No citations were selected for this feedback.</p>'}</section>
  <footer class="report-footer">SecretSource · Essay Check</footer>
</body>
</html>`
}
