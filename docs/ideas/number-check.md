# Number check

One-pager from the idea-refine session on 2026-10-17. It started as "add the Mirai scientific
calculator to the research agent". Mirai (openmirai/mirai-scientific-calculator) is a React
calculator UI with a small numeric TypeScript core: no LaTeX input, no symbolic maths, and no
agent interface. Our agents run in Python, so they use Python tools instead.

## Problem Statement

How might we help a researcher trust the numbers in a paper by checking them the way we
already check citations, and show plainly where a number doesn't add up?

## Recommended Direction

Add a number verdict next to the citation verdict. A computed number in the text ("7× faster",
"+3.2 nDCG", "62% of the errors") is linked to its operands in the paper's own tables, and
Python recomputes it. A number attributed to a cited paper ("BEIR reports 0.49 nDCG") is looked
up in that paper's passages and compared. The verdicts are *adds up / doesn't add up / can't
tell* and *matches / differs / not found*. They show up in the analysis view with the source
cell or passage, like citation badges.

The LLM never does arithmetic. It proposes the expression and points at the operands. Code
checks that each operand really appears in the table or passage, then computes the result.
Tolerance comes from the precision the paper reports: "7×" passes for 7.08, while 3.2 against
2.3 fails. That keeps false alarms down, and a false "doesn't add up" is the costly error here.

The same evaluator serves two more uses. The assistant gets a `calculate` tool, so its answers
compute numbers instead of guessing them. A statistics check runs only where the text reports
test statistics: it recomputes p from t/F/χ² and df (statcheck) and tests means against n
(GRIM). That check needs no LLM. It's an add-on, since CS papers rarely report t(df).

## Key Assumptions to Validate

- [ ] Cited papers' passages contain their result-table numbers. Check 10 cited papers from the
      eval set: do the table numbers appear in the ColBERT passages? If not, the cited-number
      check needs Docling on cited papers (time and gateway memory; measure both first).
- [ ] The LLM picks the right operands. Hand-label 30 computed-number sentences from 10 papers.
      Target: at least 80% exact operand pairs, 3 runs without the cache.
- [ ] There are real slips to find. Run on 20 papers and count real errors against false
      alarms. If nothing real turns up, stop at the assistant tool.
- [ ] Precision-based tolerance gives at most 1 false "doesn't add up" per 20 papers.
- [ ] Cost stays inside CONSTRAINTS.md: number checks add at most $0.05 per analysis, priced at
      Gemini 2.5 Flash list prices.

## MVP Scope

In:
- A safe evaluator: an `ast`-based arithmetic evaluator (+ − × ÷, powers, log, sqrt, min, max,
  mean) plus `scipy.stats` for p-values. No `eval`, no `sympify`.
- Own-table checks for computed numbers.
- Cited-number checks against the cited paper's passages.
- Statcheck and GRIM where the patterns appear.
- Verdicts with their source cell or passage in the analysis view.
- A `calculate` tool for the assistant.
- An eval set in `docs/eval/` and a CONSTRAINTS.md rule for false "doesn't add up" verdicts.

Out: everything in Not Doing.

## Not Doing (and Why)

- Formula consistency (units, dimensions, symbols defined before use): formula OCR is noisy
  and notation varies, so it would give many false alarms. Revisit once number checks prove
  useful.
- Mirai in the backend: it's TypeScript and numbers only, so it would need a Node sidecar for
  what Python does in-process.
- A calculator panel in the reader UI (Mirai could fill it): the user didn't ask for one; it
  can be added later if researchers want to recompute by hand.
- Numbers in charts and figures: needs vision (ColPali), which is opt-in and costly.
- Symbolic algebra (re-deriving equations): a research problem, not a demo feature.
- Checking the Author's LaTeX tables: exact numbers make this easier, but researcher screens
  come first. It's a good second audience.

## Open Questions

- When a number can't be tied to a table cell, show *can't tell* or nothing? Showing nothing
  avoids noise; showing *can't tell* keeps coverage honest, as with unchecked citations.
- Which pipeline step owns it: a new stage after claim extraction, or part of the judge's
  prepared check (`verify.check_prepared`)?
- Statcheck on CS papers: run it on the 20-paper sample before building the UI for it.
