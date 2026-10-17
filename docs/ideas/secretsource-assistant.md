# SecretSource Assistant

One-pager from the idea-refine session on 2026-10-17.

## Problem Statement
How might we help a researcher understand papers and concepts in minutes, using their own library and the open literature, with answers they can trust because every citation has been checked against its source?

## Recommended Direction
An assistant panel that follows the user through the existing workspace: library, graph and analysis view. It knows what is on screen. Ask from a graph node and the question is about that node; ask from an analysis and it is about that paper. Answers follow Who / What / When / Where / Why / How. Each statement cites a passage, and the existing judge checks that passage before the answer is shown. A statement the source does not back is marked "not backed", never hidden. That checking is the difference from SciSpace: SciSpace cites, SecretSource checks what it cites.

It is built mostly from parts that already exist: the ADK agent team (`backend/app/agents/team.py`: coordinator, RAG, paper and verify agents), ColBERT retrieval over indexed papers, the judge (`verify.check_prepared`), ADK sessions in Supabase (`app/sessions.py`, schema `adk`), `load_memory` / `app/memory.py`, and the graph's data (supports, contradicts, silent).

Two features come without typing: a one-click 5W1H explain card for any paper or graph node, and a gap finder that lists unbacked claims, contradictions between sources, and much-cited works not yet read.

The assistant can search the open literature (OpenAlex and arXiv first, since Semantic Scholar refuses most requests, see memory `s2-throttling`). It suggests papers, and adding one runs the existing analysis. Memory starts simple: a per-user record in Supabase of the papers and concepts asked about, with short summaries.

## Key Assumptions to Validate
- [ ] Checking every cited statement is fast enough: an answer within 20 s. Test on 20 questions from the three eval papers; measure time per answer.
- [ ] Checked answers are mostly backed: if over about a third come back "not backed", it feels broken. Measure that share on the same 20 questions.
- [ ] Students prefer it to SciSpace for understanding a paper: 3 to 5 thesis students try both on their own paper; time how long until they can explain it.
- [ ] The 9arm LLM holds up under chat traffic: 5 users chatting at once, latency and rate limits.
- [ ] OpenAlex and arXiv search is good enough without Semantic Scholar: on 10 questions, a relevant paper in the top 5.

## MVP Scope (semester demo, about 8 weeks, mid-December)
In: the assistant panel on the library, graph and analysis screens with screen context; 5W1H answers from the library with checked citations; the explain card; the gap finder; open-literature search that suggests papers and adds one to the library; the per-user memory record; CONSTRAINTS.md rules for answer latency and the "not backed" rate.

## Not Doing (and Why)
- Autonomous deep-research reports: many LLM calls and downloads per question, an unreliable search API, unproven quality. Revisit once suggested papers prove useful.
- Quizzes: likely low engagement; an optional mode once memory exists.
- A concept-map view of memory: needs reliable "learned" signals; a list first.
- TencentDB Agent Memory: a Node.js proxy for coding agents, no ADK support, three extra services; Supabase plus ADK already store sessions.
- A chat-first redesign: would rebuild the app front before the demo.
- The Author editor and Teacher screens: double the integration work; researcher screens first.
- Answers without a source.

## Open Questions
- What counts as "learned": anything asked about, or only what the user confirmed?
- How do the two frontend teammates split the panel, explain card and gap finder? (memory `team-ownership`)
- Does each conversation stay separate, or see the user's other conversations?
- Cost: a chat question priced as if the LLM were paid, against $0.50 per analysis and $10 per user per month in CONSTRAINTS.md.

## Decisions made in the session
- For: competing with SciSpace as an assistant, not only claim checking.
- Sources: library plus open web/papers.
- Success: faster understanding.
- Memory: what the user has learned, across sessions.
- Picked variations 1 to 6 (explain card, checked chat, deep research, quizzing, gap finder, concept map); said it is a new direction for the whole system.
- Shape: assistant panel across the workspace. Deadline: semester demo, mid-December.
