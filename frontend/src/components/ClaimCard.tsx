/** One claim, answered: whether it held, what the paper said, and what each source replied. */

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import type { Citation, Claim, Unchecked, Verdict } from '../lib/api'
import { api, reasonText } from '../lib/api'
import { answersFor, opensByDefault, STANDING_MEANINGS, unpaired } from '../lib/claims'
import type { Standing } from '../lib/claims'
import { cn } from '../lib/utils'
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

/** "vidore/colqwen2-v1.0" -> "ColQwen2 v1.0": the reader wants the model, not the repo path. */
function modelName(checkpoint: string) {
  const name = checkpoint.split('/').pop() ?? checkpoint
  return name.replace(/^col/i, 'Col').replace(/-v/, ' v')
}

/** What the paper calls a visual hit: "Figure 3" where it has a name, "page 7" otherwise. */
function hitName(hit: { page: number; label?: string }) {
  return hit.label && hit.label.trim() ? hit.label : `page ${hit.page}`
}

function reference({ authors, year, title, arxiv }: Citation) {
  const who = authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : 'Unknown'
  return `${who}${year ? ` (${year})` : ''}. ${title || (arxiv ? `arXiv:${arxiv}` : 'Untitled')}`
}

/**
 * The paper's sentence as the paper wrote it.
 *
 * The gateway renders each citation as a "[b13]" marker so a claim can be traced back to the
 * works it cites. That is machinery, and it belongs nowhere near a reader.
 */
function asWritten(sentence: string) {
  return sentence.replace(/\s*\[b\d+\]/g, '').trim()
}

/** Where this work lives, preferring the identifier that resolves exactly. */
function citationLink({ doi, arxiv, url }: Citation) {
  if (doi) return `https://doi.org/${doi}`
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`
  return url || ''
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
    })
  }

  const hasAside = (verdict.pages && verdict.pages.length > 0) || verdict.evidence.length > 0

  return (
    // The left rule repeats the badge's verdict colour on the block that holds the
    // evidence for it, so a reader scrolling past a closed card still sees which sources
    // contradicted a claim without opening one (#22).
    <div className={cn('mt-2 rounded-lg border-l-[3px] bg-canvas p-3', VERDICT_BORDER[verdict.verdict])}>
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={verdict.verdict} />
        <span className="text-xs text-ink-muted">read from {verdict.source}</span>
      </div>

      {verdict.quote && (
        <blockquote className="mt-2 border-l-2 border-accent pl-3 text-sm italic">
          “{verdict.quote}”
          {onShow && (
            <button
              onClick={() => showInCitedPaper(`Deciding quote in ${verdict.source}`, verdict.quote)}
              className="ml-2 rounded text-xs font-medium text-accent not-italic hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              show in the paper
            </button>
          )}
        </blockquote>
      )}

      {/* Full ink, not muted: the paper's own words above are a quote and read as one;
          this is the model's working, and it has to look like a different kind of text,
          not a continuation of the same paragraph (#22). */}
      <p className="mt-2 text-sm text-ink">{verdict.reasoning}</p>

      {hasAside && (
        <div className="mt-2 space-y-2 rounded-lg bg-accent-soft p-3">
          {verdict.pages && verdict.pages.length > 0 && (
            <p className="text-sm text-ink-muted">
              Also worth reading by eye:{' '}
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
              — matched by what the paper shows rather than what it says.
              {verdict.page_model && (
                <span className="text-ink-muted"> Matched by {modelName(verdict.page_model)}.</span>
              )}
            </p>
          )}

          {verdict.evidence.length > 0 && (
            <button
              onClick={() => setShowEvidence(!showEvidence)}
              aria-expanded={showEvidence}
              className="rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {showEvidence ? 'Hide' : 'Show'} {verdict.evidence.length} retrieved passages
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
  onShow,
}: {
  claim: Claim
  index: number
  standing: Standing
  paper?: string
  onShow?: (target: Target) => void
}) {
  const [open, setOpen] = useState(opensByDefault(standing))
  const loose = unpaired(claim)

  return (
    <Card className="p-0">
      {/* The whole header is the control: a claim whose sources backed it stays one line
          until a reader asks for it, so twenty claims fit on a screen (#37). */}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-xl p-5 text-left hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <span className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
        <span className="flex-1 space-y-2">
          <StandingBadge standing={standing} title={STANDING_MEANINGS[standing]} />
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
            <blockquote className="border-l-2 border-border-subtle pl-4 text-sm italic text-ink-muted">
              “{asWritten(claim.sentence)}”
              {claim.source && (
                <span className="ml-2 not-italic">
                  {paper && onShow ? (
                    <PageLink
                      page={claim.source.page}
                      onClick={() =>
                        onShow({
                          paper,
                          label: `Claim ${index + 1} in this paper`,
                          quote: claim.sentence,
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
          {loose.verdicts.map((verdict, i) => (
            <Answer key={`loose-verdict-${i}`} verdict={verdict} onShow={onShow} />
          ))}
          {loose.failures.map((failure, i) => (
            <div key={`loose-failure-${i}`}>
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
        </div>
      )}
    </Card>
  )
}
