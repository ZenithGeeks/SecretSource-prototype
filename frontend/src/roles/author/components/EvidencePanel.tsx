/**
 * "Evidence — issue N of M": the selected citation's sentence beside the passage the verdict
 * rests on, why, whether the bib metadata checked out, and the three ways to act on it.
 * "Override · add note" and the editor's "Keep mine" are the same action, so the note form
 * lives here and the editor reuses this component's pieces later.
 */

import { AlertCircle, CheckCircle2, ChevronRight, PencilLine, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import type { Citation, SearchResult } from '../../../types/draftCheck'
import { replacementLabel, sourceLabel } from '../labels'
import { CardHead, TextLink } from './CardHead'
import { CitationBadge } from './Verdicts'

export function EvidencePanel({
  citation,
  issues,
  onNext,
  onReplace,
  onOverride,
  onReopen,
  onAttachPdf,
}: {
  citation: Citation | undefined
  /** The open issues, for the "N of M" pager. */
  issues: Citation[]
  onNext: () => void
  onReplace: (citation: Citation, replacement: SearchResult) => void
  onOverride: (citation: Citation, note: string) => void
  onReopen: (citation: Citation) => void
  onAttachPdf: (citation: Citation, file: File) => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
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
              {citation.evidence ? (
                <>
                  <p className="text-[11px] font-medium text-ink-muted">
                    <span className="uppercase tracking-wide">Source passage</span> · {citation.evidence.pdf} p.
                    {citation.evidence.page}
                  </p>
                  <blockquote className="font-serif text-[13px] italic leading-relaxed text-ink">
                    “{citation.evidence.passage}”
                  </blockquote>
                  <TextLink
                    className="self-start"
                    title="Opening the source PDF arrives with the gateway"
                    aria-disabled
                    onClick={() => undefined}
                  >
                    show in the paper
                  </TextLink>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Source passage</p>
                  <p className="text-[13px] text-ink-muted">
                    {citation.verdict === 'unavailable' ? 'The source PDF could not be read.' : 'Not checked yet.'}
                  </p>
                </>
              )}
            </div>
          </div>

          {citation.explanation && (
            <p className="text-[13px] text-ink-muted">
              <span className="font-medium text-ink">Why:</span> {citation.explanation}
            </p>
          )}

          {citation.metadataMatch && (
            <p className={cn('flex items-center gap-2 text-xs', citation.metadataMatch.ok ? 'text-supports' : 'text-insufficient')}>
              {citation.metadataMatch.ok ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              )}
              {citation.metadataMatch.text}
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
              {citation.suggestedReplacement && (
                <Button onClick={() => onReplace(citation, citation.suggestedReplacement!)}>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Replace with {replacementLabel(citation.suggestedReplacement)}
                </Button>
              )}
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
