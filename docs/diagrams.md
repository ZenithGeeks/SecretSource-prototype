# SecretSource — Diagrams

GitHub renders the Mermaid blocks below automatically — edit the code fences to update.
Static PNG copies (for slides / the report) live in [`docs/img/`](img/): [use-case](img/usecase.png) · [ER](img/er.png).

## Use-case diagram

Roles inherit a shared **User** actor, so every role gets the shared use cases
(**Analyze a paper, Knowledge graph, History, Sign in, Settings**). Graph and History
aggregate every role's work — one account can hold several roles.

```mermaid
flowchart TB
  R([Researcher]):::role --> U([User]):::role
  A([Author]):::role --> U
  T([Teacher]):::role --> U

  U --> SI(Sign in) & AN(Analyze a paper) & KG(Knowledge graph) & HI(History) & ST(Settings)
  R --> FC(Field consensus) & MP(Manage projects)
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

## ER diagram

Conceptual (normalized) domain model. The implementation stores it as JSON blobs
(`analyses.data`, `sources`, `projects`) plus the `adk` session schema — a deliberate
build-speed vs. queryability trade-off.

```mermaid
erDiagram
  USER ||--o{ ANALYSIS : owns
  USER ||--o{ PROJECT : owns
  USER ||--o{ SESSION : has
  PROJECT }o--o{ ANALYSIS : groups
  ANALYSIS ||--o{ CLAIM : contains
  CLAIM ||--o{ CITATION : cites
  CLAIM ||--o{ VERDICT : has
  CITATION }o--|| SOURCE : "resolves to"
  VERDICT }o--|| SOURCE : "judged against"

  USER {
    string id PK
    string email
    string display_name
    string role
  }
  ANALYSIS {
    string id PK
    string owner FK
    string paper_title
    string status
    datetime started
  }
  CLAIM {
    string id PK
    string analysis_id FK
    string text
    string section
  }
  CITATION {
    string id PK
    string claim_id FK
    string marker
    string raw_ref
  }
  VERDICT {
    string id PK
    string claim_id FK
    string source_key FK
    string relation
    string quote
    string page
  }
  SOURCE {
    string key PK
    string title
    string year
    string indexed
  }
  PROJECT {
    string id PK
    string owner FK
    string name
  }
  SESSION {
    string id PK
    string user_id FK
    json app_state
  }
```
