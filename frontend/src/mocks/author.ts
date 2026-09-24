/**
 * Every demo item the Author screens show, in one place, shaped like the gateway responses
 * will be (types in src/types/draftCheck.ts). Draft check, the editor and the export menu all
 * read these through src/lib/authorStore.ts, so a count on one screen is the same count on
 * the next. Nothing outside authorStore imports this.
 *
 * Content mirrors Figma 558:3647 / 565:3957. Parse warnings are NOT listed here: the store
 * derives them from the files below (src/lib/latexProject.ts), so the "4 warnings" the
 * design shows come out of the actual .tex/.bib text.
 */

import type { Citation, Draft, ProjectFile, SearchResult } from '../types/draftCheck'

/** Drafts before the store adds their derived `status`. */
export type MockDraft = Omit<Draft, 'status'>

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const daysAgo = (n: number) => minutesAgo(n * 24 * 60)

// ---------------------------------------------------------------------------------------
// d1 — "Related work — thesis ch.2": the project the design walks through.
// Line numbers matter: the citations below point at them, and a test checks they line up.
// ---------------------------------------------------------------------------------------

const MAIN_TEX = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Late Interaction Retrieval for Open-Domain QA}
\author{W. Sirisrisakulchai}

\begin{document}
\maketitle

\begin{abstract}
Lexical retrievers such as BM25 remain a strong baseline~\cite{robertson2009}.
Dense bi-encoders trade some accuracy for speed~\cite{reimers2019}.
We study late interaction, which sits between the two.
\end{abstract}

\input{intro}
\input{related-work}

\bibliographystyle{plainnat}
\bibliography{main}
\end{document}
`

const INTRO_TEX = String.raw`% Chapter 1 — introduction
% Included from main.tex

\section{Introduction}
\label{sec:intro}

Pre-trained language models changed how retrieval systems
represent text~\cite{devlin2019}.
Retrieval-augmented generation grounds an answer in the passages
a retriever returns~\cite{lewis2020}.
Fusion-in-decoder readers scale to hundreds of passages
per question~\cite{izacard2021}.

Sparse learned representations such as SPLADE keep an inverted
index while learning term weights~\cite{formal2021}.
Hard-negative mining is what makes single-vector dense retrievers
competitive~\cite{xiong2021}.
Long-context rerankers close most of the remaining gap~\cite{liu2023}.

This thesis asks whether late interaction keeps its accuracy
once the index is compressed.
`

// Line 20 is mid-edit on purpose (Figma 565:3957 shows the \cite autocomplete open there).
const RELATED_WORK_TEX = String.raw`% Chapter 2 — related work
% Included from main.tex

\section{Related work}
\label{sec:related}

Late interaction retrievers encode queries and documents into
token-level vectors and score them with MaxSim~\cite{khattab2020}.
ColBERTv2 further reduces index size by $6$--$10\times$ while
matching retrieval quality~\cite{khattab2020}.
On out-of-domain data these models outperform single-vector
retrievers on BEIR~\cite{thakur2021}.

\subsection{Distillation}
Denoised supervision from a cross-encoder teacher improves
learned representations~\cite{santhanam2022}.
MS MARCO contains 8.8M passages~\cite{nguyen2016}.

% SecretSource: 3 open issues in this section
Recent engines such as PLAID~\cite{santh
`

// 18 entries. santhanam2022 is defined twice, nguyen2016 and thakur2021 carry no DOI/URL,
// karpukhin2020 (and five more) are never cited, liu2023 is cited but absent — the four
// warnings on Draft check.
const MAIN_BIB = String.raw`@inproceedings{khattab2020,
  title = {ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT},
  author = {Khattab, Omar and Zaharia, Matei},
  booktitle = {SIGIR},
  year = {2020},
  doi = {10.1145/3397271.3401075},
}

@inproceedings{thakur2021,
  title = {BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models},
  author = {Thakur, Nandan and Reimers, Nils and R{\"u}ckl{\'e}, Andreas and Srivastava, Abhishek and Gurevych, Iryna},
  booktitle = {NeurIPS Datasets and Benchmarks},
  year = {2021},
}

@inproceedings{santhanam2022,
  title = {ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction},
  author = {Santhanam, Keshav and Khattab, Omar and Saad-Falcon, Jon and Potts, Christopher and Zaharia, Matei},
  booktitle = {NAACL},
  year = {2022},
  doi = {10.18653/v1/2022.naacl-main.272},
}

@inproceedings{nguyen2016,
  title = {MS MARCO: A Human Generated MAchine Reading COmprehension Dataset},
  author = {Nguyen, Tri and Rosenberg, Mir and Song, Xia and Gao, Jianfeng and Tiwary, Saurabh and Majumder, Rangan and Deng, Li},
  booktitle = {CoCo@NIPS},
  year = {2016},
}

@inproceedings{karpukhin2020,
  title = {Dense Passage Retrieval for Open-Domain Question Answering},
  author = {Karpukhin, Vladimir and O{\u{g}}uz, Barlas and Min, Sewon and Lewis, Patrick and Wu, Ledell and Edunov, Sergey and Chen, Danqi and Yih, Wen-tau},
  booktitle = {EMNLP},
  year = {2020},
  doi = {10.18653/v1/2020.emnlp-main.550},
}

@inproceedings{devlin2019,
  title = {BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author = {Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  booktitle = {NAACL},
  year = {2019},
  doi = {10.18653/v1/N19-1423},
}

@inproceedings{lewis2020,
  title = {Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks},
  author = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio and Karpukhin, Vladimir and Goyal, Naman and K{\"u}ttler, Heinrich and Lewis, Mike and Yih, Wen-tau and Rockt{\"a}schel, Tim and Riedel, Sebastian and Kiela, Douwe},
  booktitle = {NeurIPS},
  year = {2020},
  url = {https://arxiv.org/abs/2005.11401},
}

@inproceedings{izacard2021,
  title = {Leveraging Passage Retrieval with Generative Models for Open Domain Question Answering},
  author = {Izacard, Gautier and Grave, Edouard},
  booktitle = {EACL},
  year = {2021},
  doi = {10.18653/v1/2021.eacl-main.74},
}

@inproceedings{formal2021,
  title = {SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking},
  author = {Formal, Thibault and Piwowarski, Benjamin and Clinchant, St{\'e}phane},
  booktitle = {SIGIR},
  year = {2021},
  doi = {10.1145/3404835.3463098},
}

@inproceedings{xiong2021,
  title = {Approximate Nearest Neighbor Negative Contrastive Learning for Dense Text Retrieval},
  author = {Xiong, Lee and Xiong, Chenyan and Li, Ye and Tang, Kwok-Fung and Liu, Jialin and Bennett, Paul and Ahmed, Junaid and Overwijk, Arnold},
  booktitle = {ICLR},
  year = {2021},
  url = {https://openreview.net/forum?id=zeFrfgyZln},
}

@inproceedings{hofstatter2021,
  title = {Efficiently Teaching an Effective Dense Retriever with Balanced Topic Aware Sampling},
  author = {Hofst{\"a}tter, Sebastian and Lin, Sheng-Chieh and Yang, Jheng-Hong and Lin, Jimmy and Hanbury, Allan},
  booktitle = {SIGIR},
  year = {2021},
  doi = {10.1145/3404835.3462891},
}

@article{robertson2009,
  title = {The Probabilistic Relevance Framework: BM25 and Beyond},
  author = {Robertson, Stephen and Zaragoza, Hugo},
  journal = {Foundations and Trends in Information Retrieval},
  volume = {3},
  number = {4},
  year = {2009},
  doi = {10.1561/1500000019},
}

@inproceedings{reimers2019,
  title = {Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks},
  author = {Reimers, Nils and Gurevych, Iryna},
  booktitle = {EMNLP},
  year = {2019},
  doi = {10.18653/v1/D19-1410},
}

@inproceedings{lin2021,
  title = {Pyserini: A Python Toolkit for Reproducible Information Retrieval Research with Sparse and Dense Representations},
  author = {Lin, Jimmy and Ma, Xueguang and Lin, Sheng-Chieh and Yang, Jheng-Hong and Pradeep, Ronak and Nogueira, Rodrigo},
  booktitle = {SIGIR},
  year = {2021},
  doi = {10.1145/3404835.3463238},
}

@inproceedings{gao2021,
  title = {COIL: Revisit Exact Lexical Match in Information Retrieval with Contextualized Inverted List},
  author = {Gao, Luyu and Dai, Zhuyun and Callan, Jamie},
  booktitle = {NAACL},
  year = {2021},
  doi = {10.18653/v1/2021.naacl-main.241},
}

@inproceedings{zhan2021,
  title = {Optimizing Dense Retrieval Model Training with Hard Negatives},
  author = {Zhan, Jingtao and Mao, Jiaxin and Liu, Yiqun and Guo, Jiafeng and Zhang, Min and Ma, Shaoping},
  booktitle = {SIGIR},
  year = {2021},
  doi = {10.1145/3404835.3462880},
}

@article{kwiatkowski2019,
  title = {Natural Questions: A Benchmark for Question Answering Research},
  author = {Kwiatkowski, Tom and Palomaki, Jennimaria and Redfield, Olivia and Collins, Michael and Parikh, Ankur and Alberti, Chris and Epstein, Danielle and Polosukhin, Illia and Devlin, Jacob and Lee, Kenton and Toutanova, Kristina and Jones, Llion and Kelcey, Matthew and Chang, Ming-Wei and Dai, Andrew and Uszkoreit, Jakob and Le, Quoc and Petrov, Slav},
  journal = {TACL},
  volume = {7},
  year = {2019},
  doi = {10.1162/tacl_a_00276},
}

@inproceedings{santhanam2022,
  title = {ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction},
  author = {Santhanam, Keshav and Khattab, Omar and Saad-Falcon, Jon and Potts, Christopher and Zaharia, Matei},
  booktitle = {NAACL},
  year = {2022},
}
`

function tex(name: string, content: string): ProjectFile {
  return { name, kind: 'tex', content, dirty: false }
}
function bib(name: string, content: string): ProjectFile {
  return { name, kind: 'bib', content, dirty: false }
}

// ---------------------------------------------------------------------------------------
// The other two drafts in "Your drafts".
// ---------------------------------------------------------------------------------------

const SEMINAR_TEX = String.raw`\documentclass{article}
\begin{document}
\section{Dense retrieval for question answering}
Dense passage retrieval learns a dual encoder from question--passage pairs~\cite{karpukhin2020}.
Retrieval-augmented generation conditions a generator on retrieved passages~\cite{lewis2020}.
\bibliography{refs}
\end{document}
`

const REFS_BIB = String.raw`@inproceedings{karpukhin2020,
  title = {Dense Passage Retrieval for Open-Domain Question Answering},
  author = {Karpukhin, Vladimir and O{\u{g}}uz, Barlas and Min, Sewon and Lewis, Patrick and Wu, Ledell and Edunov, Sergey and Chen, Danqi and Yih, Wen-tau},
  booktitle = {EMNLP},
  year = {2020},
  doi = {10.18653/v1/2020.emnlp-main.550},
}

@inproceedings{lewis2020,
  title = {Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks},
  author = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio and Karpukhin, Vladimir and Goyal, Naman and K{\"u}ttler, Heinrich and Lewis, Mike and Yih, Wen-tau and Rockt{\"a}schel, Tim and Riedel, Sebastian and Kiela, Douwe},
  booktitle = {NeurIPS},
  year = {2020},
  url = {https://arxiv.org/abs/2005.11401},
}
`

const ABSTRACT_TEX = String.raw`\documentclass{article}
\begin{document}
\section*{Abstract}
We compress late-interaction indexes without losing accuracy~\cite{khattab2020}.
\end{document}
`

export const MOCK_DRAFTS: MockDraft[] = [
  {
    id: 'd1',
    title: 'Related work — thesis ch.2',
    version: 3,
    lastCheckedAt: minutesAgo(2),
    files: [
      tex('main.tex', MAIN_TEX),
      tex('intro.tex', INTRO_TEX),
      tex('related-work.tex', RELATED_WORK_TEX),
      bib('main.bib', MAIN_BIB),
    ],
    sinceLastCheck: { previousVersion: 2, addedCitations: 2, fixedIssues: 1, newIssues: 1 },
  },
  {
    id: 'd2',
    title: 'Seminar paper (CPE)',
    version: 5,
    lastCheckedAt: daysAgo(1),
    files: [tex('seminar.tex', SEMINAR_TEX), bib('refs.bib', REFS_BIB)],
  },
  {
    id: 'd3',
    title: 'Workshop abstract',
    version: 1,
    lastCheckedAt: null,
    files: [tex('abstract.tex', ABSTRACT_TEX)],
  },
]

// ---------------------------------------------------------------------------------------
// Search results — "Find sources" and the editor's \cite autocomplete suggestions.
// ---------------------------------------------------------------------------------------

const COLBERTV2_BIBTEX = String.raw`@inproceedings{santhanam2022,
  title = {ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction},
  author = {Santhanam, Keshav and Khattab, Omar and Saad-Falcon, Jon and Potts, Christopher and Zaharia, Matei},
  booktitle = {NAACL},
  year = {2022},
  doi = {10.18653/v1/2022.naacl-main.272},
}`

const BEIR_BIBTEX = String.raw`@inproceedings{thakur2021,
  title = {BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models},
  author = {Thakur, Nandan and Reimers, Nils and R{\"u}ckl{\'e}, Andreas and Srivastava, Abhishek and Gurevych, Iryna},
  booktitle = {NeurIPS Datasets and Benchmarks},
  year = {2021},
  url = {https://arxiv.org/abs/2104.08663},
}`

const PLAID_BIBTEX = String.raw`@inproceedings{santhanam2022plaid,
  title = {PLAID: An Efficient Engine for Late Interaction Retrieval},
  author = {Santhanam, Keshav and Khattab, Omar and Potts, Christopher and Zaharia, Matei},
  booktitle = {CIKM},
  year = {2022},
  doi = {10.1145/3511808.3557325},
}`

export const MOCK_SEARCH_RESULTS: SearchResult[] = [
  {
    id: 's1',
    key: 'santhanam2022',
    title: 'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction',
    authors: 'Santhanam et al.',
    venue: 'NAACL',
    year: 2022,
    citedBy: 640,
    openAccess: true,
    similarity: 0.91,
    bibtex: COLBERTV2_BIBTEX,
    evidence: {
      passage: '…residual compression reduces the space footprint of ColBERT by 6–10× with no loss in quality.',
      pdf: 'colbertv2.pdf',
      page: 4,
    },
    suggestedForCitationId: 'c10',
  },
  {
    id: 's2',
    key: 'thakur2021',
    title: 'BEIR: A Heterogeneous Benchmark for Zero-shot IR',
    authors: 'Thakur et al.',
    venue: 'NeurIPS',
    year: 2021,
    citedBy: 1200,
    openAccess: true,
    similarity: 0.74,
    bibtex: BEIR_BIBTEX,
  },
  {
    id: 's3',
    key: 'santhanam2022plaid',
    title: 'PLAID: An Efficient Engine for Late Interaction Retrieval',
    authors: 'Santhanam et al.',
    venue: 'CIKM',
    year: 2022,
    citedBy: 110,
    openAccess: true,
    similarity: 0.69,
    bibtex: PLAID_BIBTEX,
  },
]

// ---------------------------------------------------------------------------------------
// Citations — one per \cite, with the check's verdict. d1 has 13 \cite commands: 12 got a
// verdict (9 supported, 1 partial, 1 not supported, 1 unavailable) and liu2023 could not be
// checked because main.bib has no entry for it. The three that need work are the three
// issue rows in Figma.
// ---------------------------------------------------------------------------------------

const MATCHES_CROSSREF = { ok: true, text: 'Bib metadata matches Crossref — title, authors, year, DOI' }

export const MOCK_CITATIONS: Citation[] = [
  // main.tex
  {
    id: 'c1',
    draftId: 'd1',
    key: 'robertson2009',
    file: 'main.tex',
    line: 13,
    section: 'Abstract',
    sentence: String.raw`Lexical retrievers such as BM25 remain a strong baseline~\cite{robertson2009}.`,
    claim: 'BM25 remains a strong retrieval baseline',
    verdict: 'supports',
    confidence: 0.93,
    sourceRef: {
      key: 'robertson2009',
      title: 'The Probabilistic Relevance Framework: BM25 and Beyond',
      authors: 'Robertson & Zaragoza',
      year: 2009,
      venue: 'Foundations and Trends in IR',
      doi: '10.1561/1500000019',
      pdf: 'bm25.pdf',
    },
    evidence: { passage: '…BM25 remains a strong and widely used baseline for ad hoc retrieval.', pdf: 'bm25.pdf', page: 2 },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c2',
    draftId: 'd1',
    key: 'reimers2019',
    file: 'main.tex',
    line: 14,
    section: 'Abstract',
    sentence: String.raw`Dense bi-encoders trade some accuracy for speed~\cite{reimers2019}.`,
    claim: 'Bi-encoders trade some accuracy for speed',
    verdict: 'supports',
    confidence: 0.84,
    sourceRef: {
      key: 'reimers2019',
      title: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
      authors: 'Reimers & Gurevych',
      year: 2019,
      venue: 'EMNLP',
      doi: '10.18653/v1/D19-1410',
      pdf: 'sbert.pdf',
    },
    evidence: {
      passage: '…reducing the effort for finding the most similar pair from 65 hours with BERT to about 5 seconds, while maintaining the accuracy.',
      pdf: 'sbert.pdf',
      page: 1,
    },
    metadataMatch: MATCHES_CROSSREF,
  },
  // intro.tex
  {
    id: 'c3',
    draftId: 'd1',
    key: 'devlin2019',
    file: 'intro.tex',
    line: 8,
    section: 'Introduction',
    sentence: String.raw`Pre-trained language models changed how retrieval systems represent text~\cite{devlin2019}.`,
    claim: 'Pre-trained language models changed text representation for retrieval',
    verdict: 'supports',
    confidence: 0.81,
    sourceRef: {
      key: 'devlin2019',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      authors: 'Devlin et al.',
      year: 2019,
      venue: 'NAACL',
      doi: '10.18653/v1/N19-1423',
      pdf: 'bert.pdf',
    },
    evidence: { passage: '…obtains new state-of-the-art results on eleven natural language processing tasks.', pdf: 'bert.pdf', page: 1 },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c4',
    draftId: 'd1',
    key: 'lewis2020',
    file: 'intro.tex',
    line: 10,
    section: 'Introduction',
    sentence: String.raw`Retrieval-augmented generation grounds an answer in the passages a retriever returns~\cite{lewis2020}.`,
    claim: 'RAG grounds answers in retrieved passages',
    verdict: 'supports',
    confidence: 0.95,
    sourceRef: {
      key: 'lewis2020',
      title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
      authors: 'Lewis et al.',
      year: 2020,
      venue: 'NeurIPS',
      url: 'https://arxiv.org/abs/2005.11401',
      pdf: 'rag.pdf',
    },
    evidence: {
      passage: '…models which combine pre-trained parametric and non-parametric memory for language generation.',
      pdf: 'rag.pdf',
      page: 1,
    },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c5',
    draftId: 'd1',
    key: 'izacard2021',
    file: 'intro.tex',
    line: 12,
    section: 'Introduction',
    sentence: String.raw`Fusion-in-decoder readers scale to hundreds of passages per question~\cite{izacard2021}.`,
    claim: 'Fusion-in-decoder scales to hundreds of passages',
    verdict: 'supports',
    confidence: 0.9,
    sourceRef: {
      key: 'izacard2021',
      title: 'Leveraging Passage Retrieval with Generative Models for Open Domain Question Answering',
      authors: 'Izacard & Grave',
      year: 2021,
      venue: 'EACL',
      doi: '10.18653/v1/2021.eacl-main.74',
      pdf: 'fid.pdf',
    },
    evidence: { passage: '…performance keeps improving as the number of retrieved passages grows to 100.', pdf: 'fid.pdf', page: 4 },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c6',
    draftId: 'd1',
    key: 'formal2021',
    file: 'intro.tex',
    line: 15,
    section: 'Introduction',
    sentence: String.raw`Sparse learned representations such as SPLADE keep an inverted index while learning term weights~\cite{formal2021}.`,
    claim: 'SPLADE keeps an inverted index while learning term weights',
    verdict: 'supports',
    confidence: 0.92,
    sourceRef: {
      key: 'formal2021',
      title: 'SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking',
      authors: 'Formal et al.',
      year: 2021,
      venue: 'SIGIR',
      doi: '10.1145/3404835.3463098',
      pdf: 'splade.pdf',
    },
    evidence: { passage: '…sparse representations that can be used with a standard inverted index.', pdf: 'splade.pdf', page: 1 },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c7',
    draftId: 'd1',
    key: 'xiong2021',
    file: 'intro.tex',
    line: 17,
    section: 'Introduction',
    sentence: String.raw`Hard-negative mining is what makes single-vector dense retrievers competitive~\cite{xiong2021}.`,
    claim: 'Hard-negative mining makes dense retrievers competitive',
    verdict: 'supports',
    confidence: 0.78,
    sourceRef: {
      key: 'xiong2021',
      title: 'Approximate Nearest Neighbor Negative Contrastive Learning for Dense Text Retrieval',
      authors: 'Xiong et al.',
      year: 2021,
      venue: 'ICLR',
      url: 'https://openreview.net/forum?id=zeFrfgyZln',
      pdf: 'ance.pdf',
    },
    evidence: {
      passage: '…negatives constructed from the ANN index lead to a dense retriever that nearly matches BERT rerankers.',
      pdf: 'ance.pdf',
      page: 2,
    },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c8',
    draftId: 'd1',
    key: 'liu2023',
    file: 'intro.tex',
    line: 18,
    section: 'Introduction',
    sentence: String.raw`Long-context rerankers close most of the remaining gap~\cite{liu2023}.`,
    claim: 'Long-context rerankers close most of the remaining gap',
    verdict: 'unchecked',
    explanation: 'main.bib has no entry for liu2023, so there is nothing to look up. Add the entry, then re-check.',
  },
  // related-work.tex
  {
    id: 'c9',
    draftId: 'd1',
    key: 'khattab2020',
    file: 'related-work.tex',
    line: 8,
    section: 'Related work',
    sentence: String.raw`Late interaction retrievers encode queries and documents into token-level vectors and score them with MaxSim~\cite{khattab2020}.`,
    claim: 'Late interaction scores token-level vectors with MaxSim',
    verdict: 'supports',
    confidence: 0.96,
    sourceRef: {
      key: 'khattab2020',
      title: 'ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT',
      authors: 'Khattab & Zaharia',
      year: 2020,
      venue: 'SIGIR',
      doi: '10.1145/3397271.3401075',
      pdf: 'colbert.pdf',
    },
    evidence: {
      passage: '…ColBERT employs a cheap yet powerful interaction step that models their fine-grained similarity (MaxSim).',
      pdf: 'colbert.pdf',
      page: 1,
    },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c10',
    draftId: 'd1',
    key: 'khattab2020',
    file: 'related-work.tex',
    line: 10,
    section: 'Related work',
    sentence: String.raw`ColBERTv2 further reduces index size by $6$--$10\times$ while matching retrieval quality~\cite{khattab2020}.`,
    claim: 'ColBERT cuts index size 6–10× while matching quality',
    verdict: 'refutes',
    confidence: 0.88,
    sourceRef: {
      key: 'khattab2020',
      title: 'ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT',
      authors: 'Khattab & Zaharia',
      year: 2020,
      venue: 'SIGIR',
      doi: '10.1145/3397271.3401075',
      pdf: 'colbert.pdf',
    },
    evidence: { passage: '…we leave compression of the embeddings to future work.', pdf: 'colbert.pdf', page: 7 },
    explanation:
      'The 6–10× reduction comes from ColBERTv2 (Santhanam et al., 2022). The 2020 paper reports an uncompressed 154 GiB index and defers compression.',
    metadataMatch: MATCHES_CROSSREF,
    suggestedReplacement: MOCK_SEARCH_RESULTS[0],
  },
  {
    id: 'c11',
    draftId: 'd1',
    key: 'thakur2021',
    file: 'related-work.tex',
    line: 12,
    section: 'Related work',
    sentence: String.raw`On out-of-domain data these models outperform single-vector retrievers on BEIR~\cite{thakur2021}.`,
    claim: 'These models outperform single-vector retrievers on BEIR',
    verdict: 'insufficient',
    confidence: 0.61,
    sourceRef: {
      key: 'thakur2021',
      title: 'BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models',
      authors: 'Thakur et al.',
      year: 2021,
      venue: 'NeurIPS',
      pdf: 'beir.pdf',
    },
    evidence: {
      passage: '…we find that no single model consistently outperforms the others across all datasets.',
      pdf: 'beir.pdf',
      page: 7,
    },
    explanation:
      'BEIR (Thakur et al., 2021) benchmarks retrievers but does not say late interaction outperforms single-vector models. Weaken the claim, or cite the comparison you mean.',
    metadataMatch: { ok: false, text: 'main.bib entry has no DOI or URL — matched Crossref by title' },
  },
  {
    id: 'c12',
    draftId: 'd1',
    key: 'santhanam2022',
    file: 'related-work.tex',
    line: 16,
    section: 'Distillation',
    sentence: String.raw`Denoised supervision from a cross-encoder teacher improves learned representations~\cite{santhanam2022}.`,
    claim: 'Cross-encoder distillation improves learned representations',
    verdict: 'supports',
    confidence: 0.9,
    sourceRef: {
      key: 'santhanam2022',
      title: 'ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction',
      authors: 'Santhanam et al.',
      year: 2022,
      venue: 'NAACL',
      doi: '10.18653/v1/2022.naacl-main.272',
      pdf: 'colbertv2.pdf',
    },
    evidence: {
      passage: '…denoised supervision from a cross-encoder teacher improves the quality of the learned representations.',
      pdf: 'colbertv2.pdf',
      page: 3,
    },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c13',
    draftId: 'd1',
    key: 'nguyen2016',
    file: 'related-work.tex',
    line: 17,
    section: 'Distillation',
    sentence: String.raw`MS MARCO contains 8.8M passages~\cite{nguyen2016}.`,
    claim: 'MS MARCO contains 8.8M passages',
    verdict: 'unavailable',
    sourceRef: {
      key: 'nguyen2016',
      title: 'MS MARCO: A Human Generated MAchine Reading COmprehension Dataset',
      authors: 'Nguyen et al.',
      year: 2016,
      venue: 'CoCo@NIPS',
    },
    explanation: 'No open-access PDF was found for nguyen2016, and main.bib gives no DOI or URL. Upload the PDF to check this one.',
    metadataMatch: { ok: false, text: 'main.bib entry has no DOI or URL — could not confirm with Crossref' },
  },
  // d2 — all supported
  {
    id: 'c14',
    draftId: 'd2',
    key: 'karpukhin2020',
    file: 'seminar.tex',
    line: 4,
    section: 'Dense retrieval for question answering',
    sentence: String.raw`Dense passage retrieval learns a dual encoder from question--passage pairs~\cite{karpukhin2020}.`,
    claim: 'DPR learns a dual encoder from question–passage pairs',
    verdict: 'supports',
    confidence: 0.97,
    sourceRef: {
      key: 'karpukhin2020',
      title: 'Dense Passage Retrieval for Open-Domain Question Answering',
      authors: 'Karpukhin et al.',
      year: 2020,
      venue: 'EMNLP',
      doi: '10.18653/v1/2020.emnlp-main.550',
      pdf: 'dpr.pdf',
    },
    evidence: { passage: '…a dual-encoder framework trained from a small number of question and passage pairs.', pdf: 'dpr.pdf', page: 1 },
    metadataMatch: MATCHES_CROSSREF,
  },
  {
    id: 'c15',
    draftId: 'd2',
    key: 'lewis2020',
    file: 'seminar.tex',
    line: 5,
    section: 'Dense retrieval for question answering',
    sentence: String.raw`Retrieval-augmented generation conditions a generator on retrieved passages~\cite{lewis2020}.`,
    claim: 'RAG conditions a generator on retrieved passages',
    verdict: 'supports',
    confidence: 0.94,
    sourceRef: {
      key: 'lewis2020',
      title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
      authors: 'Lewis et al.',
      year: 2020,
      venue: 'NeurIPS',
      url: 'https://arxiv.org/abs/2005.11401',
      pdf: 'rag.pdf',
    },
    evidence: { passage: '…the generator conditions on these latent documents together with the input.', pdf: 'rag.pdf', page: 2 },
    metadataMatch: MATCHES_CROSSREF,
  },
  // d3 — never checked
  {
    id: 'c16',
    draftId: 'd3',
    key: 'khattab2020',
    file: 'abstract.tex',
    line: 4,
    section: 'Abstract',
    sentence: String.raw`We compress late-interaction indexes without losing accuracy~\cite{khattab2020}.`,
    claim: 'Late-interaction indexes compress without losing accuracy',
    verdict: 'unchecked',
  },
]
