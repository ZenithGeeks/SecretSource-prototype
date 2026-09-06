import type { Draft, DraftWord } from '../types'

function w(text: string): DraftWord {
  return { text }
}

function m(text: string, mark: DraftWord['mark']): DraftWord {
  return { text, mark }
}

/** Draft as first checked: the ColBERT (2020) citation is marked wrong. */
export const mockDraftInitial: Draft = {
  id: 'd1',
  fileName: 'draft-v3.docx',
  heading: '2. Related work',
  citationsFound: 5,
  issuesRemaining: 2,
  lastCheckedLabel: 'checked 2h ago',
  paragraphs: [
    [
      w('Late'), w('interaction'), w('retrievers'), w('encode'), w('queries'), w('and'), w('documents'),
      w('into'), w('token-level'), w('vectors'), w('and'), w('score'), w('them'), w('with'), w('MaxSim'),
      m('[Khattab', 'supports'), m('&', 'supports'), m('Zaharia,', 'supports'), m('2020].', 'supports'),
      w('ColBERTv2'), w('further'),
      m('reduces', 'refutes'), m('index', 'refutes'), m('size', 'refutes'), m('by', 'refutes'),
      m('6–10×', 'refutes'), m('while', 'refutes'), m('matching', 'refutes'), m('retrieval', 'refutes'),
      m('quality', 'refutes'), m('[Khattab', 'refutes'), m('&', 'refutes'), m('Zaharia,', 'refutes'),
      m('2020].', 'refutes'),
      w('On'), w('out-of-domain'), w('data'), w('these'), w('models'),
      m('outperform', 'insufficient'), m('single-vector', 'insufficient'), m('retrievers', 'insufficient'),
      m('on', 'insufficient'), m('BEIR', 'insufficient'), m('[Thakur', 'insufficient'), m('et', 'insufficient'),
      m('al.,', 'insufficient'), m('2021].', 'insufficient'),
    ],
    [
      w('Denoised'), w('supervision'), w('from'), w('a'), w('cross-encoder'), w('teacher'), w('improves'),
      w('learned'), w('representations'),
      m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
      w('MS'), w('MARCO'), w('contains'), w('8.8M'), w('passages'),
      m('[Nguyen', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2016].', 'supports'),
    ],
  ],
}

/**
 * Draft after the ColBERT (2020) citation was replaced with Santhanam et al. (2022).
 * The "[Santhanam al., al., 2022]" repetition below is a typo baked into the source
 * mockup (missing "et", duplicated "al.,"). Ported verbatim, not fixed.
 */
export const mockDraftReplaced: Draft = {
  ...mockDraftInitial,
  issuesRemaining: 1,
  paragraphs: [
    [
      w('Late'), w('interaction'), w('retrievers'), w('encode'), w('queries'), w('and'), w('documents'),
      w('into'), w('token-level'), w('vectors'), w('and'), w('score'), w('them'), w('with'), w('MaxSim'),
      m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
      w('ColBERTv2'), w('further'),
      m('reduces', 'supports'), m('index', 'supports'), m('size', 'supports'), m('by', 'supports'),
      m('6–10×', 'supports'), m('while', 'supports'), m('matching', 'supports'), m('retrieval', 'supports'),
      m('quality', 'supports'), m('[Santhanam', 'supports'), m('al.,', 'supports'), m('al.,', 'supports'),
      m('2022].', 'supports'),
      w('On'), w('out-of-domain'), w('data'), w('these'), w('models'),
      m('outperform', 'insufficient'), m('single-vector', 'insufficient'), m('retrievers', 'insufficient'),
      m('on', 'insufficient'), m('BEIR', 'insufficient'), m('[Thakur', 'insufficient'), m('et', 'insufficient'),
      m('al.,', 'insufficient'), m('2021].', 'insufficient'),
    ],
    [
      w('Denoised'), w('supervision'), w('from'), w('a'), w('cross-encoder'), w('teacher'), w('improves'),
      w('learned'), w('representations'),
      m('[Santhanam', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2022].', 'supports'),
      w('MS'), w('MARCO'), w('contains'), w('8.8M'), w('passages'),
      m('[Nguyen', 'supports'), m('et', 'supports'), m('al.,', 'supports'), m('2016].', 'supports'),
    ],
  ],
}
