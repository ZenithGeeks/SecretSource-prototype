# SecretSource web UI

React + Vite + TypeScript, Tailwind v4, TanStack Query. Talks to the gateway (`../backend/app/main.py`)
through `/api`, proxied by Vite in dev and by nginx in the container.

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to localhost:8080
npm run build
```

| Path | Role |
|---|---|
| `src/lib/api.ts` | typed gateway client, including the SSE subscription |
| `src/lib/useAnalysis.ts` | one analysis kept current: fetch, then follow its stage events |
| `src/components/ui.tsx` | the shared primitives (card, button, input, verdict badge, empty state) |
| `src/components/SubmitForm.tsx` | start an analysis from a reference or an uploaded PDF |
| `src/components/PipelineStages.tsx` | live progress, one line per stage |
| `src/components/ClaimCard.tsx` | a claim, its citations, and each verdict with its quote |
| `src/components/HistoryList.tsx` | past analyses, select or delete |
| `src/index.css` | the palette; every color is a token defined for light and dark |
