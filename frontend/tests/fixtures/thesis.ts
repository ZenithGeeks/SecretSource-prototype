/**
 * A realistic thesis chapter: sections, inline and display math, a figure, a table, lists,
 * a footnote, a URL, a \newcommand, and the \cite commands the Author tests check against.
 * The bibliography has the four kinds of warning "Parsed draft" reports: a duplicate key
 * (santhanam2022), an entry with no DOI or URL (nguyen2016), an entry no draft cites
 * (karpukhin2020) and a \cite whose key is missing (liu2023).
 */

export const RELATED_WORK_TEX = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}
\newcommand{\colbert}{ColBERT}
\newcommand{\eg}[1]{(e.g.\ #1)}
\title{Late Interaction Retrieval for Open-Domain QA}
\author{W. Sirisrisakulchai}

\begin{document}
\maketitle

\begin{abstract}
Lexical retrievers such as BM25 remain a strong baseline~\cite{robertson2009}.
\end{abstract}

\section{Related work}
\label{sec:related}

Late interaction retrievers encode queries and documents into
token-level vectors and score them with MaxSim~\cite{khattab2020}.
ColBERTv2 further reduces index size by $6$--$10\times$ while
matching retrieval quality~\cite{khattab2020}.
On out-of-domain data these models outperform single-vector
retrievers on BEIR~\cite{thakur2021}.
The score is
\begin{equation}
  S(q, d) = \sum_{i \in q} \max_{j \in d} E_{q_i} \cdot E_{d_j} \label{eq:maxsim}
\end{equation}
as in Equation~\eqref{eq:maxsim}, and \colbert{} keeps one vector per token \eg{768 dimensions}.

\subsection{Distillation}
Denoised supervision from a cross-encoder teacher improves
learned representations~\cite{santhanam2022}.\footnote{Reported on MS MARCO dev.}
MS MARCO contains 8.8M passages~\cite{nguyen2016}.
Long-context rerankers close most of the remaining gap~\cite{liu2023}.
Code is at \url{https://github.com/stanford-futuredata/ColBERT}.

\begin{itemize}
  \item Late interaction: one vector per token.
  \item Single-vector: one vector per passage.
\end{itemize}

\begin{figure}[t]
  \centering
  \includegraphics[width=0.8\linewidth]{figures/architecture.pdf}
  \caption{The late-interaction architecture.}
  \label{fig:arch}
\end{figure}

\begin{table}[h]
  \centering
  \begin{tabular}{lrr}
    \toprule
    Model & nDCG@10 & Index (GiB) \\
    \midrule
    ColBERT & 0.40 & 154 \\
    ColBERTv2 & 0.42 & 20 \\
    \bottomrule
  \end{tabular}
  \caption{Index size and quality on MS MARCO.}
\end{table}

\begin{align}
  a &= b + c \\
  d &= e
\end{align}

See Figure~\ref{fig:arch} and Section~\ref{sec:related}.

\bibliographystyle{plainnat}
\bibliography{main}
\end{document}
`

export const MAIN_BIB = String.raw`@inproceedings{khattab2020,
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
  url = {https://openreview.net/forum?id=wCu6T5xFjeJ},
}

@inproceedings{santhanam2022,
  title = {ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction},
  author = {Santhanam, Keshav and Khattab, Omar and Saad-Falcon, Jon and Potts, Christopher and Zaharia, Matei},
  booktitle = {NAACL},
  year = {2022},
  doi = {10.18653/v1/2022.naacl-main.272},
}

@inproceedings{santhanam2022,
  title = {ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction},
  author = {Santhanam, Keshav and Khattab, Omar},
  year = {2022},
}

@inproceedings{nguyen2016,
  title = {MS MARCO: A Human Generated MAchine Reading COmprehension Dataset},
  author = {Nguyen, Tri and Rosenberg, Matthew and Song, Xia and Gao, Jianfeng and Tiwary, Saurabh and Majumder, Rangan and Deng, Li},
  booktitle = {CoCo@NIPS},
  year = {2016},
}

@article{robertson2009,
  title = {The Probabilistic Relevance Framework: BM25 and Beyond},
  author = {Robertson, Stephen and Zaragoza, Hugo},
  journal = {Foundations and Trends in Information Retrieval},
  year = {2009},
  doi = {10.1561/1500000019},
}

@inproceedings{karpukhin2020,
  title = {Dense Passage Retrieval for Open-Domain Question Answering},
  author = {Karpukhin, Vladimir and Oguz, Barlas and Min, Sewon and Lewis, Patrick and Wu, Ledell and Edunov, Sergey and Chen, Danqi and Yih, Wen-tau},
  booktitle = {EMNLP},
  year = {2020},
  doi = {10.18653/v1/2020.emnlp-main.550},
}
`

export const INTRO_TEX = String.raw`\section{Introduction}
Pre-trained language models changed how retrieval systems represent text~\cite{devlin2019}.
`

/** The files of the thesis draft the tests seed. */
export const THESIS_FILES = [
  { name: 'related-work.tex', content: RELATED_WORK_TEX },
  { name: 'intro.tex', content: INTRO_TEX },
  { name: 'main.bib', content: MAIN_BIB },
]

/** A chapter with a package LaTeX.js cannot load and an environment it does not know. */
export const UNSUPPORTED_TEX = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\section{Diagram}
Text before.
\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}
\end{document}
`

/** A chapter whose preamble mixes what LaTeX.js cannot load (geometry, booktabs,
 * \newtheorem, a \DeclareMathOperator, a \hypersetup spanning three lines) with packages it
 * bundles (multicol, hyperref): the allowlist drops the former, the multicols body renders
 * as real columns. */
export const UNSUPPORTED_PREAMBLE_TEX = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,hyperref}
\usepackage{multicol}
\newtheorem{theorem}{Theorem}
\DeclareMathOperator{\argmax}{arg\,max}
\hypersetup{
  colorlinks = true,
  linkcolor = blue,
}
\title{Two columns}
\begin{document}
\maketitle
\section{Two columns}
\begin{multicols}{2}
Left column text.

Right column text.
\end{multicols}
\end{document}
`

/** A chapter that leans on packages LaTeX.js bundles — textgreek, gensymb, multicol — plus
 * a \setcounter of a counter it has, so nothing should be dropped or reported. */
export const BUNDLED_PACKAGES_TEX = String.raw`\documentclass{article}
\usepackage{textgreek}
\usepackage{gensymb}
\usepackage{multicol}
\setcounter{secnumdepth}{2}
\title{Greek and degrees}
\begin{document}
\maketitle
\section{Symbols}
The \textalpha\ particle scatters at 90\degree\ and \textbeta\ decay follows.
\begin{multicols}{2}
Left column text.

Right column text.
\end{multicols}
\end{document}
`

/** A chapter with a syntax error on line 4 (an unclosed group). */
export const BROKEN_TEX = String.raw`\documentclass{article}
\begin{document}
\section{Broken}
This \textbf{never closes
\end{document}
`
