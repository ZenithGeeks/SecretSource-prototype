# Understanding experiment results

The output from `examples.run_all` is a small, architecture-focused summary.
It is not the complete ServiceNow AgentArch benchmark. The current harness is
offline and uses deterministic mock agents, so it measures execution behavior
and information flow. It does not pretend that a mock verdict is scientific
ground truth.

## Quick start

From `agent-arch/`:

```text
py -m agent_arch_experiments.examples.run_all
```

To print the complete structured result, including the final result,
architecture metadata, and every trace event:

```text
py -m agent_arch_experiments.examples.run_all --trace
```

The trace output is JSON printed after the summary table. It is useful for
checking delegation and information flow, not just for counting calls.

By default, `run_all` runs the complete four-case fixture suite. To see the
case IDs without running them:

```text
py -m agent_arch_experiments.examples.run_all --list-cases
```

To run only one case:

```text
py -m agent_arch_experiments.examples.run_all --case sample-method-c-002
```

The current cases are:

| Case ID | Scenario | Mock fixture verdict |
| --- | --- | --- |
| `sample-method-a-001` | Directly supported numerical comparison. | `supported` |
| `sample-method-c-002` | Numerical result contradicts the claim. | `refuted` |
| `sample-method-a-003` | Narrow evidence is overgeneralized. | `partially_supported` |
| `sample-method-z-004` | Supplied source lacks the claimed comparison. | `insufficient_evidence` |

The fixture verdict column only checks that the deterministic mock agents and
architecture synthesis behave as configured. It is not a paper-quality label
and must not be reported as scientific accuracy.

## What the summary table means

Example output:

```text
Architecture                       Calls  Steps  Time (s)  Status
-------------------------------------------------------------------------
magentic_team                          9     30    0.0007  success
hierarchical_langgraph                12     41    0.0745  success
blackboard_team                        4     17    0.0022  success
magentic_context_isolation             9     33    0.0007  success
```

The exact time will change between runs. The call and step counts should be
stable for the current deterministic implementation. The command prints one
table like this per case, followed by a descriptive aggregate table when more
than one case is selected.

| Column | Meaning | What it does not mean |
| --- | --- | --- |
| `Architecture` | The architecture runner that handled the same sample task. | A quality ranking. |
| `Calls` | Number of normalized `Agent.run(task, context)` calls. It includes managers, supervisors, workers, and finalizers. | Number of tokens, API requests, or tool calls made by a future model. |
| `Steps` | Number of structured `TraceEvent` records emitted by that architecture. Delegation, routing, context creation, blackboard access, and agent lifecycle events can all count. | Number of graph edges, reasoning steps, or correct decisions. |
| `Time (s)` | Local elapsed wall-clock time measured by the harness. | A reliable performance comparison across machines, Python versions, or model providers. |
| `Status` | Whether the architecture returned a successful `ArchitectureResult`. | Whether the scientific claim is actually correct. |

The table intentionally stays small. `evaluation.metrics.summarize_result`
also makes these control-flow fields available to a later evaluator:

- `repeated_calls`: additional calls to an agent role after its first call;
- `trace_length`: the number of trace events, equivalent to `Steps` here;
- `participating_agents`: the distinct roles that participated;
- `architecture_name`, `success`, and `execution_time`.

The aggregate table averages calls, steps, and elapsed time over successful
case runs. `Mock match` is the count of fixture-label matches; it is included
only as an offline wiring check, not as an accuracy metric.

## Why the four rows differ

The same task and the same provider are used for every row. Differences come
from the architecture topology and its explicit instrumentation.

### A1: `magentic_team`

The offline Magentic-style coordinator calls the team lead to create a plan,
routes the three workers, and calls the lead again to synthesize the result.
Earlier worker results are visible to later workers. The additional calls are
manager calls, not extra specialist roles.

### A2: `hierarchical_langgraph`

The root supervisor routes to compiled evidence and verification subgraphs.
Sub-team supervisors then route to their workers before control returns to the
root and the finalizer. More calls and trace events are expected because the
hierarchy itself is being exercised and recorded.

### A3: `blackboard_team`

The three workers read and write one structured in-process blackboard, then a
synthesizer reads the completed board. There is no Magentic manager in this
architecture. Blackboard reads, writes, versions, findings, and provenance
are visible in the trace and result metadata.

### A4: `magentic_context_isolation`

A4 has the same three worker roles and manager loop shape as A1. Each worker
gets a newly built allow-listed context and cannot see peer results. The
manager receives all worker results for final synthesis. The extra context
events are evidence that the isolation boundary was created and audited.

Matching call counts between A1 and A4 are expected. That is useful for the
controlled experiment: the principal intended difference is open peer-result
visibility versus isolated worker contexts.

## What to inspect in `--trace` output

Every architecture returns the same `ArchitectureResult` envelope. Important
fields are:

| Result field | How to use it |
| --- | --- |
| `final_result.verdict` | The mock agent's normalized final label, such as `supported`. Treat it as a behavior check until labels are compared with real ground truth. |
| `final_result.confidence` | The mock final confidence. It is not calibrated model confidence. |
| `final_result.evidence` | Evidence attached to the final result. Later this can be compared with labeled evidence spans. |
| `final_result.findings` | Human-readable normalized findings returned by the final agent. |
| `number_of_agent_calls` | Same quantity shown as `Calls`. |
| `execution_steps` | Same quantity shown as `Steps`. |
| `participating_agents` | Roles that participated in the run. |
| `trace` | Ordered events explaining who routed, delegated, read, wrote, started, finished, or finalized. |
| `metadata` | Architecture-specific evidence, such as A2's Mermaid graph, A3's blackboard snapshot, or A4's context audits. |

Useful architecture-specific trace events include:

- A1: `plan_created`, `supervisor_selected_agent`, `delegated_task`, and
  `worker_output_shared`;
- A2: `supervisor_selected_agent`, `subteam_selected`, and
  `subteam_completed`;
- A3: `blackboard_read`, `blackboard_write`, and the board version in event
  metadata;
- A4: `context_created`, `worker_output_returned`, and the
  `peer_results_visible: false` audit metadata.

For A4, the context audit is an application-visible isolation check. It does
not make a claim about hidden chain-of-thought or internal model state.

## What this harness measures today

These metrics are available without an external model or labeled dataset:

1. Completion: did the architecture produce an `ArchitectureResult`?
2. Control flow: calls, trace steps, repeated role calls, elapsed time, and
   participating roles.
3. Delegation topology: manager-to-worker, root-to-sub-team-to-worker, or
   worker-to-blackboard interactions.
4. Information flow: whether peer results are exposed, stored in structured
   blackboard state, or excluded from an isolated worker context.
5. Output structure: verdict, confidence, evidence, findings, metadata, and
   trace provenance.
6. Optional-dependency behavior: an architecture can be reported as
   unavailable instead of silently being removed from the comparison.

These are architecture validation measurements. They answer questions such
as “did A2 really route through a sub-team?” and “did A4 exclude A's result
from B's context?” They do not answer “which architecture verifies papers
most accurately?”

## What ServiceNow AgentArch can measure

The official [ServiceNow AgentArch repository](https://github.com/ServiceNow/AgentArch)
is a separate, model-backed benchmark application. Its published benchmark
uses configured use cases, tool calls, agent/orchestrator traces, and ground
truth. Its current README describes these groups of measurements:

### Outcome and acceptable-score metrics

An acceptable result combines several requirements, including the correct
final outcome, expected tool/agent selection, and correct tool arguments. The
official implementation exposes record-level fields such as:

- correct final outcome;
- strict and lenient tool-order correctness;
- correct tool-argument percentage;
- missing and extraneous tools;
- optimal-path status;
- orchestrator agent-selection correctness for multi-agent modes.

### Reliability and behavioral metrics

The benchmark also reports or supports:

- Pass@K and Pass^K over repeated attempts;
- tool or agent repetition;
- hallucinated tool or agent selection;
- custom-tool and thinking-tool counts;
- overall failure rate and performance statistics.

The source for the record-level score fields is the official
[`agent_arch/metrics.py`](https://github.com/ServiceNow/AgentArch/blob/main/agent_arch/metrics.py).
The repository README also describes the benchmark's architectural dimensions:
orchestration strategy, agent implementation style, memory management, and
thinking-tool integration.

## Why those AgentArch metrics are not in the table yet

The current SecretSource harness deliberately does not fabricate them:

- Our mock agents return `AgentResult`; they do not emit AgentArch's expected
  tool-call records and tool arguments.
- The sample task has no labeled AgentArch-style ground-truth object for
  expected tool order, arguments, or final response matching.
- The three mock specialist outputs are deterministic, so repeated runs do
  not provide meaningful model reliability estimates.
- No real model provider is running, so token usage, API cost, latency per
  model call, and provider failure rates are unavailable.
- Scientific metrics need labels. Verdict accuracy, Macro-F1, evidence
  precision/recall/F1, citation accuracy, quantitative accuracy, Brier score,
  and ECE should be added only after a ground-truth scientific dataset exists.

The local `evaluation/agentarch/adapter.py` therefore produces an
AgentArch-like record for a future bridge, but explicitly marks native
AgentArch metrics as unavailable. It is an adapter, not the official
benchmark runner.

## How to compare architectures fairly

Use the current table and trace to validate architecture behavior first. For
an accuracy or reliability claim later, keep these variables fixed:

- task and retrieved evidence;
- agent roles and prompts;
- model and model parameters;
- tools and tool schemas;
- stopping limits and retry policy;
- number of trials and random seeds;
- ground-truth labels and scoring code.

Then add metrics in stages:

1. Add a labeled expected verdict and evidence/citation annotations.
2. Run every architecture over the same task set and trials.
3. Score final verdicts and evidence selection.
4. Add model usage data for token and cost comparisons.
5. Use Pass@K/Pass^K only when repeated model trials are genuinely varied.

Do not conclude that A3 is better because it has fewer calls, or that A2 is
worse because it has more steps. Those counts describe architectural work;
quality and cost must be measured with the same task set and model-backed
execution.

## Reading the current sample result

For the sample output above and the four-case run, the safe interpretation is:

- all four architectures completed the same four offline fixture cases;
- A1 and A4 used the same number of normalized agent calls, supporting their
  comparability;
- A2 recorded more calls because supervisors and subgraphs are explicit;
- A3 used three parallel specialist calls plus one synthesis call;
- the different fixture verdicts exercise supported, refuted, partial, and
  missing-evidence output paths;
- the timing values only show local execution overhead for deterministic
  Python code;
- neither the fixture matches nor any row proves that the claim is scientifically supported or
  that one architecture is superior.
