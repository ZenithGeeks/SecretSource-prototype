# ServiceNow AgentArch integration

The Downloads reference contained an AgentArch mapping document, but no
upstream AgentArch source was present in this repository’s `agent-arch/`
directory. The official ServiceNow repository is a separate benchmark
application with configuration files, a CLI, use cases, traces, ground truth,
and metrics. It is not exposed as a generic
`AgentArchEvaluator(my_architecture)` API.

The local integration is therefore deliberately an adapter:

```text
Task + ArchitectureResult + TraceEvent
                 │
                 ▼
evaluation/agentarch/adapter.py
                 │
                 ▼
AgentArch-like record for a later ingestion/benchmark bridge
```

The adapter emits `id`, `user_utterance`, optional `ground_truth`, architecture
metadata, and `record_history` from the structured local trace. It labels the
record as adapted and sets native AgentArch metric availability to false.

Directly observable local metrics are agent calls, execution steps, repeated
calls, trace length, participating agents, elapsed time, and success/failure.
AgentArch-inspired or ground-truth-dependent metrics include acceptable score,
Pass@1, Pass^K, tool selection accuracy, and scientific verdict accuracy. They
are extension points only until compatible datasets and ground truth exist.

The adapter contains no AgentArch source and does not modify or depend on the
parent repository. To run the actual ServiceNow benchmark, use the upstream
AgentArch installation and its documented CLI separately, then map compatible
records explicitly rather than treating this adapter as a native plugin.
