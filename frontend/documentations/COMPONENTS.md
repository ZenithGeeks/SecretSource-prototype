# SecretSource frontend — component guide

What to reuse, what each thing is, and how to add a new role screen without stepping on
anyone. Everything here maps to the Figma **Components** and **Brand** pages.

- Figma Components: `node-id=1-19`
- Figma Brand (palette + type): `node-id=26-1236`
- Stack: React 19, Vite, TypeScript, Tailwind v4 (tokens in `index.css`), TanStack Query,
  lucide-react icons, oxlint.

## Golden rules

1. **Reuse before you build.** Primitive already exists → use it. Don't re-create buttons,
   badges, cards, the sidebar.
2. **Colours come from tokens, never hex.** Use `text-accent`, `bg-surface`, … (see Tokens).
   No `#6A2E6F` in components — light/dark both break if you hardcode.
3. **Your role lives in `src/roles/<role>/`.** Screens, and a `<Role>App` that wires them.
   The only shared file you edit is one line in `Root.tsx`.
4. **No hardcoded data in screens.** Data comes through a hook → client → mock (see Data layer).

## Folder map

```
src/
├─ components/          shared, every role uses these
│  ├─ ui.tsx              Button, Input, Card, VerdictBadge, StandingBadge, Empty
│  ├─ Brand.tsx           logo + wordmark (sidebar + hero)
│  └─ AppShell.tsx        sidebar layout: nav items + role chip (Figma NavItem + RoleChip)
├─ screens/
│  └─ Onboarding.tsx      role picker (Figma 05 Onboarding)
├─ roles/
│  └─ researcher/         one folder per role — no cross-role imports
│     ├─ ResearcherApp.tsx  role router (screen state) inside AppShell
│     └─ screens/           Home, FieldConsensus, Library
├─ lib/
│  ├─ api.ts              gateway client for the analysis app (existing)
│  ├─ researcher.ts       researcher types + client (mock-backed)
│  ├─ useResearcher.ts    researcher query hooks
│  └─ utils.ts            cn() — class merge
├─ mocks/
│  └─ researcher.ts       researcher mock payloads (backend not built yet)
└─ Root.tsx             role switch (onboarding → role app / analysis app)
```

## Tokens (Figma "Brand" palette → CSS variable)

Defined in `src/index.css` (`@theme` = light; `@media (prefers-color-scheme: dark)` = dark).
Use the Tailwind utility, not the hex.

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
`bg-insufficient-soft`. Dark mode is automatic — use the class and it just works.

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
```
The per-source verdict pill (SUPPORTS / REFUTES / INSUFFICIENT), soft fill + verdict colour.

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

Three files, one direction:

```
mocks/<role>.ts     payloads shaped like the future gateway response
   ↓
lib/<role>.ts       typed client; each call returns a mock today, notes its TODO endpoint
   ↓
lib/use<Role>.ts    TanStack Query hooks the screens call
   ↓
screens             read data only through the hook
```

Wiring the real backend later = one line per call in `lib/<role>.ts`:
```ts
// TODO gateway: GET /researcher/home
getHome: async (): Promise<ResearcherHome> => MOCK_HOME,
// →
getHome: () => request<ResearcherHome>('/researcher/home'),
```
Types, hooks and screens don't change.

## Adding a new role (checklist)

1. `src/roles/<role>/screens/` — build your Figma screens as content-only components.
2. `src/roles/<role>/<Role>App.tsx` — copy `ResearcherApp.tsx`, swap the `NAV` array,
   `role="…"`, `roleIcon={…}`.
3. `src/mocks/<role>.ts` + `src/lib/<role>.ts` + `src/lib/use<Role>.ts` — copy the researcher
   trio, put your payloads + types in.
4. `src/Root.tsx` — replace your role's `ComingSoon` case with `<YourRoleApp onChangeRole=… />`.
   **This is the only shared-file edit.**
5. Preview: `npm run dev` → `http://localhost:5173/?role=<role>`.

Reuse `AppShell`, `Brand`, `ui.tsx`, tokens, lucide. Don't add a second sidebar, button, or
CSS system.

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
| HistoryItem, StageRow, SubmitForm | belong to the analysis app (`components/*.tsx`, `?role=app`) |
| Stamps (Brand)                  | not built — share-card feature only |

## Shared-file etiquette

`ui.tsx`, `Brand.tsx`, `AppShell.tsx`, `index.css`, `Root.tsx` are shared. Additive changes
only, and call them out in your PR so other roles aren't surprised. Everything role-specific
stays inside your `roles/<role>/` + your own `mocks`/`lib` files.
