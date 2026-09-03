# Replacing the mock agents

The swap point is intentionally one function:

```text
agents/provider.py
    └── build_agents()
            └── MockAgent objects today
```

Later:

```text
agents/provider.py
    └── build_agents()
            └── real research-verification agents
```

The replacement registry maps role names to objects implementing the common
contract:

```python
class ResearchAgent:
    name = "evidence_verifier"
    role = "evidence_verifier"

    async def run(self, task: Task, context: AgentContext) -> AgentResult:
        return AgentResult(
            agent=self.name,
            verdict="supported",
            confidence=0.9,
            evidence=tuple(...),
            findings=("...",),
        )
```

If the real implementation has a different method or result shape, adapt it
inside `provider.py` or a provider-local adapter. Do not add model imports to
the architecture folders.

For A1/A4, preserve the three worker role keys and comparable configuration
when measuring context flow. For A2, preserve the worker roles while keeping
the hierarchy’s supervisor keys. For A3, ensure returned evidence and findings
can be published to the structured blackboard.

No PDF parsing, retrieval, model client, or authentication belongs in this
research harness unless it is deliberately introduced as a controlled variable
later.
