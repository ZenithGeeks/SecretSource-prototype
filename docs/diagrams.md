# SecretSource — ER Diagram

The data model, as Mermaid so GitHub renders it. Two views: the **logical model** (how the
domain is normalized) and the **physical storage** (how the gateway actually keeps it). PNG
copies are in [`docs/img/`](img/): [logical](img/er-logical.png) · [physical](img/er-physical.png).

## Logical model (normalized)

Third normal form. The paper↔project many-to-many is resolved by the **PROJECT_PAPER** join
entity; a **REFERENCE** (an in-text citation) resolves to a deduplicated **SOURCE**; each
(claim, source) pair yields one **VERDICT**.

```mermaid
erDiagram
  USER ||--o{ PAPER : analyses
  USER ||--o{ PROJECT : owns
  PROJECT ||--o{ PROJECT_PAPER : contains
  PAPER ||--o{ PROJECT_PAPER : "filed in"
  PAPER ||--o{ CLAIM : makes
  CLAIM ||--o{ REFERENCE : cites
  REFERENCE }o--|| SOURCE : "resolves to"
  CLAIM ||--o{ VERDICT : "judged in"
  SOURCE ||--o{ VERDICT : gives

  USER {
    int id PK
    string email
    string display_name
    string role
  }
  PAPER {
    int id PK
    int user_id FK
    string title
    string status
    datetime analysed_at
  }
  PROJECT {
    int id PK
    int user_id FK
    string name
  }
  PROJECT_PAPER {
    int project_id FK
    int paper_id FK
  }
  CLAIM {
    int id PK
    int paper_id FK
    string text
    string section
  }
  REFERENCE {
    int id PK
    int claim_id FK
    int source_id FK
    string marker
  }
  SOURCE {
    int id PK
    string title
    int year
    string doi
    boolean indexed
  }
  VERDICT {
    int id PK
    int claim_id FK
    int source_id FK
    string relation
    string quote
    string page
  }
```

## Physical storage (Supabase, as built)

The gateway stores each analysis as one JSON document rather than the normalized tables above —
it reads and writes whole analyses. So the logical entities (CLAIM, REFERENCE, VERDICT …) live
**inside** `analyses.data`. Three blob tables in `public` plus the ADK-managed `adk` schema for
chat sessions.

```mermaid
erDiagram
  analyses {
    text id PK
    timestamptz started
    jsonb data "claims, references, verdicts, owner"
  }
  sources {
    text key PK
    jsonb data "resolved cited-work lookup (cache)"
  }
  projects {
    text id PK
    text owner
    jsonb data "name + analysis ids"
  }
  adk_sessions {
    text id PK
    text user_id
    json app_state "ADK-managed, adk schema"
  }
```

> No DB-level foreign keys: rows are opaque JSON, access is filtered in the gateway (analyses by
> the `owner` inside `data`, projects by the `owner` column). RLS is on with no policies; the
> gateway connects with the service role.
