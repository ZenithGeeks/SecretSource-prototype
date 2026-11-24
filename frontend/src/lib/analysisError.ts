/**
 * What a failed analysis tells its reader.
 *
 * The gateway stores the exception text as the analysis's message, e.g. a provider's
 * RateLimitError with its model name and deployment id. That means nothing to a researcher, so
 * the screen leads with a plain sentence and keeps the raw text behind "Technical details".
 */

const PLAIN: { match: RegExp; text: string; retry: boolean; advice?: string }[] = [
  { match: /^Stopped before it finished\.$/, text: 'You stopped this analysis before it finished.', retry: true },
  {
    match: /rate.?limit|\b429\b|quota|too many requests/i,
    text: 'The checking service was busy, so the analysis stopped.',
    retry: true,
    advice: 'Try again in a few minutes.',
  },
  { match: /timed? ?out|timeout/i, text: 'A step took too long, so the analysis stopped.', retry: true },
  {
    match: /interrupted by a restart|worker stopped/i,
    text: 'The server restarted while this analysis was running.',
    retry: true,
  },
]

/** `advice` is when to retry, shown only where a retry can help. */
export type AnalysisFailure = { text: string; retry: boolean; advice: string; details: string }

/** The plain sentence for a failure message, and whether running it again may help. */
export function analysisFailure(message: string | undefined): AnalysisFailure {
  const details = message?.trim() ?? ''
  const known = PLAIN.find(({ match }) => match.test(details))
  if (known) return { text: known.text, retry: known.retry, advice: known.advice ?? '', details }
  return { text: 'The analysis stopped before it finished, and we don’t know why.', retry: true, advice: '', details }
}
