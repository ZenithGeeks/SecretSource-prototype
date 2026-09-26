/** One claim, answered: whether it held, what the paper said, and what each source replied. */

import { ChevronDown } from 'lucide-react'
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
import { Card, StandingBadge, VerdictBadge } from './ui'

/** The verdict colour, carried onto the left edge of the answer block that holds it — not
 * just the badge — so a reader can tell supports/refutes/insufficient apart while
 * scrolling past a closed card, the way a claim's own quote already gets a rule (#22). */
const VERDICT_BORDER = {
  supports: 'border-supports',
  refutes: 'border-refutes',
  insufficient: 'border-insufficient',
} as const

/** The verdict as a statement about the claim. A bare "refutes" does not say who refutes whom. */
const VERDICT_TEXT = {
  supports: 'backs the claim',
  refutes: 'contradicts the claim',
  insufficient: 'not enough evidence',
} as const

/** A small heading that says where the text under it comes from. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-4 font-semibold tracking-wide text-ink-muted uppercase">
      {children}
    </p>
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
    <div className="mt-2 rounded-lg border border-dashed border-border-subtle p-3">
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

/** What a source answered: the deciding quote first, then the working behind it. */
function Answer({ verdict, onShow }: { verdict: Verdict; onShow?: (target: Target) => void }) {
  const [showEvidence, setShowEvidence] = useState(false)

  /** Look the text up in the cited paper, then show it — located or not. */
  async function showInCitedPaper(label: string, quote: string, page?: number) {
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

  const hasAside = (verdict.pages && verdict.pages.length > 0) || verdict.evidence.length > 0
  const page = verdict.quote ? quotePage(verdict) : undefined

  return (
    // The left rule repeats the badge's verdict colour on the block that holds the
    // evidence for it, so a reader scrolling past a closed card still sees which sources
    // contradicted a claim without opening one (#22).
    <div className={cn('mt-2 rounded-lg border-l-[3px] bg-canvas p-3', VERDICT_BORDER[verdict.verdict])}>
      <VerdictBadge verdict={verdict.verdict} text={VERDICT_TEXT[verdict.verdict]} />

      {verdict.quote && (
        <div className="mt-2 border-l-2 border-accent pl-3">
          <Label>What the cited paper says{page ? ` · page ${page}` : ''}</Label>
          <blockquote className="text-sm italic">
            “{verdict.quote}”
            {onShow && (
              <button
                onClick={() =>
                  showInCitedPaper(`Deciding quote in ${verdict.source}`, verdict.quote, page)
                }
                className="ml-2 rounded text-xs font-medium text-accent not-italic hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                show in the cited paper
              </button>
            )}
          </blockquote>
        </div>
      )}

      {/* Full ink, not muted, and labelled: this is the model's reasoning, not text from
          either paper (#22). */}
      <div className="mt-2">
        <Label>AI explanation</Label>
        <p className="text-sm text-ink">{verdict.reasoning}</p>
      </div>

      {hasAside && (
        <div className="mt-2 space-y-2 rounded-lg bg-accent-soft p-3">
          {verdict.pages && verdict.pages.length > 0 && (
            <p className="text-sm text-ink-muted">
              Also look at{' '}
              {verdict.pages.map((hit, k) => (
                <span key={k}>
                  {k > 0 && ' and '}
                  {onShow ? (
                    <PageLink
                      page={hit.page}
                      onClick={() =>
                        onShow({
                          paper: verdict.source,
                          label: `${hitName(hit)} of ${verdict.source}`,
                          source: null, // the crop itself is rendered by #36; this opens its page
                          page: hit.page,
                          verdict: verdict.verdict,
                        })
                      }
                    >
                      {hitName(hit)}
                    </PageLink>
                  ) : (
                    hitName(hit)
                  )}
                </span>
              ))}{' '}
              in the cited paper. Found by searching page images
              {verdict.page_model ? ` with ${modelName(verdict.page_model)}` : ''}.
            </p>
          )}

          {/* The crops themselves. Naming a figure and making the reader open a page to see
              it is most of the work of looking it up; the point of matching one is that it
              can be shown. Pages have no crop, so only figures get a thumbnail. */}
          {verdict.pages && verdict.pages.some((hit) => hit.kind === 'figure' && hit.image) && (
            <div className="flex flex-wrap gap-3">
              {verdict.pages
                .filter((hit) => hit.kind === 'figure' && hit.image)
                .map((hit, k) => (
                  <figure key={k} className="max-w-56 space-y-1">
                    <AuthorizedImage
                      src={figureImageUrl(verdict.source, hit.image as string)}
                      alt={hit.caption || `${hitName(hit)} of ${verdict.source}`}
                      loading="lazy"
                      className="max-h-40 rounded border border-border-subtle bg-surface object-contain"
                    />
                    <figcaption className="text-xs text-ink-muted">
                      {/* Docling's caption usually already opens with "Figure 3:", so
                          prefixing the label again reads as a stutter. */}
                      {captionOf(hit)}
                    </figcaption>
                  </figure>
                ))}
            </div>
          )}

          {verdict.evidence.length > 0 && (
            <button
              onClick={() => setShowEvidence(!showEvidence)}
              aria-expanded={showEvidence}
              className="rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {showEvidence
                ? 'Hide the passages from the cited paper'
                : `Show ${verdict.evidence.length} more passages from the cited paper`}
            </button>
          )}
        </div>
      )}

      {showEvidence && verdict.evidence.length > 0 && (
        <ul className="mt-2 space-y-2 text-xs text-ink-muted">
          {verdict.evidence.map((passage, j) => (
            <li key={j} className="rounded border border-border-subtle p-2">
              <span className="mr-2 inline-block">
                {onShow ? (
                  <PageLink
                    page={passage.page}
                    onClick={() => showInCitedPaper(`Passage in ${verdict.source}`, passage.text, passage.page)}
                  />
                ) : (
                  <span className="rounded bg-surface px-1.5 py-0.5 font-medium tabular-nums">
                    p. {passage.page}
                  </span>
                )}
              </span>
              {passage.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One cited work and how it answered — never a bare bibliography line (#46). */
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
    <li className="border-l-2 border-border-subtle pl-4">
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
}) {
  const [open, setOpen] = useState(opensByDefault(standing))
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

  return (
    <Card className="p-0">
      {/* The whole header is the control: a claim whose sources backed it stays one line
          until a reader asks for it, so twenty claims fit on a screen (#37). */}
      <button
        onClick={() => {
          setOpen(!open)
          onSelect?.()
        }}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-xl p-5 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <span className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
        <span className="flex-1 space-y-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
            {section && <span className="text-xs text-ink-muted">{section}</span>}
          </span>
          <span className={cn('block max-w-[68ch] leading-relaxed', !open && 'line-clamp-2')}>
            {claim.claim}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'mt-1 size-4 shrink-0 text-ink-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-4 px-5 pb-5">
          {/* The paper's own words are evidence; the paraphrase above them is not, so the
              two do not look alike (#46). */}
          {claim.sentence && (
            <div className="border-l-2 border-border-subtle pl-4">
              <Label>In this paper</Label>
              <blockquote className="text-sm italic text-ink-muted">
                “{withFigureLinks(sentence, ownFigures, openFigure)}”
                {claim.source && (
                  <span className="ml-2 not-italic">
                    {paper && onShow ? (
                      <PageLink
                        page={claim.source.page}
                        onClick={() =>
                          onShow({
                            paper,
                            label: `Claim ${index + 1} in this paper`,
                            quote: sentence,
                            source: claim.source ?? null,
                          })
                        }
                      >
                        page {claim.source.page}
                      </PageLink>
                    ) : (
                      <span className="text-xs">page {claim.source.page}</span>
                    )}
                  </span>
                )}
              </blockquote>
              {paper && ownFigures.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {ownFigures.map((figure) => (
                    <figure key={figure.image} className="max-w-56 space-y-1">
                      <button
                        onClick={() => openFigure?.(figure)}
                        disabled={!openFigure}
                        className="block rounded focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <AuthorizedImage
                          src={figureImageUrl(paper, figure.image)}
                          alt={figure.caption}
                          loading="lazy"
                          className="max-h-40 rounded border border-border-subtle bg-surface object-contain"
                        />
                      </button>
                      <figcaption className="line-clamp-3 text-xs text-ink-muted" title={figure.caption}>
                        {figure.caption}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

          {claim.citations.length > 0 && (
            <ul className="space-y-4">
              {claim.citations.map((citation, i) => (
                <CitedWork
                  key={i}
                  citation={citation}
                  onShow={onShow}
                  {...answersFor(claim, citation)}
                />
              ))}
            </ul>
          )}

          {/* Anything naming no citation we hold still has to appear somewhere. */}
          {/* No reference line here, so the file name is the only way to name the source. */}
          {loose.verdicts.map((verdict, i) => (
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
      )}
    </Card>
  )
}
