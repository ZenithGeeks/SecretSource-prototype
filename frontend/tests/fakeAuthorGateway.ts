/**
 * An in-memory stand-in for the gateway's /author routes (backend/app/author/router.py),
 * installed as `fetch` for the Author screen tests. It keeps drafts, checks, projects and
 * sources between requests — a screen that unmounts and mounts again sees what it saved, the
 * way a page refresh does against the real gateway — and answers the same shapes the router
 * documents. Verdicts come from `verdictFor`, the test's stand-in for the pipeline.
 */

import { vi } from 'vitest'

import { parseBib } from '../src/lib/bibtex'
import { findCites, parseProject } from '../src/lib/latexProject'
import { summarize } from '../src/lib/verdict'
import type { CheckRun, Citation, Draft, ParseWarning, ProjectFile, SavedSource, Verdict } from '../src/types/draftCheck'

type StoredDraft = Omit<Draft, 'status' | 'lastCheckedAt' | 'lastCheckId' | 'runningCheckId' | 'sinceLastCheck' | 'checks'> & { savedHash?: string }
type StoredProject = { id: string; name: string; bib: { name: string; content: string } | null; pdfs: Record<string, string>; created: string; updated: string }
type StoredCheck = Omit<CheckRun, 'summary' | 'sinceLastCheck' | 'previousVersion' | 'previousId' | 'unchanged'> & { citations: Citation[]; contentHash: string }

export type VerdictRule = (key: string, claim: string) => { verdict: Verdict; passage?: string; page?: number; explanation?: string; message?: string; reason?: string; audit?: Citation['audit'] }

export type FakeGateway = {
  drafts: Map<string, StoredDraft>
  projects: Map<string, StoredProject>
  checks: Map<string, StoredCheck>
  sources: Map<string, SavedSource>
  verdictFor: VerdictRule
  /** Every request seen, for assertions: "PUT /author/drafts/d1/files/related-work.tex". */
  calls: string[]
  fetch: ReturnType<typeof vi.fn>
  /** While true, every file write answers 503 — a gateway that is down mid-typing. */
  failWrites: boolean
  /** Awaited before a file write is applied, so a test can hold one reply back and let a later
   * one land first. */
  beforeWrite?: (name: string, content: string) => Promise<void>
}

let seq = 0
const id = (prefix: string) => `${prefix}${++seq}`
const now = () => new Date().toISOString()

function kindOf(name: string): 'tex' | 'bib' {
  return name.toLowerCase().endsWith('.bib') ? 'bib' : 'tex'
}

/** The default pipeline: contradicted for khattab2020, silent for thakur2021, unreadable for
 * nguyen2016, everything else supported. Missing keys never reach it. */
export const DEFAULT_VERDICTS: VerdictRule = (key) => {
  if (key === 'khattab2020') return { verdict: 'refutes', passage: 'we leave compression of the embeddings to future work', page: 7, explanation: 'The 2020 paper defers compression.' }
  if (key === 'thakur2021') return { verdict: 'insufficient', passage: '', explanation: 'BEIR does not compare against single-vector retrievers.' }
  if (key === 'nguyen2016') return { verdict: 'unavailable', reason: 'no-open-access', message: 'no free copy published' }
  return { verdict: 'supports', passage: `the paper says so about ${key}`, page: 4, explanation: 'It matches.' }
}

const SENTENCE_END = /[.!?]["”’)}]?(?=\s|$)/

/** A sentence around a \cite, and its plain words — the same idea as the gateway's parser. */
function sentenceAt(content: string, line: number): { sentence: string; claim: string; section: string } {
  const lines = content.split('\n')
  let start = line - 1
  while (start > 0 && lines[start - 1].trim() !== '' && !SENTENCE_END.test(lines[start - 1].trim()) && !lines[start - 1].trim().startsWith('\\')) start -= 1
  let end = line - 1
  while (end < lines.length - 1 && !SENTENCE_END.test(lines[end]) && lines[end + 1].trim() !== '') end += 1
  const sentence = lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ').trim()
  const claim = sentence
    .replace(/\\(?:cite|citep|citet)\*?(?:\[[^\]]*\])*\{[^}]*\}/g, '')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/\\times/g, '×')
    .replace(/~/g, ' ')
    .replace(/--/g, '–')
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  let section = ''
  for (let i = 0; i < line; i += 1) {
    const m = lines[i].match(/\\(?:section|subsection)\*?\{([^}]*)\}/)
    if (m) section = m[1]
  }
  return { sentence, claim, section }
}

export function installFakeGateway(options: { files?: { name: string; content: string }[]; verdictFor?: VerdictRule; project?: boolean; prechecked?: boolean } = {}): FakeGateway {
  seq = 0
  const gateway: FakeGateway = {
    drafts: new Map(),
    projects: new Map(),
    checks: new Map(),
    sources: new Map(),
    verdictFor: options.verdictFor ?? DEFAULT_VERDICTS,
    calls: [],
    fetch: vi.fn(),
    failWrites: false,
  }

  const t = now()
  if (options.project !== false) {
    gateway.projects.set('proj1', { id: 'proj1', name: 'Related work — thesis ch.2', bib: null, pdfs: {}, created: t, updated: t })
  }
  if (options.files) {
    gateway.drafts.set('d1', {
      id: 'd1', projectId: options.project !== false ? 'proj1' : null, title: 'Related work — thesis ch.2', version: 3,
      files: options.files.map((f) => ({ name: f.name, kind: kindOf(f.name), content: f.content })), pdfs: {}, created: t, updated: t, savedAt: t,
    })
    gateway.drafts.set('d2', {
      id: 'd2', projectId: options.project !== false ? 'proj1' : null, title: 'Seminar paper (CPE)', version: 5,
      files: [{ name: 'seminar.tex', kind: 'tex', content: '\\section{Seminar}\nDPR works~\\cite{karpukhin2020}.\n' }, { name: 'refs.bib', kind: 'bib', content: '@misc{karpukhin2020, title={DPR}, year={2020}, doi={10.1/dpr}}' }],
      pdfs: {}, created: t, updated: t, savedAt: t,
    })
    for (const draft of gateway.drafts.values()) markSaved(draft)
    if (options.prechecked !== false) {
      runCheck(gateway, 'd1')
      runCheck(gateway, 'd2')
    }
  }

  gateway.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => handle(gateway, input, init))
  vi.stubGlobal('fetch', gateway.fetch)
  return gateway
}

function filesOf(gateway: FakeGateway, draft: StoredDraft): ProjectFile[] {
  const files = [...draft.files]
  const project = draft.projectId ? gateway.projects.get(draft.projectId) : undefined
  if (project?.bib && !files.some((f) => f.name === project.bib!.name)) files.push({ ...project.bib, kind: 'bib', shared: true })
  return files
}

/** The gateway's content hash: the same files hash the same, whatever their order. */
export function contentHash(files: { name: string; content: string }[]): string {
  const text = [...files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => `${f.name}\0${f.content}\0`).join('')
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

/** The draft as last saved (Ctrl+S, or the save a check makes first). */
export function markSaved(draft: StoredDraft): void {
  draft.savedHash = contentHash(draft.files)
}

function checksOf(gateway: FakeGateway, draftId: string): StoredCheck[] {
  return [...gateway.checks.values()].filter((c) => c.draftId === draftId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

function delta(current: Citation[], previous: Citation[] | undefined) {
  if (!previous) return null
  const needs = (c: Citation) => c.verdict === 'refutes' || c.verdict === 'insufficient'
  const key = (c: Citation, i: number) => `${c.key}#${i}`
  const before = new Map(previous.map((c, i) => [key(c, i), c]))
  const nowMap = new Map(current.map((c, i) => [key(c, i), c]))
  const fixed = [...before].filter(([k, c]) => needs(c) && !(nowMap.get(k) && needs(nowMap.get(k)!))).length
  const fresh = [...nowMap].filter(([k, c]) => needs(c) && !(before.get(k) && needs(before.get(k)!))).length
  return { addedCitations: current.length - previous.length, fixedIssues: fixed, newIssues: fresh }
}

function checkView(gateway: FakeGateway, check: StoredCheck, full: boolean): CheckRun {
  const done = checksOf(gateway, check.draftId).filter((c) => c.status === 'done' && c.startedAt < check.startedAt)
  const previous = done[done.length - 1]
  const view: CheckRun = {
    ...check,
    summary: summarize(check.citations),
    sinceLastCheck: delta(check.citations, previous?.citations),
    previousVersion: previous?.version ?? null,
    previousId: previous?.id ?? null,
    unchanged: Boolean(previous && previous.contentHash === check.contentHash),
  }
  delete (view as { contentHash?: string }).contentHash
  if (!full) delete (view as { citations?: Citation[] }).citations
  return view
}

function draftView(gateway: FakeGateway, draft: StoredDraft): Draft {
  const runs = checksOf(gateway, draft.id)
  const done = runs.filter((r) => r.status === 'done')
  const latest = done[done.length - 1]
  const previous = done[done.length - 2]
  return {
    ...draft,
    files: filesOf(gateway, draft),
    status: summarize(latest?.citations ?? []),
    lastCheckedAt: latest?.finishedAt ?? null,
    lastCheckId: latest?.id ?? null,
    runningCheckId: runs.find((r) => r.status === 'running')?.id ?? null,
    sinceLastCheck: latest ? delta(latest.citations, previous?.citations) : null,
    checks: done.length,
  }
}

/** The stand-in for the pipeline: every \cite judged by `verdictFor`, finished at once. */
export function runCheck(gateway: FakeGateway, draftId: string): StoredCheck {
  const draft = gateway.drafts.get(draftId)!
  // unsaved edits are saved first, as the gateway does, so the run's version names what was checked
  if (draft.savedHash !== contentHash(draft.files)) {
    draft.version += 1
    draft.savedAt = now()
    markSaved(draft)
  }
  const files = filesOf(gateway, draft)
  const known = new Set(files.filter((f) => f.kind === 'bib').flatMap((f) => parseBib(f.content).map((e) => e.key)))
  const entries = new Map(files.filter((f) => f.kind === 'bib').flatMap((f) => parseBib(f.content).map((e) => [e.key, e] as const)))
  const previous = checksOf(gateway, draftId).filter((c) => c.status === 'done').pop()
  const checkId = id('check')
  const citations: Citation[] = files
    .filter((f) => f.kind === 'tex')
    .flatMap((f) =>
      findCites(f).map((c, i) => {
        const { sentence, claim, section } = sentenceAt(f.content, c.line)
        const base: Citation = { id: `${checkId}-${f.name}-${i}`, key: c.key, file: f.name, line: c.line, column: c.column, section, sentence, claim, verdict: 'unchecked' }
        const carried = previous?.citations.find((p) => p.key === c.key && p.claim === claim && p.resolution?.kind === 'overridden')
        if (carried) base.resolution = carried.resolution
        if (!known.has(c.key)) return { ...base, reason: 'missing-key', message: `${c.key} is not in the bibliography` }
        const entry = entries.get(c.key)!
        const ref = { key: c.key, title: (entry.fields.title ?? '').replace(/[{}]/g, ''), authors: shortAuthors(entry.fields.author ?? ''), year: Number(entry.fields.year) || null, venue: entry.fields.booktitle ?? entry.fields.journal ?? '', doi: entry.fields.doi ?? '', url: entry.fields.url ?? '' }
        const result = gateway.verdictFor(c.key, claim)
        if (result.verdict === 'unavailable') return { ...base, sourceRef: ref, verdict: 'unavailable', reason: result.reason ?? 'failed', message: result.message ?? 'checking it failed' }
        return { ...base, sourceRef: ref, verdict: result.verdict, explanation: result.explanation, evidence: { passage: result.passage ?? '', pdf: `${c.key}.pdf`, page: result.page ?? null }, ...(result.audit ? { audit: result.audit } : {}) }
      }),
    )
  const started = new Date(Date.now() + seq).toISOString()
  const check: StoredCheck = { id: checkId, draftId, version: draft.version, contentHash: contentHash(files), status: 'done', startedAt: started, finishedAt: started, stages: [{ stage: 'planned', checks: citations.length }, { stage: 'done' }], citations }
  gateway.checks.set(checkId, check)
  return check
}

function shortAuthors(author: string): string {
  const names = author.split(/\s+and\s+/i).map((n) => n.trim()).filter(Boolean).map((n) => (n.includes(',') ? n.split(',')[0] : n.split(/\s+/).pop() ?? n).trim())
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fail(status: number, detail: string): Response {
  return json({ detail }, status)
}

async function handle(gateway: FakeGateway, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname.replace(/^\/api/, '')
  gateway.calls.push(`${method} ${path}${url.search}`)
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
  const form = init?.body instanceof FormData ? init.body : null
  const parts = path.split('/').filter(Boolean)

  if (path === '/analyses') return json([])
  if (path === '/researcher/graph') return json({ clusters: [], nodes: [], edges: [], paperEdges: [] })
  if (parts[0] === 'papers') return json({ page: null, boxes: [] })
  if (parts[0] !== 'author') return fail(404, `no route ${path}`)

  // drafts
  if (parts[1] === 'drafts') {
    if (parts.length === 2 && method === 'GET') return json([...gateway.drafts.values()].map((d) => draftView(gateway, d)).sort((a, b) => b.updated.localeCompare(a.updated)))
    if (parts.length === 2 && method === 'POST') {
      const files = ((body?.files as { name: string; content: string }[] | undefined) ?? []).map((f) => ({ ...f, kind: kindOf(f.name) }))
      // As the real route: no title, or the bare default, is the next free "Untitled draft N".
      const wanted = String(body?.title ?? '').split(/\s+/).filter(Boolean).join(' ')
      const taken = new Set([...gateway.drafts.values()].map((d) => d.title))
      let title = wanted && wanted !== 'Untitled draft' ? wanted : 'Untitled draft'
      if (title === 'Untitled draft' && taken.has(title)) {
        let n = 2
        while (taken.has(`Untitled draft ${n}`)) n += 1
        title = `Untitled draft ${n}`
      }
      const draft: StoredDraft = { id: id('draft'), projectId: (body?.projectId as string | null) ?? null, title, version: 1, files: files.length ? files : [{ name: 'main.tex', kind: 'tex', content: '' }], pdfs: {}, created: now(), updated: now(), edited: now(), savedAt: now() }
      markSaved(draft)
      gateway.drafts.set(draft.id, draft)
      return json(draftView(gateway, draft))
    }
    if (parts[2] === 'upload' && method === 'POST') {
      const file = form?.get('file') as File
      const text = await file.text()
      const draft: StoredDraft = { id: id('draft'), projectId: null, title: file.name.replace(/\.(tex|zip|bib)$/i, ''), version: 1, files: [{ name: file.name, kind: kindOf(file.name), content: text }], pdfs: {}, created: now(), updated: now(), savedAt: now() }
      markSaved(draft)
      gateway.drafts.set(draft.id, draft)
      return json(draftView(gateway, draft))
    }
    const draft = gateway.drafts.get(parts[2])
    if (!draft) return fail(404, 'no such draft')
    if (parts.length === 3 && method === 'GET') return json(draftView(gateway, draft))
    if (parts.length === 3 && method === 'PATCH') {
      // As the real route: the title is trimmed to one line, refused when empty or over 120
      // characters, and a rename or a move leaves `updated` (the text's version) alone.
      if (body && 'title' in body) {
        if (gateway.failWrites) return fail(503, 'the gateway is down')
        const title = String(body.title ?? '').split(/\s+/).filter(Boolean).join(' ')
        if (!title) return fail(400, 'a draft needs a title')
        if (title.length > 120) return fail(400, 'a draft title is at most 120 characters')
        draft.title = title
      }
      // As DraftIn: a project's id moves the draft there, "" to Unsorted, null leaves it where it is.
      if (body?.projectId !== undefined && body.projectId !== null) draft.projectId = (body.projectId as string) || null
      return json(draftView(gateway, draft))
    }
    if (parts.length === 3 && method === 'DELETE') {
      gateway.drafts.delete(draft.id)
      return json({ deleted: draft.id })
    }
    if (parts[3] === 'files') {
      const name = decodeURIComponent(parts.slice(4).join('/'))
      if (method === 'PUT') {
        const content = String(body?.content ?? '')
        if (gateway.beforeWrite) await gateway.beforeWrite(name, content)
        if (gateway.failWrites) return fail(503, 'the gateway is down')
        // As the real route: a write carrying the `updated` the editor last saw is refused
        // when the draft has changed since (another tab saved); one carrying none is not checked.
        const updated = body?.updated as string | undefined
        if (updated !== undefined && updated !== draft.updated) return fail(409, 'the draft was changed elsewhere since this editor last saved it')
        const existing = draft.files.find((f) => f.name === name)
        if (existing) existing.content = content
        else draft.files.push({ name, kind: kindOf(name), content })
        draft.updated = now()
        draft.edited = draft.updated
        return json(draftView(gateway, draft))
      }
      if (method === 'DELETE') {
        draft.files = draft.files.filter((f) => f.name !== name)
        return json(draftView(gateway, draft))
      }
    }
    if (parts[3] === 'save') {
      draft.version += 1
      draft.savedAt = now()
      draft.updated = now()
      markSaved(draft)
      return json(draftView(gateway, draft))
    }
    if (parts[3] === 'parse') return json(parseProject(filesOf(gateway, draft)))
    if (parts[3] === 'check' && method === 'POST') {
      if (checksOf(gateway, draft.id).some((c) => c.status === 'running')) return fail(409, 'a check is already running')
      return json({ id: runCheck(gateway, draft.id).id })
    }
    if (parts[3] === 'checks') return json(checksOf(gateway, draft.id).map((c) => checkView(gateway, c, false)).reverse())
    if (parts[3] === 'citations' && parts[5] === 'pdf') {
      const file = form?.get('file') as File
      draft.pdfs[decodeURIComponent(parts[4])] = `${file.name.replace(/\.pdf$/, '')}-abc123.pdf`
      return json({ key: parts[4], pdf: draft.pdfs[decodeURIComponent(parts[4])] })
    }
    if (parts[3] === 'report') {
      if (!checksOf(gateway, draft.id).some((c) => c.status === 'done')) return fail(409, 'check the draft first, then export its report')
      return new Response(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }
  }

  // checks
  if (parts[1] === 'checks') {
    const check = gateway.checks.get(parts[2])
    if (!check) return fail(404, 'no such check')
    if (parts.length === 3 && method === 'GET') return json(checkView(gateway, check, true))
    if (parts.length === 3 && method === 'DELETE') {
      gateway.checks.delete(check.id)
      return json({ deleted: check.id })
    }
    if (parts[3] === 'compare') {
      const view = checkView(gateway, check, true)
      if (!view.previousId) return fail(404, 'nothing earlier to compare with')
      const previous = gateway.checks.get(view.previousId)!
      const rows = check.citations.map((c, i) => {
        const before = previous.citations[i]
        const needs = (v: Verdict | null | undefined) => v === 'refutes' || v === 'insufficient'
        const change = !before ? 'added' : before.verdict === c.verdict ? 'same' : needs(before.verdict) && !needs(c.verdict) ? 'fixed' : needs(c.verdict) && !needs(before.verdict) ? 'new' : 'changed'
        return { key: c.key, claim: c.claim, file: c.file, line: c.line, before: before?.verdict ?? null, after: c.verdict, change }
      })
      return json({ current: { id: check.id, version: check.version }, previous: { id: previous.id, version: previous.version }, rows })
    }
    if (parts[3] === 'citations' && method === 'PATCH') {
      const citation = check.citations.find((c) => c.id === parts[4])
      if (!citation) return fail(404, 'no such citation')
      if (body && 'resolution' in body) {
        if (body.resolution) citation.resolution = { ...(body.resolution as Citation['resolution']), at: now() } as Citation['resolution']
        else delete citation.resolution
      }
      if (body?.key) citation.key = String(body.key)
      if (body?.sourceRef) citation.sourceRef = body.sourceRef as Citation['sourceRef']
      if (body?.verdict) {
        citation.verdict = body.verdict as Verdict
        delete citation.reason
        delete citation.message
      }
      if (body?.evidence) citation.evidence = body.evidence as Citation['evidence']
      if (body?.explanation) citation.explanation = String(body.explanation)
      return json(checkView(gateway, check, true))
    }
  }

  // projects and the library
  if (parts[1] === 'projects') {
    const cards = () =>
      [...gateway.projects.values()].map((p) => {
        const drafts = [...gateway.drafts.values()].filter((d) => d.projectId === p.id)
        const entries = p.bib ? parseBib(p.bib.content) : []
        const tally = { supports: 0, refutes: 0, insufficient: 0, unavailable: 0, unchecked: 0 }
        let needWork = 0
        let checkedAt: string | null = null
        for (const d of drafts) {
          const v = draftView(gateway, d)
          for (const k of Object.keys(tally) as Verdict[]) tally[k] += v.status.counts[k]
          needWork += v.status.open
          // As the gateway: a draft with no finished check counts its citations as not checked.
          if (!v.checks) tally.unchecked += filesOf(gateway, d).filter((f) => f.kind === 'tex').flatMap((f) => findCites(f)).length
          if (v.lastCheckedAt && (!checkedAt || v.lastCheckedAt > checkedAt)) checkedAt = v.lastCheckedAt
        }
        return { id: p.id, name: p.name, bibName: p.bib?.name ?? null, entries: entries.length, cited: 0, needWork, tally, drafts: drafts.length, checkedAt, pdfs: p.pdfs, created: p.created, updated: p.updated }
      })
    if (parts.length === 2 && method === 'GET') return json(cards())
    if (parts.length === 2 && method === 'POST') {
      // As the gateway: no name gets the next free "Untitled project N"; a name is one trimmed line.
      const asked = String(body?.name ?? '').split(/\s+/).filter(Boolean).join(' ')
      if (asked.length > 120) return fail(400, 'a project name is at most 120 characters')
      const taken = new Set([...gateway.projects.values()].map((p) => p.name))
      let name = asked || 'Untitled project'
      for (let n = 2; !asked && taken.has(name); n++) name = `Untitled project ${n}`
      const project: StoredProject = { id: id('proj'), name, bib: { name: String(body?.bibName ?? 'main.bib'), content: String(body?.bib ?? '') }, pdfs: {}, created: now(), updated: now() }
      gateway.projects.set(project.id, project)
      return json(cards().find((c) => c.id === project.id))
    }
    if (parts[2] === 'import' && method === 'POST') {
      const file = form?.get('file') as File
      const project: StoredProject = { id: id('proj'), name: file.name.replace(/\.(bib|zip)$/i, ''), bib: { name: file.name, content: await file.text() }, pdfs: {}, created: now(), updated: now() }
      gateway.projects.set(project.id, project)
      return json(cards().find((c) => c.id === project.id))
    }
    const project = gateway.projects.get(parts[2])
    if (!project) return fail(404, 'no such project')
    if (parts.length === 3 && method === 'GET') {
      const drafts = [...gateway.drafts.values()].filter((d) => d.projectId === project.id)
      const history: Record<string, CheckRun[]> = {}
      for (const d of drafts) history[d.id] = checksOf(gateway, d.id).map((c) => checkView(gateway, c, false)).reverse()
      return json({ ...cards().find((c) => c.id === project.id), bib: project.bib, draftList: drafts.map((d) => draftView(gateway, d)), history })
    }
    if (parts.length === 3 && method === 'PATCH') {
      if (body && 'name' in body) {
        const name = String(body.name ?? '').split(/\s+/).filter(Boolean).join(' ')
        if (!name) return fail(400, 'a project needs a name')
        if (name.length > 120) return fail(400, 'a project name is at most 120 characters')
        project.name = name
      }
      if (typeof body?.bib === 'string') project.bib = { name: String(body.bibName ?? project.bib?.name ?? 'main.bib'), content: body.bib }
      project.updated = now()
      return json(cards().find((c) => c.id === project.id))
    }
    if (parts.length === 3 && method === 'DELETE') {
      // Its drafts and saved sources stay, unsorted; the .bib goes with the project.
      for (const d of gateway.drafts.values()) if (d.projectId === project.id) d.projectId = null
      for (const src of gateway.sources.values()) if (src.projectId === project.id) src.projectId = null
      gateway.projects.delete(project.id)
      return json({ deleted: project.id })
    }
    if (parts[3] === 'lint') {
      // As logic.lint_project: each draft as it builds; the project .bib's own warnings once,
      // against what every draft that uses it cites.
      const warnings: (ParseWarning & { draftId: string | null })[] = []
      const cited = new Set<string>()
      const drafts = [...gateway.drafts.values()].filter((d) => d.projectId === project.id)
      for (const d of drafts) {
        const files = filesOf(gateway, d)
        if (files.some((f) => f.shared)) for (const c of files.filter((f) => f.kind === 'tex').flatMap((f) => findCites(f))) cited.add(c.key)
      }
      let texFiles = 0
      let citeCommands = 0
      let bibEntries = 0
      if (project.bib) {
        const standIn: ProjectFile = { name: '', kind: 'tex', content: cited.size ? `\\cite{${[...cited].sort().join(',')}}` : '' }
        const whole = parseProject([standIn, { name: project.bib.name, kind: 'bib', content: project.bib.content }])
        bibEntries = whole.bibEntries
        warnings.push(...whole.warnings.filter((w) => w.file === project.bib!.name).map((w) => ({ ...w, draftId: null })))
      }
      const twice = new Set(warnings.filter((w) => w.type === 'duplicate-key').map((w) => w.detail))
      for (const d of drafts) {
        const files = filesOf(gateway, d)
        const built = parseProject(files)
        const own = parseProject(files.filter((f) => !f.shared))
        texFiles += built.texFiles
        citeCommands += built.citeCommands
        bibEntries += own.bibEntries
        for (const w of built.warnings) {
          if (w.type === 'missing-key' || (w.type === 'duplicate-key' && !(w.file === project.bib?.name && twice.has(w.detail)))) warnings.push({ ...w, draftId: d.id })
        }
        for (const w of own.warnings) if (w.type === 'unused-entry' || w.type === 'no-doi-url') warnings.push({ ...w, draftId: d.id })
      }
      return json({ bibName: project.bib?.name ?? null, bibEntries, drafts: drafts.length, texFiles, citeCommands, warnings })
    }
    if (parts[3] === 'bib' && method === 'DELETE') {
      const entries = project.bib ? parseBib(project.bib.content) : []
      const key = decodeURIComponent(parts[4])
      if (!entries.some((e) => e.key === key)) return fail(404, `${key} is not in the bib`)
      const kept = entries.filter((e) => e.key !== key)
      project.bib = { name: project.bib!.name, content: kept.map((e) => `@${e.type}{${e.key},\n${Object.entries(e.fields).map(([k, v]) => `  ${k} = {${v}},`).join('\n')}\n}`).join('\n\n') }
      return json({ removed: key, entries: kept.length })
    }
    if (parts[3] === 'bib' && parts[5] === 'pdf') {
      const file = form?.get('file') as File
      project.pdfs[decodeURIComponent(parts[4])] = `${file.name}`
      return json({ key: parts[4], pdf: file.name })
    }
  }

  if (parts[1] === 'library') {
    const projects = (await (await handle(gateway, '/api/author/projects')).json()) as { id: string }[]
    const drafts = [...gateway.drafts.values()]
    const attention: unknown[] = []
    for (const d of drafts) {
      const v = draftView(gateway, d)
      const latest = v.lastCheckId ? gateway.checks.get(v.lastCheckId) : undefined
      const seen = new Set<string>()
      for (const c of latest?.citations ?? []) {
        if (seen.has(c.key)) continue
        if (c.verdict === 'refutes' && !c.resolution) attention.push({ kind: 'replace', key: c.key, title: `${c.sourceRef?.authors} (${c.sourceRef?.year}) · ${c.sourceRef?.title.split(':')[0]}`, detail: `\\cite{${c.key}} contradicts a claim in ${d.title}`, file: c.file, line: c.line, draftId: d.id, checkId: latest!.id, citationId: c.id, projectId: d.projectId })
        if (c.verdict === 'unavailable') attention.push({ kind: 'upload-pdf', key: c.key, title: `${c.key} · no DOI or PDF`, detail: 'Cannot be checked until a source is attached', draftId: d.id, projectId: d.projectId })
        if (c.verdict === 'refutes' || c.verdict === 'unavailable') seen.add(c.key)
      }
    }
    for (const p of gateway.projects.values()) {
      for (const e of p.bib ? parseBib(p.bib.content) : []) {
        const cited = drafts.some((d) => d.projectId === p.id && filesOf(gateway, d).some((f) => f.kind === 'tex' && f.content.includes(`{${e.key}}`)))
        if (!cited) attention.push({ kind: 'remove', key: e.key, title: `${e.key} · in ${p.bib!.name}`, detail: 'Never cited in any draft', projectId: p.id })
      }
    }
    const unsorted = [...gateway.sources.values()].filter((s) => !s.projectId)
    const saved = [...gateway.sources.values()].reverse().map((s) => {
      const project = s.projectId ? gateway.projects.get(s.projectId) : undefined
      const keys = project?.bib ? new Set(parseBib(project.bib.content).map((e) => e.key)) : new Set<string>()
      return { ...s, inBib: keys.has(s.key), bibName: project?.bib?.name ?? null }
    })
    return json({ projects, unsorted: { sources: unsorted.length, pdfs: unsorted.filter((s) => s.pdf).length, drafts: drafts.filter((d) => !d.projectId).length }, attention, saved })
  }

  // saved sources
  if (parts[1] === 'sources') {
    const view = (s: SavedSource): SavedSource => {
      const project = s.projectId ? gateway.projects.get(s.projectId) : undefined
      const keys = project?.bib ? new Set(parseBib(project.bib.content).map((e) => e.key)) : new Set<string>()
      return { ...s, inBib: keys.has(s.key), bibName: project?.bib?.name ?? null }
    }
    if (parts.length === 2 && method === 'GET') {
      const project = url.searchParams.get('project')
      return json([...gateway.sources.values()].filter((s) => project === null || (s.projectId ?? '') === project).map(view).reverse())
    }
    if (parts.length === 2 && method === 'POST') {
      const source = { id: id('src'), inBib: false, bibName: null, savedAt: now(), key: 'source', bibtex: '', ...(body as Partial<SavedSource>) } as SavedSource
      const first = (source.authorsList ?? [])[0] ?? 'source'
      const surname = first.split(' ').pop() ?? first
      source.key = (body?.key as string) || `${surname.toLowerCase()}${source.year ?? ''}`
      source.bibtex = (body?.bibtex as string) || `@inproceedings{${source.key},\n  title = {${source.title}},\n}`
      gateway.sources.set(source.id, source)
      return json(view(source))
    }
    const source = gateway.sources.get(parts[2])
    if (!source) return fail(404, 'no such source')
    if (parts.length === 3 && method === 'DELETE') {
      gateway.sources.delete(source.id)
      return json({ deleted: source.id })
    }
    if (parts[3] === 'add-to-bib') {
      const project = gateway.projects.get(String(body?.projectId ?? source.projectId))
      if (!project) return fail(404, 'no such project')
      const bib = project.bib ?? { name: 'main.bib', content: '' }
      if (parseBib(bib.content).some((e) => e.key === source.key)) return fail(409, `${source.key} is already in ${bib.name}`)
      project.bib = { name: bib.name, content: `${bib.content.trimEnd()}\n\n${source.bibtex}\n` }
      source.projectId = project.id
      return json(view(source))
    }
    if (parts[3] === 'pdf') {
      const file = form?.get('file') as File | undefined
      if (!file) return fail(400, 'no file')
      source.pdf = file.name
      return json(view(source))
    }
  }

  if (parts[1] === 'export') return json({ exportedAt: now(), projects: [...gateway.projects.values()], drafts: [...gateway.drafts.values()], sources: [...gateway.sources.values()], checks: [...gateway.checks.values()] })

  return fail(404, `no route ${method} ${path}`)
}
