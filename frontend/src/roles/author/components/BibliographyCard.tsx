/** "Bibliography" (Redesign A1): what the parse found and what it warns about, across the whole
 * project when the draft has one (#714). Each warning row and "Fix in editor" open the editor at
 * the file + line concerned, in the draft the warning is in. */

import { Loader2 } from 'lucide-react'

import { Card, Empty, ErrorState } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { errorMessage } from '../../../lib/author'
import { WARNING_TITLE } from '../../../lib/latexProject'
import { cn } from '../../../lib/utils'
import type { ParseResult, ParseWarning, ParseWarningType, ProjectLint } from '../../../types/draftCheck'
import type { EditorTarget } from '../editorTarget'
import { CardHead, TextLink } from './CardHead'
import { FOCUS } from '../hover'

/** A missing key breaks the check (contradicted colour), a duplicate may read the wrong source
 * (silent colour); the other two are only notes. */
const WARNING_TONE: Record<ParseWarningType, string> = {
  'missing-key': 'text-refutes',
  'duplicate-key': 'text-insufficient',
  'unused-entry': 'text-ink',
  'no-doi-url': 'text-ink',
}

export function BibliographyCard({
  draftId,
  parse,
  error,
  onRetry,
  draftTitle,
  onOpenEditor,
}: {
  draftId: string
  parse: ParseResult | ProjectLint | undefined
  error?: Error | null
  onRetry?: () => void
  /** Names another draft of the project on a warning that is in it. */
  draftTitle: (id: string) => string | undefined
  onOpenEditor: (target: EditorTarget) => void
}) {
  const warnings: ParseWarning[] = parse?.warnings ?? []
  const openAt = (w: ParseWarning) => onOpenEditor({ draftId: w.draftId ?? draftId, file: w.file, line: w.line })
  // The first one in this draft or the project's .bib: "Fix" does not move to another draft.
  const first = warnings.find((w) => !w.draftId || w.draftId === draftId)
  const across = parse && 'drafts' in parse && parse.drafts > 1 ? ` · across ${parse.drafts} drafts` : ''

  return (
    <Card className="flex min-w-0 flex-col gap-3 rounded-2xl p-0 pt-5" aria-labelledby="bibliography-title">
      <div className="flex flex-col gap-1 px-5">
        <CardHead
          id="bibliography-title"
          title="Bibliography"
          aside={
            parse && !error && (
              <span className={warnings.length ? 'text-insufficient' : 'text-ink-muted'}>
                {warnings.length === 0 ? 'no warnings' : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
              </span>
            )
          }
        />
        {parse && !error && (
          <p className="text-xs text-ink-muted">
            {parse.texFiles} .tex file{parse.texFiles === 1 ? '' : 's'} · {parse.citeCommands} \cite command
            {parse.citeCommands === 1 ? '' : 's'} · {parse.bibEntries} bib entr{parse.bibEntries === 1 ? 'y' : 'ies'}
            {across}
          </p>
        )}
      </div>
      {error ? (
        <div className="px-5 pb-5">
          <ErrorState title="Could not read the bibliography" message={errorMessage(error)} onRetry={onRetry} />
        </div>
      ) : !parse ? (
        <p className="flex items-center gap-2 px-5 pb-5 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Parsing…
        </p>
      ) : (
        <>
          {warnings.length === 0 ? (
            <div className="px-5">
              <Empty title="Nothing to fix" hint="Every \cite key resolves and every entry is used." />
            </div>
          ) : (
            <ul>
              {warnings.map((w, index) => {
                const elsewhere = w.draftId && w.draftId !== draftId ? draftTitle(w.draftId) : undefined
                return (
                  <li key={`${w.type}-${w.draftId ?? ''}-${w.file}-${w.line}-${w.detail}`} className="border-t border-border-subtle">
                    <button
                      type="button"
                      onClick={() => openAt(w)}
                      data-ask-target={askTarget({ kind: 'action', id: `fix-warning-${index + 1}` })}
                      className={`flex w-full min-w-0 flex-col items-start gap-0.5 px-5 py-2.5 text-left hover:bg-accent-soft/40 ${FOCUS}`}
                      aria-label={`${WARNING_TITLE[w.type]}: ${w.detail}${elsewhere ? ` in ${elsewhere}` : ''}. Open ${w.file} line ${w.line} in the editor`}
                    >
                      <span className={cn('text-[13px]', WARNING_TONE[w.type])}>{WARNING_TITLE[w.type]}</span>
                      <span title={w.detail} className="max-w-full truncate font-mono text-xs text-ink-muted">
                        {w.detail}
                        {elsewhere && ` · ${elsewhere}`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className={cn('px-5 py-3', warnings.length > 0 && 'border-t border-border-subtle')}>
            <TextLink
              onClick={() => (first ? openAt(first) : onOpenEditor({ draftId }))}
              className="text-[13px]"
              data-ask-target={askTarget({ kind: 'action', id: 'fix-in-editor' })}
            >
              Fix in editor
            </TextLink>
          </div>
        </>
      )}
    </Card>
  )
}
