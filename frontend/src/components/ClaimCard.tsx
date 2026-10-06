/** One claim, answered: whether it held, what the paper said, and what each source replied. */

import { ChevronDown, ChevronRight, FileText, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import type { Citation, Claim, PaperFigure, Unchecked, Verdict } from '../lib/api'
import { api, figureImageUrl, reasonText } from '../lib/api'
import { citationLink, citationNumber, reference } from '../lib/citations'
import { answersFor, opensByDefault, STANDING_MEANINGS, unpaired } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { cn } from '../lib/utils'
import { AuthorizedImage } from './AuthorizedImage'
import type { Target } from './PageViewer'
import { StandingBadge, VerdictBadge } from './ui'

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

/** "vidore/colqwen2-v1.0" -> "ColQwen2 v1.0": the reader wants the model, not the repo path. */
function modelName(checkpoint: string) {
  const name = checkpoint.split('/').pop() ?? checkpoint
  return name.replace(/^col/i, 'Col').replace(/-v/, ' v')
}

/** What the paper calls a visual hit: "Figure 3" where it has a name, "page 7" otherwise. */
/** What to write under a crop: the caption when it already names the figure, the label
 * with the caption after it when it does not, the label alone when there is no caption. */
function captionOf(hit: NonNullable<Verdict['pages']>[number]) {
  const label = hitName(hit)
  const caption = (hit.caption ?? '').trim()
  if (!caption) return label
  return caption.toLowerCase().startsWith(label.toLowerCase()) ? caption : `${label}: ${caption}`
}

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
        className="rounded text-accent underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-accent"
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
    <button
      onClick={onClick}
      className="rounded bg-canvas px-1.5 py-0.5 font-medium tabular-nums text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children ?? `p. ${page}`}
    </button>
  )
}

/** A source we could not read, in the reader's terms and then in the operator's. */
function Failure({ failure }: { failure: Unchecked }) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-border-subtle p-3">
      <p className="text-sm">
        <span className="font-medium">Not checked</span>
        <span className="text-ink-muted"> — {reasonText(failure.reason)}</span>
      </p>
      {/* The specific message is what says the lookup was rate limited rather than empty. */}
      {failure.message && (
        <p className="mt-1 text-xs text-ink-muted/80" title={failure.message}>
          {failure.message}
        </p>
      )}
    </div>
  )
}

/** "Ioffe et al. 2015": a cited work in the few words a row or a panel label has room for. */
function shortRef(citation: Citation) {
  const who = citation.authors[0]
    ? `${citation.authors[0]}${citation.authors.length > 1 ? ' et al.' : ''}`
    : citation.title || (citation.arxiv ? `arXiv:${citation.arxiv}` : 'Untitled')
  return citation.year ? `${who} ${citation.year}` : who
}

/** Look the text up in the cited paper, then show it, located or not. */
async function showInCitedPaper(
  verdict: Verdict,
  onShow: ((target: Target) => void) | undefined,
  label: string,
  quote: string,
  page?: number,
) {
  if (!onShow) return
  const found = await api.findInPaper(verdict.source, quote, page).catch(() => null)
  onShow({
    paper: verdict.source,
    label,
    quote,
    source: found && found.page ? (found as Target['source']) : null,
    page,
    verdict: verdict.verdict,
  })
}

/** A quote and where it sits: the paper's own sentence, or what a cited work says (Figma "side-by-side"). */
function EvidencePanel({
  bar,
  label,
  action,
  onAction,
  children,
}: {
  bar: string
  label: string
  action?: string
  onAction?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl bg-neutral-soft px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('h-3 w-[3px] shrink-0 rounded-sm', bar)} />
        <p className="type-label truncate text-ink-muted">{label}</p>
      </div>
      <blockquote className="font-serif text-base leading-[25px] italic">{children}</blockquote>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-auto inline-flex items-center gap-1 self-start rounded text-[13px] leading-[18px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {action}
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** The retrieved passages behind a verdict, each with the page it came from. */
function Passages({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  return (
    <ul className="space-y-2 text-xs text-ink-muted">
      {verdict.evidence.map((passage, j) => (
        <li key={j} className="rounded-lg border border-border-subtle p-2">
          <span className="mr-2 inline-block">
            {onShow ? (
              <PageLink
                page={passage.page}
                onClick={() => showInCitedPaper(verdict, onShow, `Passage in ${verdict.source}`, passage.text, passage.page)}
              />
            ) : (
              <span className="rounded bg-neutral-soft px-1.5 py-0.5 font-medium tabular-nums">p. {passage.page}</span>
            )}
          </span>
          {passage.text}
        </li>
      ))}
    </ul>
  )
}

/** The crops of figures the cited work was matched on: naming a figure and making the reader
 * open a page to see it is most of the work of looking it up. Pages have no crop. */
function FigureCrops({ verdict }: { verdict: Verdict }) {
  const hits = (verdict.pages ?? []).filter((hit) => hit.kind === 'figure' && hit.image)
  if (!hits.length) return null
  return (
    <div className="flex flex-wrap gap-3">
      {hits.map((hit, k) => (
        <figure key={k} className="max-w-56 space-y-1">
          <AuthorizedImage
            src={figureImageUrl(verdict.source, hit.image as string)}
            alt={hit.caption || `${hitName(hit)} of ${verdict.source}`}
            loading="lazy"
            className="max-h-40 rounded-lg border border-border-subtle bg-surface object-contain"
          />
          <figcaption className="text-xs text-ink-muted">
            {/* Docling's caption usually already opens with "Figure 3:", so prefixing the
                label again reads as a stutter. */}
            {captionOf(hit)}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

/** The pages of the cited work the match was found on, as chips that open them. */
function PageChips({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const title = verdict.page_model ? `Found by searching page images with ${modelName(verdict.page_model)}` : undefined
  return (
    <>
      {(verdict.pages ?? []).map((hit, k) => {
        const text = `${hitName(hit).replace(/^./, (c) => c.toUpperCase())} in the cited paper`
        const chip = 'inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-[5px] text-xs leading-4 font-medium text-accent'
        return onShow ? (
          <button
            key={k}
            type="button"
            title={title}
            onClick={() =>
              onShow({
                paper: verdict.source,
                label: `${hitName(hit)} of ${verdict.source}`,
                source: null, // the crop itself is rendered by #36; this opens its page
                page: hit.page,
                verdict: verdict.verdict,
              })
            }
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

/** What a source answered, for a cited work that is not the claim's main evidence: the deciding
 * quote first, then the working behind it. */
function Answer({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const [showEvidence, setShowEvidence] = useState(false)
  const page = verdict.quote ? quotePage(verdict) : undefined

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-neutral-soft p-3.5">
      <VerdictBadge verdict={verdict.verdict} />

      {verdict.quote && (
        <EvidencePanel
          bar={VERDICT_BAR[verdict.verdict]}
          label={`What the cited paper says${page ? ` · page ${page}` : ''}`}
          action={onShow ? 'Show in cited paper' : undefined}
          onAction={() => showInCitedPaper(verdict, onShow, `Deciding quote in ${verdict.source}`, verdict.quote, page)}
        >
          “{verdict.quote}”
        </EvidencePanel>
      )}

      <div className="space-y-1.5">
        <Label>{WHY_LABELS[verdict.verdict]}</Label>
        <p className="text-sm text-ink-muted">{verdict.reasoning}</p>
      </div>

      <FigureCrops verdict={verdict} />
      <div className="flex flex-wrap items-center gap-2">
        <PageChips verdict={verdict} onShow={onShow} />
        {verdict.evidence.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEvidence(!showEvidence)}
            aria-expanded={showEvidence}
            className="rounded text-[13px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {showEvidence ? 'Hide passages' : `${verdict.evidence.length} more passages`}
          </button>
        )}
      </div>
      {showEvidence && verdict.evidence.length > 0 && <Passages verdict={verdict} onShow={onShow} />}
    </div>
  )
}

/** One cited work and how it answered, never a bare bibliography line (#46). */
function CitedWork({
  citation,
  verdict,
  failure,
  onShow,
}: {
  citation: Citation
  verdict?: Verdict
  failure?: Unchecked
  onShow?: (target: Target) => void
}) {
  const link = citationLink(citation)
  return (
    <li>
      <Label>Cited paper</Label>
      <p className="text-sm text-ink-muted">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-border-subtle underline-offset-2 hover:text-accent"
          >
            {reference(citation)}
          </a>
        ) : (
          reference(citation)
        )}
        {/* The number the PDF prints for this work, to find it in the paper's reference list. */}
        {citationNumber(citation) && (
          <span className="ml-1.5 font-medium text-ink tabular-nums">[{citationNumber(citation)}]</span>
        )}
      </p>
      {verdict && <Answer verdict={verdict} onShow={onShow} />}
      {failure && <Failure failure={failure} />}
      {!verdict && !failure && (
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
}) {
  const [open, setOpen] = useState(!startCollapsed && opensByDefault(standing))
  const [showEvidence, setShowEvidence] = useState(false)
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
  const primaryName = primaryCitation ? shortRef(primaryCitation) : primary?.source

  const toggle = () => {
    setOpen(!open)
    onSelect?.()
  }
  const surface =
    'rounded-2xl border border-border-subtle bg-surface shadow-[0_8px_12px_rgba(31,20,36,0.05),0_1px_1px_rgba(31,20,36,0.04)]'
  const number = (
    <span className="shrink-0 font-mono text-[13px] leading-[18px] text-ink-muted tabular-nums">{index + 1}</span>
  )

  // The whole row is the control: a claim whose sources backed it stays one line until a
  // reader asks for it, so twenty claims fit on a screen (#37).
  if (!open) {
    const cited = claim.citations.map(shortRef).join(' · ')
    return (
      <div className={surface}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          className="flex w-full items-center gap-3.5 rounded-2xl px-5 py-3.5 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          {number}
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="line-clamp-2 text-[15px] leading-6">{claim.claim}</span>
            <span className="truncate text-xs leading-4 text-ink-muted">{cited || 'Nothing cited for this claim'}</span>
          </span>
          <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
          <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const meta = [
    section ? section.replace(/^Section\s+/, '§').replace(' · ', ' ') : '',
    claim.source ? `page ${claim.source.page}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className={cn(surface, 'flex flex-col gap-[18px] pt-5 pr-[22px] pb-[22px] pl-[22px]')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded
        className="flex w-full items-center gap-2.5 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        {number}
        <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
        <span className="min-w-0 flex-1 truncate text-xs leading-4 text-ink-muted">{meta}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      <p className="text-[17px] leading-6 font-medium tracking-[-0.006em]">{claim.claim}</p>

      {(claim.sentence || primary?.quote) && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* The paper's own words are evidence; the paraphrase above them is not (#46). */}
          {claim.sentence && (
            <EvidencePanel
              bar="bg-accent"
              label={`This paper${claim.source ? ` · page ${claim.source.page}` : ''}`}
              action={paper && onShow && claim.source ? 'Show in paper' : undefined}
              onAction={() =>
                paper &&
                onShow?.({
                  paper,
                  label: `Claim ${index + 1} in this paper`,
                  quote: sentence,
                  source: claim.source ?? null,
                })
              }
            >
              “{withFigureLinks(sentence, ownFigures, openFigure)}”
            </EvidencePanel>
          )}
          {primary?.quote && (
            <EvidencePanel
              bar={VERDICT_BAR[primary.verdict]}
              label={`${primaryName}${primaryPage ? ` · page ${primaryPage}` : ''}`}
              action={onShow ? 'Show in cited paper' : undefined}
              onAction={() =>
                showInCitedPaper(primary, onShow, `Deciding quote in ${primary.source}`, primary.quote, primaryPage)
              }
            >
              “{primary.quote}”
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
                className="block rounded focus-visible:outline-2 focus-visible:outline-accent"
              >
                <AuthorizedImage
                  src={figureImageUrl(paper, figure.image)}
                  alt={figure.caption}
                  loading="lazy"
                  className="max-h-40 rounded-lg border border-border-subtle bg-surface object-contain"
                />
              </button>
              <figcaption className="line-clamp-3 text-xs text-ink-muted" title={figure.caption}>
                {figure.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {primary && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-accent">
            <Sparkles className="size-4" aria-hidden="true" />
            <p className="type-label">{WHY_LABELS[primary.verdict]}</p>
          </div>
          <p className="text-[15px] leading-6 text-ink-muted">{primary.reasoning}</p>
        </div>
      )}

      {primary && (primary.pages?.length || primary.evidence.length > 0) ? (
        <div className="flex flex-wrap items-center gap-2">
          <PageChips verdict={primary} onShow={onShow} />
          {primary.evidence.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEvidence(!showEvidence)}
              aria-expanded={showEvidence}
              className="rounded text-[13px] leading-[18px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {showEvidence ? 'Hide passages' : `${primary.evidence.length} more passages`}
            </button>
          )}
        </div>
      ) : null}
      {primary && <FigureCrops verdict={primary} />}
      {primary && showEvidence && primary.evidence.length > 0 && <Passages verdict={primary} onShow={onShow} />}

      {claim.citations.length > 0 && (
        <ul className="space-y-4">
          {claim.citations.map((citation, i) => {
            const answers = answersFor(claim, citation)
            // The card already leads with this one's quote, explanation and pages.
            if (answers.verdict && answers.verdict === primary) return null
            return <CitedWork key={i} citation={citation} onShow={onShow} {...answers} />
          })}
        </ul>
      )}

      {/* Anything naming no citation we hold still has to appear somewhere. */}
      {/* No reference line here, so the file name is the only way to name the source. */}
      {loose.verdicts.filter((verdict) => verdict !== primary).map((verdict, i) => (
        <div key={`loose-verdict-${i}`}>
          <Label>Cited paper</Label>
          <p className="truncate text-sm text-ink-muted" title={verdict.source}>
            {verdict.source}
          </p>
          <Answer verdict={verdict} onShow={onShow} />
        </div>
      ))}
      {loose.failures.map((failure, i) => (
        <div key={`loose-failure-${i}`}>
          <Label>Cited paper</Label>
          <p className="truncate text-sm text-ink-muted" title={failure.source}>
            {failure.source}
          </p>
          <Failure failure={failure} />
        </div>
      ))}

      {claim.citations.length === 0 && (
        <p className="text-sm text-ink-muted">
          The sentence this claim came from cites nothing, so there is no source to check it
          against.
        </p>
      )}
      {actions}
    </div>
  )
}
