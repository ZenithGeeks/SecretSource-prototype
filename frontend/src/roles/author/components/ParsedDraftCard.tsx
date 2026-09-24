/** "Parsed draft": what the parse found and what it warns about. Each warning row and
 * "Fix in editor" open the editor at the file + line concerned. */

import { Loader2 } from 'lucide-react'

import { Card, Empty } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import type { ParseResult, ParseWarning, ParseWarningType } from '../../../types/draftCheck'
import type { EditorTarget } from '../editorTarget'
import { CardHead, TextLink } from './CardHead'

const WARNING_TITLE: Record<ParseWarningType, string> = {
  'missing-key': 'Missing bib key',
  'duplicate-key': 'Duplicate key',
  'unused-entry': 'Unused entry',
  'no-doi-url': 'No DOI or URL',
}

/** Missing and duplicate keys break the check (contradicted colour); an unused entry is
 * worth a look (silent colour); a missing locator is only a note. */
const WARNING_TONE: Record<ParseWarningType, string> = {
  'missing-key': 'text-refutes',
  'duplicate-key': 'text-refutes',
  'unused-entry': 'text-insufficient',
  'no-doi-url': 'text-ink-muted',
}

export function ParsedDraftCard({
  draftId,
  parse,
  error,
  onOpenEditor,
}: {
  draftId: string
  parse: ParseResult | undefined
  error?: Error | null
  onOpenEditor: (target: EditorTarget) => void
}) {
  const warnings = parse?.warnings ?? []
  const openAt = (w: ParseWarning) => onOpenEditor({ draftId, file: w.file, line: w.line })

  return (
    <Card className="flex flex-col gap-2.5" aria-labelledby="parsed-draft-title">
      <CardHead
        id="parsed-draft-title"
        title="Parsed draft"
        aside={
          parse && (
            <span className={warnings.length ? 'text-refutes' : 'text-supports'}>
              {warnings.length === 0 ? 'no warnings' : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
            </span>
          )
        }
      />
      {error ? (
        <p className="text-sm text-refutes">Could not parse this draft: {error.message}</p>
      ) : !parse ? (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Parsing…
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            {parse.texFiles} .tex file{parse.texFiles === 1 ? '' : 's'} · {parse.citeCommands} \cite command
            {parse.citeCommands === 1 ? '' : 's'} · {parse.bibEntries} bib entr{parse.bibEntries === 1 ? 'y' : 'ies'}
          </p>
          {warnings.length === 0 ? (
            <Empty title="Nothing to fix" hint="Every \cite key resolves and every entry is used." />
          ) : (
            <ul>
              {warnings.map((w) => (
                <li key={`${w.type}-${w.file}-${w.line}`} className="border-b border-border-subtle">
                  <button
                    type="button"
                    onClick={() => openAt(w)}
                    className="flex w-full flex-col items-start gap-0.5 rounded py-2 text-left hover:bg-accent-soft/40"
                    aria-label={`${WARNING_TITLE[w.type]}: ${w.detail}. Open ${w.file} line ${w.line} in the editor`}
                  >
                    <span className={cn('text-[13px] font-medium', WARNING_TONE[w.type])}>{WARNING_TITLE[w.type]}</span>
                    <span className="font-mono text-xs text-ink-muted">{w.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <TextLink
            onClick={() => (warnings[0] ? openAt(warnings[0]) : onOpenEditor({ draftId }))}
            className="self-start"
          >
            Fix in editor
          </TextLink>
        </>
      )}
    </Card>
  )
}
