/**
 * "Evidence — issue N of M": the selected citation's sentence beside the passage the verdict
 * rests on, why, and the ways to act on it: edit the sentence at its line (first, the usual fix),
 * upload the source PDF (only when no passage was read), or keep the citation with a note. "Override · add note" and the editor's "Keep mine" are the same action, so the
 * note form lives here and the popover reuses the wording.
 *
 * "show in the paper" opens the source PDF at the passage in the shared PageViewer, the way
 * a researcher's claim card does: the gateway locates the text, the viewer highlights it.
 */

import { ChevronRight, PencilLine, RotateCcw, SquarePen, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import type { Target } from '../../../components/PageViewer'
import { Button, Card, Empty, Textarea } from '../../../components/ui'
import { api } from '../../../lib/api'
import { askTarget } from '../../../lib/askCursor'
import { shortMessage } from '../../../lib/citations'
import { referenceNote } from '../../../lib/referenceCheck'
import { isNotFound, isOpenIssue, settledHint } from '../../../lib/verdict'
import type { Citation, DraftStatus } from '../../../types/draftCheck'
import { sourceLabel } from '../labels'
import { CardHead, TextLink } from './CardHead'
import { AuditNote, CitationBadge } from './Verdicts'
import { LINK } from '../hover'

export function EvidencePanel({
  citation,
  issues,
  status,
  notJudged,
  onNext,
  onOverride,
  onReopen,
  onAttachPdf,
  onShow,
  onEdit,
}: {
  citation: Citation | undefined
  /** The open issues, for the "N of M" pager. */
  issues: Citation[]
  /** The draft's counts, so "No open issues" says what they say (#727). */
  status: DraftStatus
  /** No verdicts to show yet (title, hint), so "no open issues" would say too much. */
  notJudged?: [string, string]
  onNext: () => void
  onOverride: (citation: Citation, note: string) => void
  onReopen: (citation: Citation) => void
  onAttachPdf: (citation: Citation, file: File) => void
  /** Open the source PDF at the passage. */
  onShow?: (target: Target) => void
  /** Open the editor at the citation's line: the usual fix is to change the sentence. */
  onEdit?: (citation: Citation) => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState(false)
  const pdfInput = useRef<HTMLInputElement>(null)

  const index = citation ? issues.findIndex((c) => c.id === citation.id) : -1
  const pager =
    issues.length === 0
      ? (notJudged?.[0].toLowerCase() ?? 'no open issues')
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
            data-ask-target={askTarget({ kind: 'action', id: 'next-issue' })}
            className={`flex items-center gap-1 text-xs text-accent disabled:cursor-default disabled:text-ink-muted ${LINK}`}
          >
            {pager}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        }
      />

      {!citation ? (
        notJudged ? (
          <Empty title={notJudged[0]} hint={notJudged[1]} />
        ) : (
          <Empty title="No open issues" hint={`${settledHint(status)} Pick a row above to read its evidence.`} />
        )
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-canvas p-3">
              <p className="text-[11px] font-medium break-words text-ink-muted">
                <span className="uppercase tracking-wide">Your sentence</span> · {citation.file} L{citation.line}
              </p>
              <p className="font-mono text-xs leading-relaxed break-words text-ink">{citation.sentence}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-canvas p-3">
              {citation.evidence?.passage ? (
                <>
                  <p className="text-[11px] font-medium break-words text-ink-muted">
                    <span className="uppercase tracking-wide">Source passage</span> · {citation.evidence.pdf}
                    {citation.evidence.page ? ` p.${citation.evidence.page}` : ''}
                  </p>
                  <blockquote className="font-serif text-[13px] italic leading-relaxed break-words text-ink">
                    “{citation.evidence.passage}”
                  </blockquote>
                  {onShow && (
                    <TextLink
                      className="self-start"
                      onClick={() => void showInPaper()}
                      aria-disabled={locating}
                      data-ask-target={askTarget({ kind: 'action', id: 'show-in-paper' })}
                    >
                      {locating ? 'locating…' : 'show in the paper'}
                    </TextLink>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Source passage</p>
                  <p className="text-[13px] break-words text-ink-muted">
                    {citation.verdict === 'unavailable'
                      ? `The source could not be read: ${shortMessage(citation.message) || 'no PDF'}.`
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
              <CitationBadge verdict={citation.verdict} notFound={isNotFound(citation)} />
              <span>
                {citation.resolution.kind === 'replaced'
                  ? `Replaced \\cite{${citation.resolution.previousKey}} with \\cite{${citation.key}}.`
                  : citation.resolution.note
                    ? `Kept, with a note: “${citation.resolution.note}”`
                    : 'Kept as written.'}
              </span>
              {citation.resolution.kind === 'overridden' && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => onReopen(citation)}
                  data-ask-target={askTarget({ kind: 'action', id: 'reopen' })}
                >
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
              <Textarea
                id="override-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                autoFocus
                placeholder="e.g. Table 3 of the cited paper shows exactly this"
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
              {/* An open issue is usually fixed in the sentence; a citation with no answer, in its
                  source or the .bib, so there the upload leads and Edit steps back. */}
              {onEdit && (
                <Button
                  variant={isOpenIssue(citation) ? 'solid' : 'ghost'}
                  onClick={() => onEdit(citation)}
                  data-ask-target={askTarget({ kind: 'action', id: 'edit-at-line' })}
                >
                  <SquarePen className="size-4" aria-hidden="true" />
                  Edit at L{citation.line}
                </Button>
              )}
              {/* A passage read from the published paper settles it: an upload would not change the
                  verdict. One read from a preprint (#424) might, so the upload stays there. */}
              {(!citation.evidence?.passage || citation.sourceVersion === 'preprint') && (
                <>
                  <Button
                    variant={isOpenIssue(citation) ? 'ghost' : 'solid'}
                    onClick={() => pdfInput.current?.click()}
                    data-ask-target={askTarget({ kind: 'action', id: 'upload-pdf' })}
                  >
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
                </>
              )}
              <Button variant="ghost" onClick={() => setNoteOpen(true)} data-ask-target={askTarget({ kind: 'action', id: 'override' })}>
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
