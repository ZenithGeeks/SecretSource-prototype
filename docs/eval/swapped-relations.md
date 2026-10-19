# Swapped relations

`swapped-relations.csv` has 12 claims that test whether the judge notices when a claim swaps the two
sides of a relation. Each relation appears twice: once as the paper states it (expected `supports`)
and once with its sides swapped (expected `refutes`). Ten come from the spatial captions of the VSR
paper (`Visual-spatial-reasoning.pdf`, Figures 1, 2, 11, 13 and 14), and two from "ColBERTv2 extends
ColBERT" (arXiv 2112.01488). Added for #517, where the judge said `supports` for "the cat is below
the keyboard" against the caption "The keyboard is below the cat".

Run it in the worker container, like `decisive-checks.csv`:

```sh
python eval_decisive.py ../docs/eval/swapped-relations.csv --runs 3 --fresh
```

The VSR rows need the PDF at `data/papers/Visual-spatial-reasoning.pdf` relative to the working
directory, and the numbers below used `VISUAL_EVIDENCE=1` with colqwen2-v1.0 ColPali.

## Results, 19 Oct 2026

Rows kept at their expected verdict, per run, no answer cache:

| Judge | Kept per run | The #517 claim (row 1) |
| --- | --- | --- |
| main (94a997c) | 8, 10, 11 | supports, 3 of 3 |
| #517 fix | 12, 12, 12 | refutes, 3 of 3 |

The other evals on the same day, so the drift of the 9arm model is the same on both sides:

| Eval | main | #517 fix |
| --- | --- | --- |
| `decisive-checks.csv`, `VISUAL_EVIDENCE=0` | 11, 10, 10 | 11, 11, 11 |
| `caption-claims.jsonl` (144) | 0.919 (spread 0.035) | 0.924 (spread 0.014) |
| `claims.jsonl` (278) | 0.976 (spread 0.007, recorded earlier) | 0.981 (spread 0.004) |
| Judge tokens per check, this file | 1193 prompt, 86 completion | 1291 prompt, 158 completion |
