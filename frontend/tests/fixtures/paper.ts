/**
 * A research paper of the kind authors paste into the editor, with the constructs that froze
 * the preview (SCRUM-462): an image path with an underscore at a fraction of \textwidth
 * followed by \hfill, subcaption sub-figures, an algorithm in algpseudocode, fancyhdr and
 * \algrenewcommand in the preamble, its own thebibliography, and \cite / \ref.
 */

/** The line of the original report. */
export const GEMM_LINE = String.raw`\includegraphics[width=0.49\textwidth]{figures/gemm_spock.png}\hfill`

export const PAPER_TEX = String.raw`\documentclass[10pt]{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{subcaption}
\usepackage{algorithm}
\usepackage{algpseudocode}
\usepackage{fancyhdr}
\usepackage{hyperref}
\pagestyle{fancy}
\fancyhf{}
\fancyfoot[C]{\thepage}
\renewcommand{\headrulewidth}{0pt}
\algrenewcommand\algorithmicrequire{\textbf{Input:}}
\algrenewcommand\algorithmicensure{\textbf{Output:}}

\title{Batched Dense Solvers on Two GPU Generations}
\author{A. Researcher \and B. Engineer}
\date{}

\begin{document}
\maketitle
\thispagestyle{empty}

\begin{abstract}
We compare batched GEMM and Cholesky solves on two GPU generations.
\end{abstract}

\section{Introduction}
\label{sec:intro}
Dense linear algebra dominates many scientific codes~\cite{dongarra2016}.
Section~\ref{sec:results} reports the measurements.

\section{Results}
\label{sec:results}
Figure~\ref{fig:gemm} shows the throughput of both kernels.
\begin{figure}[t]
\centering
\includegraphics[width=0.49\textwidth]{figures/gemm_spock.png}\hfill
\includegraphics[width=0.49\textwidth]{figures/gemm_crusher.png}
\caption{GEMM throughput on the two machines.}
\label{fig:gemm}
\end{figure}

\begin{figure}[t]
\centering
\begin{subfigure}{0.48\textwidth}
\includegraphics[width=\linewidth]{figures/posv}
\caption{Cholesky solve}
\end{subfigure}
\hfill
\begin{subfigure}{0.48\textwidth}
\includegraphics[scale=0.5]{figures/getrf_batched.pdf}
\caption{LU factorization}
\end{subfigure}
\caption{Batched solvers.}
\end{figure}

\section{Method}
Algorithm~\ref{alg:batch} groups the matrices by size before launching~\cite{abdelfattah2021}.
\begin{algorithm}[H]
\caption{Size-grouped batched launch}
\label{alg:batch}
\begin{algorithmic}[1]
\Require matrices $A_1, \dots, A_n$
\Ensure factors $L_1, \dots, L_n$
\State $G \gets$ group the matrices by size
\For{each group $g \in G$}
  \If{$|g| > 1$}
    \State \Call{LaunchBatched}{$g$} \Comment{one kernel per group}
  \Else
    \State \Call{LaunchSingle}{$g$}
  \EndIf
\EndFor
\State \Return $L_1, \dots, L_n$
\end{algorithmic}
\end{algorithm}

\section{Conclusion}
Grouping by size is enough for the batched solvers we measured.

\begin{thebibliography}{9}
\bibitem{dongarra2016} J. Dongarra et al. High-performance matrix-matrix multiplications of very small matrices. 2016.
\bibitem{abdelfattah2021} A. Abdelfattah et al. Batched linear algebra on GPUs. 2021.
\end{thebibliography}
\end{document}
`
