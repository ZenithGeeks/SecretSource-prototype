# Source-resolution benchmark: 16 November 2026

Run on commit `52b010982a13253e0df873550d31f4d9f6e630b2` using the public metadata and PDF
providers configured for this repository. The live runner writes PDFs to a temporary directory,
disables the application's persistent source caches for each run, and removes temporary files
when the run ends.

## Scores

| Evaluation | Primary-only | Full fallback pipeline | Change |
| --- | ---: | ---: | ---: |
| Mocked, seeded fallback cases (3 known readable copies) | 0/3 (0%) | 3/3 (100%) | +100 percentage points; 3 recovered |
| Live ACL Anthology corpus (3 papers) | 0/3 (0%) | 3/3 (100%) | +100 percentage points; 3 recovered |
| Live user-reported corpus (10 works) | 2/10 (20%) | 2/10 (20%) | 0 percentage points; 0 recovered |

The primary-only column runs the existing first lookup/download path with the new alternate-copy
fallback step disabled. The full column enables the fallback step. Both sides use the same citation
metadata, identity checks, and PDF validation.

The deterministic offline suite also matched the expected outcome and source-kind classification in
**15/15 cases**. It read **5/6** fixtures marked as having an accessible copy; the remaining accessible
fixture exercises identity safeguards. These are mocked cases, not a claim that 100% of real papers
are downloadable.

The live ACL run matched **3/3 references**, accepted **13 identity-validated candidates** at **100%
precision**, and recorded **8 failed attempts**, **0 retryable attempts**, and **0 retry successes**.
The ten-work run matched **5/10 references**, accepted **6 identity-validated candidates** at **100%
precision**, and recorded **34 failed attempts**, **0 retryable attempts**, and **0 retry successes**.

## Live case comparison

### ACL Anthology corpus

| Case | Primary-only | Full fallback | Result |
| --- | --- | --- | --- |
| TACL 00594 | blocked | readable | Recovered |
| TACL 00276 | blocked | readable | Recovered |
| BLEU (2002) | no accessible copy | readable | Recovered |

In a separate provider-only comparison on those same three references, ACL Anthology returned
**3/3 readable copies** with **3/3 correct candidates**. OpenAlex returned **1/3 readable copies**
with **2/2 correct candidates**. One paper was readable through both providers, two only through
ACL Anthology, and none through neither.

### Ten previously reported citations

| Work | Primary-only | Full fallback | Full-pipeline result |
| --- | --- | --- | --- |
| LLM Multi-Agent Systems: Challenges and Open Problems (2024) | readable | readable | arXiv PDF |
| Confusing Claims for Data (2014) | no accessible copy | no accessible copy | Unresolved by checked sources |
| The Coding Manual for Qualitative Researchers (2009) | readable | readable | Semantic Scholar PDF |
| A Collective Self-Esteem Scale (1992) | no accessible copy | no accessible copy | Unresolved by checked sources |
| Social Identity and Leadership Processes in Groups (2003) | blocked | no accessible copy | Alternate sources found no readable copy |
| Intergroup Bias (2002) | blocked | no accessible copy | Alternate sources found no readable copy |
| The Transformation of Open Source Software (2006) | invalid content | no accessible copy | Alternate sources found no readable copy |
| Business Firms' Engagement in Community Projects (2007) | no accessible copy | no accessible copy | Unresolved by checked sources |
| The Single-Vendor Commercial Open Course Business Model (2012) | no accessible copy | no accessible copy | Unresolved by checked sources |
| Challenges of Open Innovation (2006) | no accessible copy | no accessible copy | Unresolved by checked sources |

The full pipeline read **2/10** works. The fallback step did not add a third readable work in this
sample. It tried the configured Unpaywall, ACL Anthology, and OpenAlex routes after initial lookup or
download failures; those services did not return a readable copy for the remaining eight in these
runs. This is not proof that no copy exists anywhere, nor does it imply that paywalled books and
articles can be downloaded.

Full-pipeline attempt outcomes by provider:

| Provider | Attempt outcomes |
| --- | --- |
| ACL Anthology | 8 no matches |
| arXiv | 1 match, 1 no match, 2 not found, 1 readable PDF |
| OpenAlex | 8 no accessible copies |
| Semantic Scholar | 4 matches, 5 no accessible copies, 2 blocked, 1 invalid content, 1 readable PDF |
| Unpaywall | 1 match, 7 no accessible copies |

For context, the separate OpenAlex-only run read **1/10** and had **1/1 correct candidates**. The
full-pipeline score is higher because it also uses the initial Semantic Scholar and arXiv routes.

## Offline implementation check

The mocked benchmark reports **0/3 primary-only** versus **3/3 fallback-enabled** for its seeded
recovery cases. This confirms that the fallback code path can recover readable, identity-matching
copies when a fixture supplies one. The live ACL comparison confirms the same behavior on real
public records; the ten user-reported works show that fallback cannot overcome the absence of an
accessible copy from the sources checked.

The focused backend tests passed: **102 passed**.

## Scope and reproduction

The historical ten-paper / 86-failure dataset referred to in GitHub issue #993 is not present in the
repository. The ten-work manifest here is a transparent replacement sample assembled from the
citations previously reported by the user; it is not represented as the same historical dataset.

Run from `backend/`:

```sh
python bench_source_resolution.py
python bench_source_resolution_live.py --manifest fixtures/source_resolution_live_manifest.json
python bench_source_resolution_live.py --pipeline --manifest fixtures/source_resolution_live_manifest.json
python bench_source_resolution_live.py --pipeline --manifest fixtures/source_resolution_reported_live_manifest.json
```

The live runs contact public source providers and download PDFs temporarily. They do not store the
response bodies or raw provider URLs in the report. The final paired runs were at `2026-11-16 08:52:23 UTC`
(ACL corpus) and `2026-11-16 08:55:25 UTC` (ten-work corpus).

The live harness is [bench_source_resolution_live.py](../../backend/bench_source_resolution_live.py).
The compared corpora are [source_resolution_live_manifest.json](../../backend/fixtures/source_resolution_live_manifest.json)
and [source_resolution_reported_live_manifest.json](../../backend/fixtures/source_resolution_reported_live_manifest.json).
