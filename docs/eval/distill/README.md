# Chat distill eval

`backend/eval_distill.py` scores `app/distill.py`, the step that turns a finished assistant chat into at most 5 remembered facts (SPEC.md).

`sessions.jsonl` holds 20 hand-written chats about papers in the library: ColBERT, BEIR, DensePhrases, CLIP, FLAN, MTEB, XTR, DPR, SPLADE and VSR. Two are small talk. Every chat with statements has at least one the judge did not back. Each chat lists:
- `expected`: keywords a person would want remembered.
- `forbidden`: phrases from the statements that were not backed.

Run it in the worker, where the LLM is configured:

```
python eval_distill.py ../docs/eval/distill/sessions.jsonl --runs 3
```

## Results, 21 Oct 2026

Judge model `qwen3.8-27b-fp8` (deployment id `d7099677…`), 3 runs with dspy's cache off, 1 min 52 s in all.

| Run | Unbacked facts | Recall | Most facts in one chat | Facts from small talk |
|---|---|---|---|---|
| 1 | 0 | 1.000 | 3 | 0 |
| 2 | 0 | 1.000 | 3 | 0 |
| 3 | 0 | 1.000 | 3 | 0 |

Tokens per call: 488 prompt, 79 completion. At Gemini 2.5 Flash list prices that is about $0.0003 per distill, under SPEC.md's $0.005.

## Caveats

- The chats are hand-written and short, so they are easier than real chats. Recall counts a keyword anywhere in a fact's subject or summary, which is lenient. Real transcripts should replace these once the assistant has users who agree to it. Other users' chats are not read for this.
- An unbacked statement never reaches the prompt (`distill.chat_lines`), so 0 unbacked facts mostly measures that filter. The model could still restate a trap in its own words, which the phrase match would miss.
