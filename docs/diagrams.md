# SecretSource — Diagrams

Every diagram below is Mermaid, so GitHub renders it on this page. Static PNG copies for
slides / the report are in [`docs/img/`](img/).

SecretSource is a multi-agent, multimodal citation-verification tool: give it a paper and it
extracts each claim, finds the works that claim cites, and checks whether those sources actually
support the claim — returning per-claim verdicts, a field-consensus view, and a knowledge graph.

---

## 1. System architecture

```mermaid
flowchart LR
  subgraph Client
    WEB["Web app<br/>React + Vite"]
  end
  subgraph Gateway
    GW["FastAPI gateway<br/>app/main.py"]
    PIPE["Analysis pipeline<br/>extract → resolve → verify → audit"]
    AG["ADK agents<br/>coordinator + specialists"]
  end
  subgraph Retrieval["Retrieval & parsing"]
    GROBID["GROBID<br/>parse PDF → claims, refs"]
    COLBERT["ColBERT<br/>text retrieval"]
    COLPALI["ColPali<br/>page / figure retrieval"]
    QDRANT[("Qdrant<br/>vector store")]
  end
  LLM["vLLM<br/>claim extraction & verdicts"]
  subgraph Data
    SUPA[("Supabase Postgres<br/>analyses · sources · projects · adk")]
    DISK[("Disk<br/>PDFs · figures · page renders")]
  end
  IDX["Public indexes<br/>Semantic Scholar · arXiv · Unpaywall"]

  WEB -- "/api (proxy)" --> GW
  WEB -- "sign in" --> AUTH["Supabase Auth"]
  GW --> PIPE
  GW --> AG
  PIPE --> GROBID
  PIPE --> IDX
  PIPE --> COLBERT --> QDRANT
  PIPE --> COLPALI --> QDRANT
  PIPE --> LLM
  AG --> LLM
  GW --> SUPA
  GW --> DISK
  GW -- "verify token" --> AUTH
```

## 2. Use-case diagram

Researcher / Author / Teacher inherit a base **User**, so the shared use cases apply to every
role. **Graph** and **History** aggregate every role's work — one account can hold several roles.

```mermaid
flowchart TB
  R([Researcher]):::role --> U([User]):::role
  A([Author]):::role --> U
  T([Teacher]):::role --> U

  U --> SI(Sign in) & AN(Analyze a paper) & KG(Knowledge graph) & HI(History) & ST(Settings)
  R --> FC(Field Consensus) & MP(Manage projects)
  A --> CD(Check draft) & FR(Find &amp; replace source)
  T --> MC(Manage classes) & CE(Check essay) & RQ(Reading questions)

  AN -. include .-> VC(Verify claim) -. include .-> RS(Retrieve source)
  CD -. include .-> VC
  CE -. include .-> VC
  VC --- ANL([Analyzer • multi-agent]):::ext
  RS --- IDX([Public indexes]):::ext

  classDef role fill:#F1E4F2,stroke:#6A2E6F,color:#1E1A22;
  classDef ext fill:#EFE9DF,stroke:#6B6370,color:#1E1A22;
```

## 3. Domain model — logical ER (normalized)

The domain in third normal form. The paper↔project many-to-many is resolved by the
**PROJECT_PAPER** join entity; a **REFERENCE** (an in-text citation) resolves to a deduplicated
**SOURCE**; each (claim, source) pair yields one **VERDICT**.

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

## 4. Physical storage (as built, Supabase)

The gateway stores each analysis as one JSON document rather than the normalized tables above —
it reads and writes whole analyses, and it matches the ADK runtime. So the logical entities
(CLAIM, REFERENCE, VERDICT …) live **inside** `analyses.data`. Three blob tables in `public`
plus the ADK-managed `adk` schema for chat sessions.

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

## 5. Analyze-a-paper pipeline (sequence)

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web app
  participant G as Gateway
  participant GR as GROBID
  participant IX as Public indexes
  participant R as ColBERT / Qdrant
  participant L as vLLM
  participant DB as Supabase

  U->>W: submit paper (DOI / arXiv / PDF)
  W->>G: POST /analyses
  G->>GR: parse PDF
  GR-->>G: sections, references
  G->>L: extract claims + citations (per window)
  L-->>G: claims
  loop each cited work
    G->>IX: resolve (Semantic Scholar / arXiv / Unpaywall)
    IX-->>G: PDF / metadata
    G->>R: index passages
  end
  loop each claim × source
    G->>R: retrieve top passages
    G->>L: verdict (supports / refutes / insufficient) + quote
    L-->>G: verdict
  end
  G->>G: audit verdicts (quote real?)
  G->>DB: save analysis
  G-->>W: stream stages (SSE) → results
```

## 6. Multi-agent architecture

```mermaid
flowchart TB
  COORD["Coordinator agent"]
  subgraph Specialists
    RAG["rag_agent<br/>retrieve + read sources"]
    VER["verify_agent<br/>rule on the claim"]
    SRC["source_agent<br/>find the cited work"]
  end
  TOOLS["Retrieval tools<br/>ColBERT · ColPali (MCP)"]
  MEM[("ADK session / memory<br/>Supabase adk schema")]
  A2A["A2A server<br/>exposes the agent tree"]

  COORD -- AgentTool --> RAG
  COORD -- AgentTool --> VER
  COORD -- AgentTool --> SRC
  RAG --> TOOLS
  SRC --> TOOLS
  COORD --- MEM
  A2A --- COORD
```

## 7. Analysis lifecycle (state)

```mermaid
stateDiagram-v2
  [*] --> extracting
  extracting --> planned: claims found
  extracting --> error: parse failed
  planned --> verifying: sources resolved
  verifying --> audited: all checks done
  audited --> done
  verifying --> error: run interrupted
  done --> [*]
  error --> [*]
```

## 8. Authentication & per-user access

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web app
  participant AU as Supabase Auth
  participant G as Gateway
  participant DB as Supabase DB

  U->>W: sign in (email / Google)
  W->>AU: authenticate
  AU-->>W: session + access token
  W->>G: request + Bearer token
  G->>AU: verify token → user id
  AU-->>G: user id
  G->>DB: read/write with service role
  DB-->>G: only this user's analyses / projects
  G-->>W: data
  Note over W,G: no token → 401 → app signs out
```

## 9. Deployment (Docker Compose services)

```mermaid
flowchart TB
  subgraph Public
    web["web (nginx)"]
    gateway["gateway (FastAPI)"]
    mcp["secretsource-mcp"]
  end
  subgraph Private["Private / IAM-only"]
    grobid["grobid"]
    colbert["colbert"]
    colpali["colpali"]
    qdrant[("qdrant")]
    vllm["vllm"]
    adkweb["adk-web"]
  end
  ext[("Supabase<br/>Postgres + Auth")]

  web --> gateway
  gateway --> grobid & colbert & colpali & vllm & adkweb
  colbert --> qdrant
  colpali --> qdrant
  gateway --> ext
  mcp --> gateway
```
