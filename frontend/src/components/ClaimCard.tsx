/** One claim, answered: whether it held, what the paper said, and what each source replied. */

import { ChevronDown, ChevronRight, FileText, Loader2, Sparkles, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

import type { Citation, Claim, Dispute, PaperFigure, Stage, Unchecked, Verdict } from '../lib/api'
import { api, figureImageUrl, reasonText } from '../lib/api'
import { findQuote } from '../lib/findQuote'
import { useOpenPart } from '../lib/openParts'
import { citationLink, citationNumber, preprintNote, reference } from '../lib/citations'
import { answersFor, citedAs, opensByDefault, STANDING_MEANINGS, STANDINGS, unpaired, verdictCountLabel, verdictTally } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { fromUploadedPdf, recheckFailure, recheckStage, sourceUploadMessage } from '../lib/sourceUpload'
import { cn } from '../lib/utils'
import { AuthorizedImage } from './AuthorizedImage'
import type { Target } from './PageViewer'
import { DISCLOSURE_SUMMARY, StandingCounts } from './StandingKey'
import { StandingBadge, TextButton, VerdictBadge } from './ui'
import { VerdictDispute } from './VerdictDispute'

/** How a cited work is named in the page viewer and on its figures: its title where the claim's
 * citation has one, else the file name it was read from. ClaimCard provides it per claim. */
/* v8 ignore next -- every reader sits under ClaimCard's Provider; the default only satisfies the type */
const SourceName = createContext<(verdict: Verdict) => string>((verdict) => verdict.source)

/** The claim a card's parts are remembered under. ClaimCard provides it. */
const CardKey = createContext('')

/** The verdict colour, as the short rule before an evidence panel's label. */
const VERDICT_BAR = {
  supports: 'bg-supports',
  refutes: 'bg-refutes',
  insufficient: 'bg-insufficient',
} as const

/** What the explanation under a claim answers, by how the claim came out. */
const WHY_LABELS = {
  supports: 'Why it holds',
  refutes: 'Why it doesn’t hold',
  insufficient: 'Why it isn’t settled',
} as const

/** What the page viewer calls a quote from a cited work that did not decide the claim. */
const QUOTE_LABELS = {
  supports: 'Supporting quote',
  refutes: 'Contradicting quote',
  insufficient: 'Quote',
} as const

/** A small heading that says where the text under it comes from. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-label text-ink-muted">{children}</p>
  )
}

/** The page of the retrieved passage that contains the quote, if one does. */
function quotePage(verdict: Verdict) {
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()
  const start = flat(verdict.quote).slice(0, 80)
  if (!start) return undefined
  return verdict.evidence.find((passage) => flat(passage.text).includes(start))?.page
}

/** What to write under a crop: the caption when it already names the figure, the label
 * with the caption after it when it does not, the label alone when there is no caption. */
function captionOf(hit: Hit) {
  const label = hitName(hit)
  const caption = (hit.caption ?? '').trim()
  if (!caption) return label
  return caption.toLowerCase().startsWith(label.toLowerCase()) ? caption : `${label}: ${caption}`
}

/** What the paper calls a visual hit: "Figure 3" where it has a name, "page 7" otherwise. */
function hitName(hit: { page: number; label?: string }) {
  return hit.label && hit.label.trim() ? hit.label : `page ${hit.page}`
}

/**
 * The paper's sentence as the paper wrote it.
 *
 * The gateway writes each citation as a "[b12]" marker, GROBID's id for the reference. We put
 * back the number the paper prints ("[13]"), so the sentence reads as it does in the PDF.
 * Markers next to each other become one list, "[5, 25]". A marker whose number we do not know
 * is removed.
 */
function asWritten(sentence: string, citations: Citation[] = []) {
  const numbers = new Map(
    citations.filter((c) => c.ref && citationNumber(c)).map((c) => [c.ref, citationNumber(c)]),
  )
  return sentence
    .replace(/(?:\s*\[b\d+\])+/g, (run) => {
      const printed = [...run.matchAll(/\[(b\d+)\]/g)]
        .map((marker) => numbers.get(marker[1]))
        .filter(Boolean)
      return printed.length ? ` [${printed.join(', ')}]` : ''
    })
    .trim()
}

/** "Figure 2", "Fig. 2" or "Fig 2b" in a sentence. The number is group 1. */
const FIGURE_MENTION = /\bFig(?:ure|\.)?\s*(\d+[a-z]?)\b/gi

function figureByNumber(figures: PaperFigure[], number: string) {
  return figures.find((figure) => figure.label.toLowerCase() === `figure ${number.toLowerCase()}`)
}

/** The paper's own figures that a sentence names, once each, in the order it names them. */
function figuresNamedIn(sentence: string, figures: PaperFigure[]) {
  const named: PaperFigure[] = []
  for (const mention of sentence.matchAll(FIGURE_MENTION)) {
    const figure = figureByNumber(figures, mention[1])
    if (figure && !named.includes(figure)) named.push(figure)
  }
  return named
}

/**
 * The sentence with each "Figure N" as a link, but only where the paper has that figure.
 * A mention of a figure we did not extract stays plain text, so it never opens the wrong one.
 */
function withFigureLinks(
  sentence: string,
  figures: PaperFigure[],
  open?: (figure: PaperFigure) => void,
) {
  if (!open || figures.length === 0) return sentence
  const parts: React.ReactNode[] = []
  let last = 0
  for (const mention of sentence.matchAll(FIGURE_MENTION)) {
    const figure = figureByNumber(figures, mention[1])
    if (!figure) continue
    parts.push(sentence.slice(last, mention.index))
    parts.push(
      <button
        key={mention.index}
        onClick={() => open(figure)}
        className="rounded-sm text-accent underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {mention[0]}
      </button>,
    )
    last = mention.index + mention[0].length
  }
  parts.push(sentence.slice(last))
  return parts
}

/** A page reference the reader can click to see the page it names. */
function PageLink({
  page,
  onClick,
  children,
}: {
  page: number
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <TextButton onClick={onClick} className="bg-canvas px-1.5 py-0.5 tabular-nums">
      {children ?? `p. ${page}`}
    </TextButton>
  )
}

/** A source we could not read, in the reader's terms and then in the operator's. */
function Failure({ failure, action }: { failure: Unchecked; action?: ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-border-subtle p-3">
      <p className="text-sm">
        <span className="font-medium">Not checked</span>
        <span className="text-ink-muted"> — {reasonText(failure.reason)}</span>
      </p>
      {/* The lookup's own words say whether it was rate limited rather than empty, but they are
          written for whoever debugs the lookup, so they wait behind a disclosure. */}
      {failure.message && (
        <details className="mt-1 text-xs text-ink-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1">{failure.message}</p>
        </details>
      )}
      {action}
    </div>
  )
}

/** The verdict was read from a PDF the analysis owner uploaded, not from an open-access copy. */
function UploadedNote({ owns }: { owns: boolean }) {
  return (
    <p className="text-xs text-ink-muted">
      {owns
        ? 'This verdict was read from a PDF you uploaded.'
        : 'This verdict was read from a PDF the analysis owner uploaded.'}
    </p>
  )
}

/** "Upload source PDF" for one unchecked citation, then "checking" until the re-check ends.
 * The re-check is not on the event stream: `onUploaded` refetches the analysis, and the
 * stages say when it has finished. */
function SourcePdfUpload({
  analysisId,
  citationRef,
  stages,
  onUploaded,
}: {
  analysisId: string
  citationRef: string
  stages: Stage[]
  onUploaded: () => Promise<unknown>
}) {
  // `since` is how many stages there were when this upload started. A later `rechecked` or
  // `recheck-failed` stage means this upload's re-check has finished, so the action can return.
  const [since, setSince] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const outcome = recheckStage(stages, citationRef)
  const arrived = since === null ? [] : stages.slice(since)
  const finished = arrived.some(
    (stage) => (stage.stage === 'rechecked' || stage.stage === 'recheck-failed') && stage.ref === citationRef,
  )
  const checking = (since !== null && !finished) || outcome === 'rechecking'
  const notice = error ?? (checking ? undefined : recheckFailure(stages, citationRef))

  const send = async (file: File) => {
    setSince(stages.length)
    setError(null)
    try {
      await api.uploadReferencePdf(analysisId, citationRef, file)
    } catch (caught) {
      setSince(null)
      setError(sourceUploadMessage(caught))
      return
    }
    try {
      await onUploaded()
    } catch {
      // The upload was accepted. The analysis poll still updates the card once a refetch lands.
    }
  }

  if (checking) {
    return (
      <p role="status" className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking the uploaded PDF…
      </p>
    )
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas pointer-coarse:min-h-11 hover:opacity-90 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Upload className="size-4" aria-hidden="true" />
        Upload source PDF
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (chosen) void send(chosen)
          }}
        />
      </label>
      {notice && (
        <p role="alert" className="text-sm text-refutes">
          {notice}
        </p>
      )}
    </div>
  )
}

/** "Ioffe et al. 2015": a cited work in the few words a row or a panel label has room for. */
function shortRef(citation: Citation) {
  const who = citation.authors[0]
    ? `${citation.authors[0]}${citation.authors.length > 1 ? ' et al.' : ''}`
    : citation.title || citation.venue || (citation.arxiv ? `arXiv:${citation.arxiv}` : 'Untitled')
  return citation.year ? `${who} ${citation.year}` : who
}

/** Counts "Show in cited paper" clicks, so a slow lookup cannot replace a newer click's page. */
let showRequests = 0

/** Show the cited paper at once, then the quote's place in it once the lookup finds it. The
 * lookup can take seconds, and until then the viewer says it is looking. */
async function showInCitedPaper(
  verdict: Verdict,
  onShow: (target: Target) => void,
  label: string,
  quote: string,
  page?: number,
) {
  const request = ++showRequests
  const target: Target = { paper: verdict.source, label, quote, source: null, page, verdict: verdict.verdict, lookup: request }
  onShow({ ...target, locating: true })
  const found = await findQuote(verdict.source, quote, page)
  if (request !== showRequests) return
  onShow({ ...target, source: found, page: found?.page ?? page })
}

/** Past this many characters a quote is set upright: long italic text is slow to read. */
const LONG_QUOTE = 200

/** A quote and where it sits: the paper's own sentence, or what a cited work says (Figma "side-by-side"). */
function EvidencePanel({
  bar,
  label,
  action,
  onAction,
  shortcut,
  inPaper,
  long = false,
  children,
}: {
  /** The standing's colour, as a short rule before the label; none for the paper's own sentence. */
  bar?: string
  label: string
  action?: string
  onAction?: () => void
  /** The key that triggers the action from anywhere in the card (AnalysisView listens for it). */
  shortcut?: string
  /** The action shows the claim in the analysed paper: why there is no cited quote instead, which O reads out. */
  inPaper?: string
  long?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl bg-neutral-soft px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {bar && <span aria-hidden="true" className={cn('h-3 w-0.75 shrink-0 rounded-sm', bar)} />}
        <p className="type-label truncate text-ink-muted">{label}</p>
      </div>
      <blockquote className={cn('font-serif text-base leading-6.5', !long && 'italic')}>{children}</blockquote>
      {action && onAction && (
        <TextButton
          onClick={onAction}
          aria-keyshortcuts={shortcut}
          data-in-paper={inPaper}
          className="mt-auto inline-flex items-center gap-1 self-start text-ui leading-4.5"
        >
          {action}
          <ChevronRight className="size-4" aria-hidden="true" />
        </TextButton>
      )}
    </div>
  )
}

/** "Read the full reasoning" or "4 more passages": link colour and a chevron, as "Show in cited paper" has. */
function MoreToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <TextButton onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 self-start text-ui leading-4.5">
      {children}
      <ChevronDown className={cn('size-4', open && 'rotate-180')} aria-hidden="true" />
    </TextButton>
  )
}

/** A figure's caption, cut at three lines until the reader asks for all of it. */
function Caption({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  return (
    <figcaption className="space-y-1 text-xs text-ink-muted">
      <span className={cn('block', text.length > LONG_CAPTION && !full && 'line-clamp-3')}>{text}</span>
      {text.length > LONG_CAPTION && (
        <MoreToggle open={full} onToggle={() => setFull(!full)}>
          {full ? 'Hide the full caption' : 'Read the full caption'}
        </MoreToggle>
      )}
    </figcaption>
  )
}

/** The retrieved passages behind a verdict, each a quote with the page it came from. The data
 * does not mark which words matched, so nothing in them is emphasised. */
function Passages({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const name = useContext(SourceName)
  return (
    <ul className="space-y-3">
      {verdict.evidence.map((passage, j) => (
        <li key={j} className="space-y-1">
          {onShow ? (
            <PageLink
              page={passage.page}
              onClick={() => showInCitedPaper(verdict, onShow, `Passage in ${name(verdict)}`, passage.text, passage.page)}
            />
          ) : (
            <span className="rounded-sm bg-neutral-soft px-1.5 py-0.5 text-xs font-medium tabular-nums">p. {passage.page}</span>
          )}
          <Passage text={passage.text} />
        </li>
      ))}
    </ul>
  )
}

/** One retrieved passage, cut at three lines until the reader asks for all of it. */
function Passage({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  return (
    <>
      <blockquote className={cn('max-w-prose font-serif text-reading leading-6 text-ink', text.length > LONG_REASON && !full && 'line-clamp-3')}>“{text}”</blockquote>
      {text.length > LONG_REASON && (
        <MoreToggle open={full} onToggle={() => setFull(!full)}>
          {full ? 'Hide the full passage' : 'Read the full passage'}
        </MoreToggle>
      )}
    </>
  )
}

type Hit = NonNullable<Verdict['pages']>[number]

/** Whether the verdict was read off this crop: the figure judge's crop, matched by file name. */
function isJudged(verdict: Verdict, hit: Hit) {
  if (verdict.verdict_from !== 'figure' || !verdict.judged_figure || !hit.image) return false
  return hit.image.split('/').pop() === verdict.judged_figure
}

/** The page a hit was found on, with the crop's box outlined where we know it (#564). */
function hitTarget(verdict: Verdict, hit: Hit, name: string): Target {
  return {
    paper: verdict.source,
    label: `${hitName(hit)} of ${name}`,
    source: hit.region ?? null,
    page: hit.page,
    verdict: verdict.verdict,
  }
}

/** A figure or table match with a picture of it; a page match has none. */
const hasCrop = (hit: Hit) => hit.kind !== 'page' && Boolean(hit.image)

/** The figure and table crops the cited work was matched on: naming a figure and making the
 * reader open a page to see it is most of the work of looking it up. Pages have no crop. The
 * crop the verdict was read off comes first and says so; the others follow in match order. */
function FigureCrops({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const name = useContext(SourceName)
  const hits = (verdict.pages ?? []).filter(hasCrop)
  if (!hits.length) return null
  const ordered = [...hits.filter((hit) => isJudged(verdict, hit)), ...hits.filter((hit) => !isJudged(verdict, hit))]
  return (
    <div className="flex flex-wrap gap-3">
      {ordered.map((hit, k) => {
        const judged = isJudged(verdict, hit)
        const image = (
          <AuthorizedImage
            src={figureImageUrl(verdict.source, hit.image as string)}
            alt={hit.caption || `${hitName(hit)} of ${name(verdict)}`}
            loading="lazy"
            className={cn(
              'max-h-40 rounded-lg border bg-surface object-contain',
              judged ? 'border-accent' : 'border-border-subtle',
            )}
          />
        )
        return (
          <figure key={k} className="max-w-56 space-y-1">
            {judged && <p className="type-label text-accent">The verdict rests on this {hit.kind ?? 'figure'}</p>}
            {onShow ? (
              <button
                type="button"
                onClick={() => onShow(hitTarget(verdict, hit, name(verdict)))}
                aria-label={`Show ${hitName(hit)} on its page in ${name(verdict)}`}
                className="block rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
              >
                {image}
              </button>
            ) : (
              image
            )}
            {/* Docling's caption usually already opens with "Figure 3:", so prefixing the label
                again reads as a stutter. */}
            <Caption text={captionOf(hit)} />
          </figure>
        )
      })}
    </div>
  )
}

/** The pages of the cited work the match was found on, as chips that open them. */
function PageChips({ verdict, pages, onShow }: { verdict: Verdict; pages: Hit[]; onShow?: (target: Target) => void }) {
  const name = useContext(SourceName)
  const title = verdict.page_model ? 'Found by searching the pages as images' : undefined
  return (
    <>
      {pages.map((hit, k) => {
        const text = `${hitName(hit).replace(/^./, (c) => c.toUpperCase())} in the cited paper`
        const chip = 'inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1.25 text-xs leading-4 font-medium text-accent'
        return onShow ? (
          <button
            key={k}
            type="button"
            // Named by its words; the search method is only the description, from the title.
            aria-label={text}
            title={title}
            onClick={() => onShow(hitTarget(verdict, hit, name(verdict)))}
            className={cn(chip, 'hover:underline focus-visible:outline-2 focus-visible:outline-accent')}
          >
            <FileText className="size-4" aria-hidden="true" />
            {text}
          </button>
        ) : (
          <span key={k} title={title} className={chip}>
            <FileText className="size-4" aria-hidden="true" />
            {text}
          </span>
        )
      })}
    </>
  )
}

/** Says the verdict was read from the cited work's arXiv copy, whose text can differ from the
 * published paper (#424). Nothing for a verdict read from the publisher's PDF. */
function PreprintNote({ verdict }: { verdict: Verdict }) {
  if (verdict.source_version !== 'preprint') return null
  const note = preprintNote(verdict.arxiv).replace(/^./, (c) => c.toUpperCase())
  return <p className="text-xs text-ink-muted">{note}. Its wording or numbers can differ from the published paper.</p>
}

/** Everything behind a verdict past its quote and reasoning, folded into one disclosure so an
 * open card stays short: the preprint note, the pages and figures it was matched on, and the
 * retrieved passages. The count is the number of items inside. */
function MoreEvidence({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const [open, setOpen] = useOpenPart(`${useContext(CardKey)} more ${verdict.source}`, false)
  const pages = verdict.pages ?? []
  // A match with a crop shows as its picture below, so it gets no chip as well.
  const chips = pages.filter((hit) => !hasCrop(hit))
  const count = (verdict.source_version === 'preprint' ? 1 : 0) + pages.length + verdict.evidence.length
  if (!count) return null
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={cn(DISCLOSURE_SUMMARY, 'text-ui')}>
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        More evidence ({count})
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <PreprintNote verdict={verdict} />
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <PageChips verdict={verdict} pages={chips} onShow={onShow} />
          </div>
        )}
        <FigureCrops verdict={verdict} onShow={onShow} />
        {verdict.evidence.length > 0 && <Passages verdict={verdict} onShow={onShow} />}
      </div>
    </details>
  )
}

function CitationReference({ citation }: { citation: Citation }) {
  const link = citationLink(citation)
  return (
    <p className="text-sm text-ink-muted">
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          // Underlined on hover only, so a linked reference looks like the unlinked ones beside it.
          className="hover:text-accent hover:underline"
        >
          {reference(citation)}
        </a>
      ) : (
        reference(citation)
      )}
      {/* The number the PDF prints for this work, to find it in the paper's reference list. */}
      {citationNumber(citation) && (
        <span className="ml-1 font-medium text-ink tabular-nums">[{citationNumber(citation)}]</span>
      )}
    </p>
  )
}

/** What a source answered, for a cited work that is not the claim's main evidence: one line until
 * opened, then the deciding quote and the working behind it. */
function Answer({
  verdict,
  onShow,
  footer,
  fromUpload = false,
  ownsAnalysis = false,
}: {
  verdict: Verdict
  onShow?: (target: Target) => void
  footer?: ReactNode
  /** The verdict was read from a PDF the owner uploaded. */
  fromUpload?: boolean
  ownsAnalysis?: boolean
}) {
  const name = useContext(SourceName)
  const [open, setOpen] = useState(false)
  const page = verdict.quote ? quotePage(verdict) : undefined

  // The card already leads with the deciding source; the others stay one line each, so a claim
  // citing eight works is not eight full panels long.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="mt-2 flex w-full items-center gap-2.5 rounded-xl bg-neutral-soft px-3.5 py-2.5 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <VerdictBadge verdict={verdict.verdict} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
          {verdict.quote || verdict.reasoning}
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-neutral-soft p-3.5">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded
        className="flex items-center gap-2.5 self-start rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
      >
        <VerdictBadge verdict={verdict.verdict} />
        <ChevronDown className="size-4 text-ink-muted" aria-hidden="true" />
      </button>

      {verdict.quote && (
        <EvidencePanel
          bar={VERDICT_BAR[verdict.verdict]}
          label={`What the cited paper says${page ? ` · page ${page}` : ''}`}
          action={onShow ? 'Show in cited paper' : undefined}
          onAction={onShow && (() => showInCitedPaper(verdict, onShow, `${QUOTE_LABELS[verdict.verdict]} in ${name(verdict)}`, verdict.quote, page))}
        >
          “{verdict.quote}”
        </EvidencePanel>
      )}

      <div className="space-y-1.5">
        <Label>{WHY_LABELS[verdict.verdict]}</Label>
        <p className="max-w-prose text-sm text-ink-muted">{verdict.reasoning}</p>
        {fromUpload && <UploadedNote owns={ownsAnalysis} />}
        {footer}
      </div>
      <MoreEvidence verdict={verdict} onShow={onShow} />
    </div>
  )
}

/** About three lines of reasoning at the card's width; longer text folds behind "Read the full reasoning". */
const LONG_REASON = 300
/** About three lines of a caption at a figure's width. */
const LONG_CAPTION = 120

/** The claim is the paper's sentence word for word, apart from case, spacing and punctuation. */
function sameWords(a: string, b?: string) {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return !!b && words(a) === words(b)
}

/** How one cited work answered, as a standing: its verdict, else why it was not checked. */
function citedStanding(claim: Claim, citation: Citation): Standing {
  const { verdict, failure } = answersFor(claim, citation)
  if (verdict) return verdict.verdict
  if (failure) return 'unchecked'
  return (claim.named ?? []).includes(citedAs(citation)) ? 'named' : 'unchecked'
}

/** One cited work and how it answered, never a bare bibliography line (#46). */
function CitedWork({
  citation,
  verdict,
  failure,
  onlyNamed = false,
  onShow,
  footer,
  stages = [],
  pdfs,
  ownsAnalysis = false,
  sourceUpload,
}: {
  citation: Citation
  verdict?: Verdict
  failure?: Unchecked
  /** The claim only names this work as something the paper used, so it was not checked. */
  onlyNamed?: boolean
  onShow?: (target: Target) => void
  /** Shown under the verdict's reasoning: the dispute control. */
  footer?: (verdict: Verdict) => ReactNode
  stages?: Stage[]
  pdfs?: Record<string, string>
  ownsAnalysis?: boolean
  sourceUpload?: { analysisId: string; onUploaded: () => Promise<unknown> }
}) {
  return (
    <li>
      <CitationReference citation={citation} />
      {verdict && (
        <Answer
          verdict={verdict}
          onShow={onShow}
          footer={footer?.(verdict)}
          fromUpload={fromUploadedPdf(pdfs, citation)}
          ownsAnalysis={ownsAnalysis}
        />
      )}
      {failure && (
        <Failure
          failure={failure}
          action={
            sourceUpload && citation.ref ? (
              <SourcePdfUpload
                analysisId={sourceUpload.analysisId}
                citationRef={citation.ref}
                stages={stages}
                onUploaded={sourceUpload.onUploaded}
              />
            ) : null
          }
        />
      )}
      {!verdict && !failure && onlyNamed && (
        <p className="mt-1 text-xs text-ink-muted">
          Not checked — the claim only names this as something the paper used.
        </p>
      )}
      {!verdict && !failure && !onlyNamed && (
        <p className="mt-1 text-xs text-ink-muted">Not checked — verification did not run.</p>
      )}
    </li>
  )
}

export function ClaimCard({
  claim,
  index,
  standing,
  paper,
  section,
  figures = [],
  references = {},
  onShow,
  onSelect,
  actions,
  startCollapsed = false,
  defaultOpen = !startCollapsed && opensByDefault(standing),
  analysisId,
  disputes = [],
  sourceUpload,
  stages = [],
  pdfs,
  ownsAnalysis = false,
  stacked = false,
  notice,
}: {
  claim: Claim
  index: number
  standing: Standing
  paper?: string
  /** Where in the paper the claim comes from, e.g. "Section 3.3 · Representation" (#153). */
  section?: string
  /** The analysed paper's numbered figures, so "Figure 2" in its sentence can be shown. */
  figures?: PaperFigure[]
  /** Every reference the paper's markers point to, by id, to print their numbers. */
  references?: Record<string, Citation>
  onShow?: (target: Target) => void
  /** Opens the submitted-paper location when a teacher selects this claim. */
  onSelect?: () => void
  /** Role-specific controls belong in the shared expanded claim, not a parallel card. */
  actions?: ReactNode
  /** Stay a one-line row until opened, whatever the verdict (the list shown while a run is going). */
  startCollapsed?: boolean
  /** Override the initial expansion for a finished result list. */
  defaultOpen?: boolean
  /** With it, the owner can dispute a verdict; left out where nobody may (shared or teacher views). */
  analysisId?: string
  /** The owner's disputes in this analysis. */
  disputes?: Dispute[]
  /** Set when this viewer owns a finished analysis and may upload a PDF for an unchecked citation. */
  sourceUpload?: { analysisId: string; onUploaded: () => Promise<unknown> }
  /** The analysis's stages, so a re-check shows as checking until it is rechecked. */
  stages?: Stage[]
  /** Refs whose verdict was read from a PDF the owner uploaded. */
  pdfs?: Record<string, string>
  /** The viewer owns the analysis, so the upload note says "you". */
  ownsAnalysis?: boolean
  /** The page viewer takes most of the width: the two quotes go one above the other. */
  stacked?: boolean
  /** What a shortcut did on this card, shown in its header line (AnalysisView reads it out). */
  notice?: string
}) {
  const [open, setOpen] = useOpenPart(`claim ${index}`, defaultOpen)
  const [fullReason, setFullReason] = useOpenPart(`claim ${index} reason`, false)
  const [othersOpen, setOthersOpen] = useOpenPart(`claim ${index} others`, false)
  const loose = unpaired(claim)
  // The analysis-wide references too: a sentence can carry a marker its claim did not keep.
  const sentence = claim.sentence
    ? asWritten(claim.sentence, [...claim.citations, ...Object.values(references)])
    : ''
  const ownFigures = paper ? figuresNamedIn(sentence, figures) : []
  const openFigure =
    paper && onShow
      ? (figure: PaperFigure) =>
          onShow({ paper, label: `${figure.label} in this paper`, source: null, page: figure.page })
      : undefined

  // The one answer the card leads with: the verdict that decided the standing, else the first.
  const verdicts = claim.verdicts ?? []
  const primary = verdicts.find((v) => v.verdict === standing) ?? verdicts[0]
  const primaryCitation = primary ? claim.citations.find((c) => answersFor(claim, c).verdict === primary) : undefined
  const primaryPage = primary?.quote ? quotePage(primary) : undefined
  // Both quotes set one way: italic or upright by each one's length made a card of two styles.
  const longQuotes = sentence.length > LONG_QUOTE || (primary?.quote.length ?? 0) > LONG_QUOTE
  // The chip shows the worst answer only; what the other cited works said goes beside it.
  const notChecked = primary ? claim.citations.filter((citation) => !answersFor(claim, citation).verdict).length + loose.failures.length : 0
  const also = [
    verdictTally(verdicts.filter((verdict) => verdict !== primary).map((verdict) => verdict.verdict)),
    notChecked ? verdictCountLabel('unchecked', notChecked) : '',
  ].filter(Boolean).join(', ')
  const alsoText = also && <span className="shrink-0 text-xs text-ink-muted">also {also}</span>
  // Never the stored file name ("10.18653-v1-2023.acl-long.153.pdf"): it means nothing to a reader.
  const primaryName = primaryCitation ? shortRef(primaryCitation) : 'Cited paper'
  // The viewer stays open while the reader expands other claims, so it says whose quote it shows.
  const showCited = onShow && ((target: Target) => onShow({ ...target, label: `Claim ${index + 1} · ${target.label}`, claim: index }))
  const place = claim.source
  const showInPaper =
    paper && onShow && place
      ? () => onShow({ paper, label: `Claim ${index + 1} in this paper`, quote: sentence, source: place, claim: index })
      : undefined

  const toggle = () => {
    setOpen(!open)
    onSelect?.()
  }
  const disputeOf = (verdict: Verdict) =>
    analysisId ? (
      <VerdictDispute
        analysisId={analysisId}
        claimIndex={index}
        verdict={verdict}
        dispute={disputes.find((d) => d.claim === index && d.source === verdict.source)}
      />
    ) : null
  const sourceName = (verdict: Verdict) =>
    claim.citations.find((citation) => verdict.cited && citedAs(citation) === verdict.cited)?.title || 'the cited paper'
  const surface =
    // The margin keeps a card scrolled to from the viewer's label clear of the sticky toolbar.
    'scroll-mt-16 rounded-2xl border border-border-subtle bg-surface shadow-card'
  // "#17", with a fixed width: the list is sorted by verdict, so a bare number read as an order
  // with claims missing, and one- and two-digit numbers shifted the claim text.
  const number = (
    <span title={`Claim ${index + 1} in the paper's order`} className="w-8 shrink-0 font-mono text-ui leading-4.5 text-ink-muted tabular-nums">
      <span aria-hidden="true">#</span>
      {index + 1}
    </span>
  )

  // The whole row is the control: a claim whose sources backed it stays one line until a
  // reader asks for it, so twenty claims fit on a screen (#37).
  if (!open) {
    const cited = claim.citations.map(shortRef).join(' · ')
    return (
      <div data-claim-card data-claim={index} className={surface}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          data-claim-toggle
          className="flex w-full items-center gap-3.5 rounded-2xl px-5 py-3.5 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          {number}
          <span className="flex min-w-0 flex-1 flex-col gap-0.75">
            <span className="line-clamp-2 text-reading leading-6">{claim.claim}</span>
            <span className="truncate text-xs leading-4 text-ink-muted">{notice || cited || 'Nothing cited for this claim'}</span>
          </span>
          <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
          {alsoText}
          <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      </div>
    )
  }

  // Every cited work but the one the card leads with, and how each answered.
  const others = claim.citations.filter((citation) => {
    const { verdict } = answersFor(claim, citation)
    return !verdict || verdict !== primary
  })
  const looseVerdicts = loose.verdicts.filter((verdict) => verdict !== primary)
  const otherCount = others.length + looseVerdicts.length + loose.failures.length
  const otherCounts = Object.fromEntries(STANDINGS.map((kind) => [kind, 0])) as Record<Standing, number>
  for (const citation of others) otherCounts[citedStanding(claim, citation)] += 1
  for (const verdict of looseVerdicts) otherCounts[verdict.verdict] += 1
  otherCounts.unchecked += loose.failures.length
  const otherWorks = (
    <>
      <ul className="space-y-4">
        {others.map((citation, i) => (
          <CitedWork
            key={i}
            citation={citation}
            // claim.named holds lookup keys; citedAs builds the same key in the same order.
            onlyNamed={(claim.named ?? []).includes(citedAs(citation))}
            onShow={showCited}
            footer={disputeOf}
            stages={stages}
            pdfs={pdfs}
            ownsAnalysis={ownsAnalysis}
            sourceUpload={sourceUpload}
            {...answersFor(claim, citation)}
          />
        ))}
      </ul>
      {/* Anything naming no citation we hold still has to appear somewhere. Named by what it
          was looked up by, the file name as a last resort. */}
      {looseVerdicts.map((verdict, i) => (
        <div key={`loose-verdict-${i}`}>
          <p className="truncate text-sm text-ink-muted" title={verdict.cited || verdict.source}>
            {verdict.cited || verdict.source}
          </p>
          <Answer verdict={verdict} onShow={showCited} footer={disputeOf(verdict)} />
        </div>
      ))}
      {loose.failures.map((failure, i) => (
        <div key={`loose-failure-${i}`}>
          <p className="truncate text-sm text-ink-muted" title={failure.source}>
            {failure.source}
          </p>
          <Failure failure={failure} />
        </div>
      ))}
    </>
  )

  const meta = [
    section ? section.replace(/^Section\s+/, '§').replace(' · ', ' ') : '',
    claim.source ? `page ${claim.source.page}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <SourceName.Provider value={sourceName}>
    <CardKey.Provider value={`claim ${index}`}>
    <div data-claim-card data-claim={index} className={cn(surface, 'flex flex-col gap-4.5 p-5')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded
        data-claim-toggle
        className="flex w-full items-center gap-2.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {number}
        {/* The badge sits before the chevron, where the folded row has it. */}
        {/* Every open card has this line; a claim whose sentence was not found in the PDF has no section or page. */}
        <span title={notice} className="min-w-0 flex-1 truncate text-xs leading-4 text-ink-muted">{notice || meta || 'Not found in the paper’s pages'}</span>
        <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
        {alsoText}
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      {!sameWords(claim.claim, claim.sentence) && (
        <p className="text-[17px] leading-6 font-medium tracking-[-0.01em]">{claim.claim}</p>
      )}

      {(claim.sentence || primary) && (
        // Beside the page viewer, side by side would wrap each quote into a narrow column.
        <div className={cn('grid gap-3', claim.sentence && primary?.quote && !stacked && 'md:grid-cols-2')}>
          {/* The paper's own words are evidence; the paraphrase above them is not (#46). */}
          {claim.sentence && (
            <EvidencePanel
              label={`This paper${claim.source ? ` · page ${claim.source.page}` : ''}`}
              action={showInPaper ? 'Show in paper' : undefined}
              onAction={showInPaper}
              // With no cited quote to show, O shows the claim's own place in the paper.
              shortcut={primary?.quote ? undefined : 'O'}
              inPaper={primary ? `The deciding work (${primaryName}) has no matched passage` : 'No cited work quotes this claim'}
              long={longQuotes}
            >
              “{withFigureLinks(sentence, ownFigures, openFigure)}”
            </EvidencePanel>
          )}
          {primary?.quote && (
            <EvidencePanel
              bar={VERDICT_BAR[primary.verdict]}
              label={`${primaryName}${primaryPage ? ` · page ${primaryPage}` : ''}`}
              action={showCited ? 'Show in cited paper' : undefined}
              shortcut="O"
              long={longQuotes}
              onAction={showCited && (() =>
                showInCitedPaper(primary, showCited, `Deciding quote in ${primaryName}`, primary.quote, primaryPage)
              )}
            >
              “{primary.quote}”
            </EvidencePanel>
          )}
          {primary && !primary.quote && (
            <EvidencePanel bar={VERDICT_BAR[primary.verdict]} label={primaryName}>
              <span className="not-italic text-ink-muted">
                No exact passage matched. The judge's reading of the paper is below.
              </span>
            </EvidencePanel>
          )}
        </div>
      )}

      {paper && ownFigures.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {ownFigures.map((figure) => (
            <figure key={figure.image} className="max-w-56 space-y-1">
              <button
                type="button"
                onClick={() => openFigure?.(figure)}
                disabled={!openFigure}
                className="block rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
              >
                <AuthorizedImage
                  src={figureImageUrl(paper, figure.image)}
                  alt={figure.caption}
                  loading="lazy"
                  className="max-h-40 rounded-lg border border-border-subtle bg-surface object-contain"
                />
              </button>
              <Caption text={figure.caption} />
            </figure>
          ))}
        </div>
      )}

      {primary && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-accent">
            <Sparkles className="size-4" aria-hidden="true" />
            <p className="type-label">
              {WHY_LABELS[primary.verdict]}
              {primaryName && <span className="text-ink-muted"> · {primaryName}</span>}
            </p>
          </div>
          {primaryCitation && <CitationReference citation={primaryCitation} />}
          <p className={cn('max-w-prose text-reading leading-6 text-ink-muted', primary.reasoning.length > LONG_REASON && !fullReason && 'line-clamp-3')}>
            {primary.reasoning}
          </p>
          {primary.reasoning.length > LONG_REASON && (
            <MoreToggle open={fullReason} onToggle={() => setFullReason(!fullReason)}>
              {fullReason ? 'Hide the full reasoning' : 'Read the full reasoning'}
            </MoreToggle>
          )}
          {fromUploadedPdf(pdfs, primaryCitation) && <UploadedNote owns={ownsAnalysis} />}
          {disputeOf(primary)}
        </div>
      )}

      {primary && <MoreEvidence verdict={primary} onShow={showCited} />}

      {otherCount > 0 && primary && (
        // Folded to one line of counts: a claim citing six works ran three screens long.
        <details open={othersOpen} onToggle={(event) => setOthersOpen(event.currentTarget.open)}>
          <summary className={cn(DISCLOSURE_SUMMARY, 'flex-wrap text-ui')}>
            {othersOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            {otherCount} other cited {otherCount === 1 ? 'work' : 'works'}
            <StandingCounts counts={otherCounts} />
          </summary>
          <div className="mt-2 space-y-4">{otherWorks}</div>
        </details>
      )}
      {otherCount > 0 && !primary && (
        <div className="space-y-4">
          <h3 className="type-label text-ink-muted">Cited works</h3>
          {otherWorks}
        </div>
      )}

      {claim.citations.length === 0 && (
        <p className="text-sm text-ink-muted">
          The sentence this claim came from cites nothing, so there is no source to check it
          against.
        </p>
      )}
      {actions}
    </div>
    </CardKey.Provider>
    </SourceName.Provider>
  )
}
