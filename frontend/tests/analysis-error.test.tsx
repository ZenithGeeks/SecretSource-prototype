import { describe, expect, it } from 'vitest'

import { analysisFailure } from '../src/lib/analysisError'

describe('analysisFailure', () => {
  it('turns a provider rate limit into a plain sentence and keeps the raw text', () => {
    const raw = 'litellm.RateLimitError: RateLimitError: OpenAIException - 429 for model x'
    expect(analysisFailure(raw)).toEqual({
      text: 'The checking service was busy, so the analysis stopped.',
      advice: 'Try again in a few minutes.',
      retry: true,
      details: raw,
    })
  })

  it('names a stop the owner asked for', () => {
    expect(analysisFailure('Stopped before it finished.').text).toBe('You stopped this analysis before it finished.')
  })

  it('names a restart', () => {
    expect(analysisFailure('interrupted by a restart').text).toBe('The server restarted while this analysis was running.')
  })

  it('falls back to a general sentence for text it does not know', () => {
    expect(analysisFailure('KeyError: claims')).toEqual({
      text: 'The analysis stopped before it finished, and we don’t know why.',
      advice: '',
      retry: true,
      details: 'KeyError: claims',
    })
    expect(analysisFailure(undefined).details).toBe('')
  })
})
