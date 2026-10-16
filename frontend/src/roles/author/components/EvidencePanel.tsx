/**
 * "Evidence — issue N of M": the selected citation's sentence beside the passage the verdict
 * rests on, why, and the two ways to act on it: upload the source PDF, or keep the citation
 * with a note. "Override · add note" and the editor's "Keep mine" are the same action, so the
 * note form lives here and the popover reuses the wording.
 *
 * "show in the paper" opens the source PDF at the passage in the shared PageViewer, the way
 * a researcher's claim card does: the gateway locates the text, the viewer highlights it.
 */

import { ChevronRight, PencilLine, RotateCcw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import type { Target } from '../../../components/PageViewer'
import { Button, Card, Empty } from '../../../components/ui'
import { api } from '../../../lib/api'
import { referenceNote } from '../../../lib/referenceCheck'
import type { Citation } from '../../../types/draftCheck'
import { sourceLabel } from '../labels'
import { CardHead, TextLink } from './CardHead'
import { AuditNote, CitationBadge } from './Verdicts'

export function EvidencePanel({
  citation,
  issues,
  onNext,
  onOverride,
  onReopen,
  onAttachPdf,
  onShow,
}: {
  citation: Citation | undefined
  /** The open issues, for the "N of M" pager. */
  issues: Citation[]
  onNext: () => void
  onOverride: (citation: Citation, note: string) => void
  onReopen: (citation: Citation) => void
  onAttachPdf: (citation: Citation, file: File) => void
  /** Open the source PDF at the passage. */
  onShow?: (target: Target) => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState(false)
  const pdfInput = useRef<HTMLInputElement>(null)

  const index = citation ? issues.findIndex((c) => c.id === citation.id) : -1
  const pager =
    issues.length === 0
      ? 'no open issues'
      : index >= 0
        ? `${index + 1} of ${issues.length} issue${issues.length === 1 ? '' : 's'}`
        : `${issues.length} open issue${issues.length === 1 ? '' : 's'}`

  const submitNote = () => {
    if (!citation) return
    onOverride(citation, note)
    setNote('')
    setNoteOpen(false)
  }

  /** Look the passage up in the source PDF, then show it — located or not. */
  const showInPaper = async () => {
    if (!citation?.evidence || !onShow) return
    const { pdf, passage, page } = citation.evidence
    setLocating(true)
    try {
      const found = await api.findInPaper(pdf, passage, page ?? undefined).catch(() => null)
      onShow({
        paper: pdf,
        label: `Deciding passage in ${pdf}`,
        quote: passage,
        source: found && found.page ? (found as Target['source']) : null,
        page: page ?? undefined,
      })
    } finally {
      setLocating(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="evidence-title">
      <CardHead
        id="evidence-title"
        title={citation ? `Evidence · ${sourceLabel(citation)}` : 'Evidence'}
        aside={
          <button
            type="button"
            onClick={onNext}
            disabled={issues.length === 0}
            aria-label={issues.length ? `${pager}. Show the next issue` : pager}
            className="flex items-center gap-1 rounded text-xs text-accent hover:underline disabled:cursor-default disabled:text-ink-muted disabled:no-underline"
          >
            {pager}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        }
      />

      {!citation ? (
        <Empty title="No open issues" hint="Every checked citation in this draft holds up. Pick a row above to read its evidence." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-lg bg-canvas p-3">
              <p className="text-[11px] font-medium text-ink-muted">
                <span className="uppercase tracking-wide">Your sentence</span> · {citation.file} L{citation.line}
              </p>
              <p className="font-mono text-xs leading-relaxed text-ink">{citation.sentence}</p>
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg bg-canvas p-3">
              {citation.evidence?.passage ? (
                <>
                  <p className="text-[11px] font-medium text-ink-muted">
                    <span className="uppercase tracking-wide">Source passage</span> · {citation.evidence.pdf}
                    {citation.evidence.page ? ` p.${citation.evidence.page}` : ''}
                  </p>
                  <blockquote className="font-serif text-[13px] italic leading-relaxed text-ink">
                    “{citation.evidence.passage}”
                  </blockquote>
                  {onShow && (
                    <TextLink className="self-start" onClick={() => void showInPaper()} aria-disabled={locating}>
                      {locating ? 'locating…' : 'show in the paper'}
                    </TextLink>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Source passage</p>
                  <p className="text-[13px] text-ink-muted">
                    {citation.verdict === 'unavailable'
                      ? `The source could not be read: ${citation.message || 'no PDF'}.`
                      : citation.verdict === 'unchecked'
                        ? citation.reason === 'missing-key'
                          ? `\\cite{${citation.key}} has no entry in the bibliography.`
                          : 'Not checked yet.'
                        : 'The check answered without quoting a passage.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <AuditNote findings={citation.audit} className="text-[13px]" />

          {citation.explanation && (
            <p className="text-[13px] text-ink-muted">
              <span className="font-medium text-ink">Why:</span> {citation.explanation}
            </p>
          )}

          {referenceNote(citation) && (
            <p role="note" className="text-[13px] text-ink-muted">
              <span className="font-medium text-ink">Reference:</span> {referenceNote(citation)}
            </p>
          )}

          {citation.resolution ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <CitationBadge verdict={citation.verdict} />
              <span>
                {citation.resolution.kind === 'replaced'
                  ? `Replaced \\cite{${citation.resolution.previousKey}} with \\cite{${citation.key}}.`
                  : citation.resolution.note
                    ? `Kept, with a note: “${citation.resolution.note}”`
                    : 'Kept as written.'}
              </span>
              {citation.resolution.kind === 'overridden' && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onReopen(citation)}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reopen
                </Button>
              )}
            </div>
          ) : noteOpen ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                submitNote()
              }}
            >
              <label htmlFor="override-note" className="text-xs font-medium text-ink">
                Why you are keeping this citation
              </label>
              <textarea
                id="override-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                autoFocus
                placeholder="e.g. Table 3 of the cited paper shows exactly this"
                className="w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm placeholder:text-ink-muted"
              />
              <div className="flex gap-2">
                <Button type="submit">Keep mine</Button>
                <Button type="button" variant="ghost" onClick={() => setNoteOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => pdfInput.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
                Upload source PDF
              </Button>
              <input
                ref={pdfInput}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onAttachPdf(citation, file)
                }}
              />
              <Button variant="ghost" onClick={() => setNoteOpen(true)}>
                <PencilLine className="size-4" aria-hidden="true" />
                Override · add note
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
