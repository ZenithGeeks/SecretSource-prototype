import type { Claim } from '../types'

/** One of each verdict, plus an uncited claim — the edge cases the home/attention list should render. */
export const mockClaims: Claim[] = [
  {
    id: 'c1',
    text: 'ColBERTv2 reduces index size by 6–10× relative to ColBERT while matching retrieval quality.',
    citation: { id: 'cit1', label: 'Khattab & Zaharia, 2020' },
    verdict: 'refutes',
    explanation:
      'Your sentence says ColBERT (2020) cuts index size 6–10×. That result is from ColBERTv2 (Santhanam et al., 2022); the 2020 paper reports the uncompressed 154 GiB index and defers compression.',
    quote: '"…we leave compression of the embeddings to future work."',
    quoteLocation: 'colbert.pdf p.7',
    suggestion: {
      id: 's1',
      citation: 'Santhanam et al. (2022)',
      title: 'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction',
      verdict: 'supports',
      similarity: 0.91,
      location: 'p.4',
      quote: '"…residual compression reduces the space footprint of ColBERT by 6–10× with no loss in quality."',
      inLibrary: true,
      openAccess: false,
      isCurrentCitation: false,
      isBestMatch: true,
    },
  },
  {
    id: 'c2',
    text: 'Late interaction outperforms single-vector retrieval on BEIR out-of-domain benchmarks.',
    citation: { id: 'cit2', label: 'Thakur et al., 2021' },
    verdict: 'insufficient',
    explanation: 'BEIR (Thakur et al., 2021) is silent on "outperform single-vector retrievers". Weaken the claim or find a source.',
  },
  {
    id: 'c3',
    text: 'MS MARCO contains 8.8M passages drawn from web documents.',
    citation: { id: 'cit3', label: 'Nguyen et al., 2016' },
    verdict: 'supports',
  },
  {
    id: 'c4',
    // edge case: a claim with no citation at all
    text: 'Retrieval-augmented models are becoming the default architecture for open-domain QA.',
  },
]
