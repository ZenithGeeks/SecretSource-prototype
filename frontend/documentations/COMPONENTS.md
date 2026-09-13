# SecretSource frontend — component guide

What to reuse, what each thing is, and how to add a new role screen without stepping on
anyone. Everything here maps to the Figma **Components** and **Brand** pages.

- Figma Components: `node-id=1-19`
- Figma Brand (palette + type): `node-id=26-1236`
- Stack: React 19, Vite, TypeScript, Tailwind v4 (tokens in `index.css`), TanStack Query,
  lucide-react icons, **Cytoscape** (graph), **Supabase** (auth + persistence), oxlint.

## Golden rules

1. **Reuse before you build.** Primitive already exists → use it. Don't re-create buttons,
   badges, cards, the sidebar.
2. **Colours come from tokens, never hex.** Use `text-accent`, `bg-surface`, … (see Tokens).
   No `#6A2E6F` in components — light/dark both break if you hardcode.
3. **Your role lives in `src/roles/<role>/`.** Screens, and a `<Role>App` that wires them.
   Wiring a new role touches two shared files: `screens/Onboarding.tsx` (the `Role` union +
   the `ROLES` array) and `Root.tsx` (the `Screen` union, `initialScreen()`'s allow-list, and
   the render case). See the checklist for the exact edits.
4. **No hardcoded data in screens.** Data comes through a hook → client → mock (see Data layer).

## Folder map

```
src/
├─ main.tsx             entry: QueryClient + providers, applyTheme() bootstrap
├─ App.tsx              the analysis app, shown at ?role=app
├─ Root.tsx             auth gate → onboarding → role app / analysis app
├─ index.css            design tokens (see Tokens — four blocks, incl. data-theme)
├─ vite-env.d.ts · assets/
├─ components/          shared UI
│  ├─ ui.tsx              Button, Input, Card, VerdictBadge, StandingBadge, Empty
│  ├─ Brand.tsx           logo + wordmark (sidebar + hero)
│  ├─ AppShell.tsx        sidebar layout: nav items + role chip (Figma NavItem + RoleChip)
│  └─ AnalysisView, ClaimCard, HistoryList, PageViewer, PipelineStages,
│     ResultsSummary, SubmitForm — the analysis UI. Built for ?role=app, but the
│     researcher role reuses AnalysisView / SubmitForm / HistoryList on its History
│     screen — so treat them as shared, not app-only.
├─ screens/
│  ├─ Onboarding.tsx      role picker (Figma 05 Onboarding)
│  └─ auth/Auth.tsx       sign in / sign up / forgot / reset / check-email (Supabase Auth)
├─ roles/                 one folder per role — no cross-role imports
│  ├─ researcher/         ResearcherApp + screens/ (Home, Library, FieldConsensus, Graph, History, Settings)
│  ├─ writer/             WriterApp + screens/ (Home, DraftCheck, FindASource, CitationReplaced)
│  └─ teacher/            TeacherApp + screens/ (Home, EssayCheck)
├─ lib/
│  ├─ api.ts              gateway client for the analysis app
│  ├─ supabase.ts         Supabase browser client (auth)      · useAuth.ts   live session
│  ├─ settings.ts         account settings store (localStorage) + useSettings + applyTheme
│  ├─ researcher.ts / writer.ts / teacher.ts   per-role typed clients (read through the store)
│  ├─ useResearcher.ts / useWriter.ts / useTeacher.ts   per-role query hooks
│  │                       (+ useResearcherActions / writer actions — mutations; teacher has none yet)
│  ├─ researcherStore.ts / writerStore.ts   in-session mutable stores (teacher not converted yet)
│  └─ claims.ts · useAnalysis.ts · utils.ts (cn)
└─ mocks/<role>.ts        per-role mock payloads (until gateway endpoints exist)

supabase/  (repo root, NOT under frontend/) — DB migrations + README. Server-only:
           the gateway connects with SUPABASE_SERVICE_ROLE_KEY from backend/.env; that
           key never goes in the frontend. Only the anon key + URL (VITE_*) are safe here.
```

## Tokens (Figma "Brand" palette → CSS variable)

Defined in `src/index.css`, which now has **four** blocks: `@theme` (light baseline),
`@media (prefers-color-scheme: dark) :root:not([data-theme])` (auto-dark when the OS is dark
and no manual choice), `:root[data-theme='dark']` and `:root[data-theme='light']` (the manual
Settings → Theme override). Use the Tailwind utility, not the hex.

> ⚠️ A new token must be defined in **both** dark blocks — the media query *and*
> `:root[data-theme='dark']`. If you add it to only the `@theme`/media pair, anyone who forced
> **Dark** in Settings silently gets its light value.

| Figma name   | Hex (light) | CSS var / Tailwind class            | Use for |
|--------------|-------------|-------------------------------------|---------|
| Ink          | `#1E1A22`   | `--color-ink` → `text-ink`          | primary text |
| Pencil       | `#6B6370`   | `--color-ink-muted` → `text-ink-muted` | secondary text |
| Plum         | `#6A2E6F`   | `--color-accent` → `text-accent` `bg-accent` | brand, links, primary button |
| Plum wash    | `#F1E4F2`   | `--color-accent-soft` → `bg-accent-soft` | active nav, chips, soft fills |
| Paper        | `#F7F3EC`   | `--color-canvas` → `bg-canvas`      | page background |
| Page         | `#FFFDF9`   | `--color-surface` → `bg-surface`    | cards, panels |
| Rule         | `#E4DDD1`   | `--color-border-subtle` → `border-border-subtle` | borders, dividers |
| Backed       | `#2F6B45`   | `--color-supports` → `text-supports` | supports / backed verdict |
| Contradicted | `#A33A2E`   | `--color-refutes` → `text-refutes`  | refutes / contradicted |
| Silent       | `#8A6414`   | `--color-insufficient` → `text-insufficient` | insufficient / silent |

Each verdict colour also has a `-soft` fill: `bg-supports-soft`, `bg-refutes-soft`,
`bg-insufficient-soft`. Dark mode is automatic (OS) and can be forced: Settings → Theme sets
`data-theme="light|dark"` on `<html>` (via `applyTheme` in `lib/settings.ts`), which
`index.css` overrides read. Always use the token class — light/dark/forced all just work.

## Typography

Figma uses two families:

- **Fraunces** — display, headings, wordmark (SemiBold); and **italic** for quoted passages
  from papers (the evidence itself).
- **Geist** — interface, body, data.

In code: headings/wordmark/quotes use `font-serif`, body uses the default sans (`font-sans`).

> ⚠️ **Gap:** the real webfonts (Fraunces, Geist) are **not loaded yet** — we fall back to the
> system serif/sans. To match Figma exactly, add the fonts and point `--font-sans` / a
> `--font-serif` at them in `index.css`. Until then, use `font-serif` for the display/quote
> role so the swap is a one-line change later.

## Icons

lucide-react. The Figma `icon/*` names map to lucide component names almost 1:1.

| Figma icon        | lucide            |
|-------------------|-------------------|
| home              | `Home`            |
| library           | `Library`         |
| graph             | `Waypoints`       |
| microscope        | `Microscope`      |
| pen               | `Pen`             |
| graduation        | `GraduationCap`   |
| clock / history   | `History`         |
| settings          | `Settings`        |
| sparkles          | `Sparkles`        |
| search            | `Search`          |
| file-text         | `FileText`        |
| file-up           | `FileUp` / `Upload` |
| check-circle-2    | `CheckCircle2`    |
| chevron-right     | `ChevronRight`    |
| bookmark          | `Bookmark`        |
| copy              | `Copy`            |
| download          | `Download`        |

Usage: `import { Home } from 'lucide-react'` → `<Home className="size-4 text-accent" />`.
Size with `size-4` (16px, the Figma default), colour with a token class.

## Primitives — `src/components/ui.tsx`

### Button `Variant=solid | ghost` (Figma `Button`)
```tsx
import { Button } from '../components/ui'
<Button onClick={…}><Search className="size-4" /> Ask library</Button>   // solid (default)
<Button variant="ghost"><Copy className="size-4" /> Copy</Button>        // ghost
```
Solid = plum fill, white text (primary action). Ghost = muted text, soft hover (secondary).
Takes all native `<button>` props (`type`, `disabled`, `onClick`).

### Input (Figma `Input`)
```tsx
import { Input } from '../components/ui'
<Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by meaning…" />
```
Full-width by default; cap with `className="max-w-xl"`. All native `<input>` props.

### Card
```tsx
import { Card } from '../components/ui'
<Card className="flex-1">…</Card>
```
Surface panel: rounded, subtle border, padding. The default container for grouped content.

### VerdictBadge (Figma `Badge` — Kind=supports/refutes/insufficient)
```tsx
import { VerdictBadge } from '../components/ui'
<VerdictBadge verdict="supports" />   // "refutes" | "insufficient"
<VerdictBadge verdict="refutes" text="contradicts the claim" />
```
The per-source verdict pill (SUPPORTS / REFUTES / INSUFFICIENT), soft fill + verdict colour.
`text` replaces the verdict name; the claim card uses it to say what the cited paper does to
the claim.

### StandingBadge (Figma `Badge` — Kind=backs/contradicts/silent/unchecked/uncited)
```tsx
import { StandingBadge } from '../components/ui'
<StandingBadge standing="refutes" />  // refutes|insufficient|supports|unchecked|uncited
```
A claim's overall standing in reader words ("source contradicts", "not checked", …).
Only real verdicts get colour; unchecked/uncited stay neutral — an absence isn't a finding.

### Empty
```tsx
import { Empty } from '../components/ui'
<Empty title="Nothing yet" hint="Give a DOI or arXiv ID to start." />
```
Dashed empty-state box for "no data" placeholders.

> **Stamps** (Figma: big BACKED / CONTRADICTED / SILENT) are **not** these badges — they're
> for share cards / exports / the verdict header, never small UI. Not built yet; build only
> when a share-card feature needs them.

## Brand — `src/components/Brand.tsx`
```tsx
import { Brand } from '../components/Brand'
<Brand />        // sidebar: mark + wordmark + tagline
<Brand hero />   // onboarding/landing: larger mark + wordmark, no tagline
```
Wordmark is two-tone: "Secret" in ink, "Source" in italic plum. Don't hand-roll the wordmark
elsewhere — use this.

## AppShell — `src/components/AppShell.tsx` (Figma NavItem + RoleChip)

The signed-in layout: brand + nav sidebar, role chip at the bottom, your content in `main`.
Role-agnostic — you pass your nav and role.

```tsx
import { AppShell, type NavEntry } from '../../components/AppShell'
import { Home, Library, Microscope } from 'lucide-react'

const NAV: NavEntry<'home' | 'library'>[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'library', label: 'Library', icon: Library },
]

<AppShell
  nav={NAV}
  active={active}                 // which nav key is lit
  onNavigate={setScreen}         // (key) => void
  role="Researcher"
  roleIcon={Microscope}
  onChangeRole={() => …}         // "change" link → back to onboarding
>
  {/* current screen */}
</AppShell>
```

Active nav item gets the plum-wash background automatically. Nav is data-driven — add/remove
entries in the array.

## Screen composition (how a role fits together)

```
Root.tsx
 └─ <ResearcherApp>            role router: holds current screen, deep-links via ?screen=
     └─ <AppShell nav=… active=…>
         └─ <Home /> | <FieldConsensus /> | <Library />   ← your screens
```

Each screen is a plain component that renders its content (no sidebar — the shell owns that)
and reads data from a hook.

## Data layer (no hardcoded data; backend-ready)

Four files, one direction. Both reads **and** writes go through the in-session store — that's
what makes a created item show up after invalidation:

```
mocks/<role>.ts     payloads shaped like the future gateway response
   ↓ (seeds)
lib/<role>Store.ts  in-session mutable store, seeded from the mocks
   ↓ (client reads AND writes the store)
lib/<role>.ts       typed client; each call reads the store, notes its TODO endpoint
   ↓
lib/use<Role>.ts    TanStack Query hooks the screens call
   ↓
screens             read data only through the hook
```

Reads already resolve from the store, e.g. `researcher.ts` — `getHome: async () =>
store.home()`, `getProjects: async () => store.projects()`, `getLibrary: (id) =>
store.library(id)`. Wiring the real backend later = swap each store call for a `request(...)`:
```ts
// TODO gateway: GET /researcher/home
getHome: async (): Promise<ResearcherHome> => store.home(),
// →
getHome: () => request<ResearcherHome>('/researcher/home'),
```
Types, hooks and screens don't change.

> **Not every role uses a store.** Researcher and writer do (`researcherStore.ts`,
> `writerStore.ts`) with `useResearcherActions` / writer actions. **Teacher is not converted
> yet** — `teacher.ts` returns the mocks directly and `useTeacher.ts` has no actions. Copy the
> researcher trio when a role gains create/add.

### Mutations (create / add / edit) — in-session store

Writes go through `use<Role>Actions()`, which mutates the store and **invalidates** the affected
TanStack Query keys so screens re-render. Live researcher mutations today:

```ts
const { createProject, fileQueuePaper } = useResearcherActions()
createProject('Retrieval survey')   // Library.tsx → ['researcher','projects'] invalidated → new project appears
fileQueuePaper(title)               // Home.tsx → removes it from the reading queue
```

> `researcherStore.addPaper` exists but has **no caller yet**, so the "Unsorted" project is
> currently unreachable — wire `addPaper` before documenting an add-to-project flow.

Swap the store calls for gateway POSTs later; the screens don't change. Each role has its own
store — no cross-role imports.

## Auth (Supabase)

Sign in / sign up / forgot / check-email live in `src/screens/auth/Auth.tsx` (email + password
and **Google** OAuth via Supabase Auth). A fifth **reset** view exists in the component but
**isn't reachable yet**: `resetPasswordForEmail` redirects to `window.location.origin` with no
`?auth=reset`, so supabase-js turns the recovery token into a session and `Root` renders the
app, never `<Auth/>` — the `PASSWORD_RECOVERY` → `setView('reset')` listener lives inside the
skipped component. To wire it, set `redirectTo` to `${origin}?auth=reset`.

- `lib/supabase.ts` — browser client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  `authEnabled` is true only when both are set.
- `lib/useAuth.ts` — `useAuth()` returns the live `{ session, loading }`; `signOut()`.
- `Root.tsx` gates the app: **auth on** → no session shows `<Auth/>`, then onboarding → role.
  **auth off** (env unset) → the app runs open (prototype default).
- `?auth` (any value, or bare `?auth`) is checked **before** the session gate, so it forces the
  Auth screens even for a signed-in user and nothing clears it — signing in from `?auth=signin`
  leaves you pinned on the card until you remove the param by hand. It's a preview switch, not a
  route; drop it in normal use.

Turn it on: set the two `VITE_` vars in `frontend/.env`, and enable the Google provider in the
Supabase dashboard. The anon key is public (safe in the browser). See `frontend/.env.example`.

## Settings & theme

`lib/settings.ts` is a localStorage-backed account-settings store (`useSettings()` +
`updateSettings()` via `useSyncExternalStore`), consumed by `roles/researcher/screens/Settings.tsx`.
Effects that actually apply:

- **Theme** — `applyTheme()` sets `data-theme` on `<html>`; `index.css` has the light/dark
  overrides. Called on load (`main.tsx`) and on change. `?theme=light|dark|system` deep-links.
- **Colour verdict badges** — `VerdictBadge` reads `useSettings().colorBadges` (plain text when off).
- **Display name** feeds the Home greeting; toggles/selects persist across reloads.

## Graph (Cytoscape)

`roles/researcher/screens/Graph.tsx` — the knowledge graph, **Cytoscape + fcose** (chosen over
sigma.js for rich styling/interaction at this scale). Two modes on one canvas: **Claims**
("what rests on what") and **Papers** ("how your library relates"), toggled in the header.

- Cytoscape's style parser rejects `oklch`, so the graph uses **concrete hex** mirroring the
  index.css tokens, with a light/dark set (see `LIGHT`/`DARK` in the file). Keep them in step
  with `index.css` if the palette changes.
- Type shims: `cytoscape-fcose.d.ts`, `react-cytoscapejs.d.ts`.
- Data via `useKnowledgeGraph()` — **global** (all projects/roles), like History.

## Projects (Library)

`roles/researcher/screens/Library.tsx` is project-first: a landing grid of project cards →
open one → its papers (search + cluster filters + table). **New project** opens
`NewProjectDialog` (modal in the same file) and calls `createProject`. An **Unsorted** project
exists in the mock as the intended home for new uploads, but nothing files papers into it yet
(`addPaper` is unwired — see Mutations). Deep-links: `?project=<id>`, `&q=<search>`, `&new=1`.

Modal pattern to reuse: `fixed inset-0 z-50 flex items-center justify-center` + `bg-ink/45`
scrim + a `bg-surface` card; Esc/backdrop cancel, Enter/submit confirms.

## Adding a new role (checklist)

**Researcher is the complete example to copy** — it has all six screen types, a store, and
actions. (Writer is also converted but smaller; teacher has no store/actions yet, and both
have `graph`/`history`/`settings` nav keys that still fall through to the "Not built yet"
`Placeholder` — don't copy those as finished patterns.)

1. `src/roles/<role>/screens/` — build your Figma screens as content-only components.
2. `src/roles/<role>/<Role>App.tsx` — copy `ResearcherApp.tsx`, swap the `NAV` array,
   `role="…"`, `roleIcon={…}`.
3. `src/mocks/<role>.ts` + `src/lib/<role>.ts` + `src/lib/use<Role>.ts` — copy the researcher
   trio, put your payloads + types in. Add `src/lib/<role>Store.ts` + a `use<Role>Actions()`
   hook if the role has create/add interactions.
4. Wire it into the two shared routing files:
   - `src/screens/Onboarding.tsx` — add the role to the `Role` union and the `ROLES` array.
   - `src/Root.tsx` — add it to the `Screen` union, to `initialScreen()`'s allow-list, and add
     the render case `<YourRoleApp onChangeRole=… />`.
5. Preview: `npm run dev` → `http://localhost:5173/?role=<role>`.

The **writer** and **teacher** roles are complete working examples to copy from. Reuse
`AppShell`, `Brand`, `ui.tsx`, tokens, lucide. Don't add a second sidebar, button, or CSS system.

## Figma → code index

| Figma component (page)          | Code |
|---------------------------------|------|
| Button (Components)             | `ui.tsx` → `Button` |
| Input (Components)              | `ui.tsx` → `Input` |
| Badge — verdict kinds           | `ui.tsx` → `VerdictBadge` |
| Badge — standing kinds          | `ui.tsx` → `StandingBadge` |
| Brand / Logo Lockup (Brand)     | `Brand.tsx` |
| NavItem + RoleChip (Components) | `AppShell.tsx` |
| Icons (Components)              | lucide-react (table above) |
| Palette (Brand)                 | tokens in `index.css` |
| Type (Brand)                    | `font-serif` (Fraunces) / `font-sans` (Geist) |
| Onboarding + Auth screens       | `screens/Onboarding.tsx`, `screens/auth/Auth.tsx` |
| Knowledge graph                 | `roles/researcher/screens/Graph.tsx` (Cytoscape + fcose) |
| Library + Projects + New-project modal | `roles/researcher/screens/Library.tsx` |
| Settings + theme                | `roles/researcher/screens/Settings.tsx` + `lib/settings.ts` |
| SubmitForm, AnalysisView, HistoryList | analysis components — also reused by researcher's History screen, so shared, not app-only |
| ClaimCard, PageViewer, PipelineStages, ResultsSummary | analysis app (`?role=app`) |
| Stamps (Brand)                  | not built — share-card feature only |

## Shared-file etiquette

`ui.tsx`, `Brand.tsx`, `AppShell.tsx`, `index.css`, `Root.tsx` are shared. Additive changes
only, and call them out in your PR so other roles aren't surprised. Everything role-specific
stays inside your `roles/<role>/` + your own `mocks`/`lib` files.
