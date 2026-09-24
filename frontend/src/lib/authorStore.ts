/**
 * In-session store for the Author screens. Seeded from src/mocks/author.ts and mutated by
 * the UI, so a fix made in the editor shows up on Draft check and the other way round —
 * both read this one store through src/lib/author.ts and src/lib/useAuthor.ts.
 *
 * Nothing here is async: latency and failure live in author.ts (the service layer), which
 * is what the gateway calls will replace. This file stays as the client-side cache/model.
 */

import { MOCK_CITATIONS, MOCK_DRAFTS, MOCK_SEARCH_RESULTS } from '../mocks/author'
import type { Citation, Draft, ParseResult, ProjectFile, SearchResult } from '../types/draftCheck'
import { bibKeys, findCites, parseProject, replaceCiteKey } from './latexProject'
import { isOpenIssue, summarize } from './verdict'

/** A draft with its citations and the ones still open, in file-then-line order. */
export type CheckRun = {
  draft: Draft
  citations: Citation[]
  issues: Citation[]
}

type Db = {
  drafts: Draft[]
  citations: Citation[]
  search: SearchResult[]
}

const clone = <T>(value: T): T => structuredClone(value)

function seed(): Db {
  const citations = clone(MOCK_CITATIONS)
  const drafts = clone(MOCK_DRAFTS).map((d) => ({
    ...d,
    status: summarize(citations.filter((c) => c.draftId === d.id)),
  }))
  return { drafts, citations, search: clone(MOCK_SEARCH_RESULTS) }
}

let db = seed()
let seq = 1

function requireDraft(id: string): Draft {
  const draft = db.drafts.find((d) => d.id === id)
  if (!draft) throw new Error(`No draft ${id}`)
  return draft
}

function requireCitation(id: string): Citation {
  const citation = db.citations.find((c) => c.id === id)
  if (!citation) throw new Error(`No citation ${id}`)
  return citation
}

function citationsOf(draftId: string): Citation[] {
  return db.citations
    .filter((c) => c.draftId === draftId)
    .sort((a, b) => fileOrder(a) - fileOrder(b) || a.line - b.line)
}

function fileOrder(c: Citation): number {
  const draft = db.drafts.find((d) => d.id === c.draftId)
  const index = draft?.files.findIndex((f) => f.name === c.file) ?? -1
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

/** Recomputes a draft's status after its citations changed. */
function refresh(draftId: string): Draft {
  const draft = requireDraft(draftId)
  draft.status = summarize(citationsOf(draftId))
  return draft
}

function buildCheckRun(draftId: string): CheckRun {
  const draft = refresh(draftId)
  const citations = citationsOf(draftId)
  return { draft, citations, issues: citations.filter(isOpenIssue) }
}

/**
 * After a file is edited, each citation keeps pointing at its own \cite: the n-th \cite of a
 * key in the old text is matched with the n-th in the new text. A \cite that is gone leaves
 * its citation unchecked, since the sentence it judged no longer exists as written.
 */
function remapLines(draftId: string, file: ProjectFile, before: string): void {
  const oldRefs = findCites({ name: file.name, content: before })
  const newRefs = findCites(file)
  const nth = (refs: typeof oldRefs, key: string) => refs.filter((r) => r.key === key)
  for (const citation of db.citations) {
    if (citation.draftId !== draftId || citation.file !== file.name) continue
    const index = nth(oldRefs, citation.key).findIndex((r) => r.line === citation.line)
    const target = nth(newRefs, citation.key)[index]
    if (index < 0 || !target) {
      citation.verdict = 'unchecked'
      citation.confidence = undefined
      continue
    }
    citation.line = target.line
  }
}

function bibFile(draft: Draft): ProjectFile | undefined {
  return draft.files.find((f) => f.kind === 'bib')
}

export const authorStore = {
  /** Back to the seeded state (tests). */
  reset(): void {
    db = seed()
    seq = 1
  },

  drafts: (): Draft[] => db.drafts.map((d) => refresh(d.id)),
  draft: (id: string): Draft | undefined => (db.drafts.some((d) => d.id === id) ? refresh(id) : undefined),
  citations: (draftId: string): Citation[] => citationsOf(draftId),
  checkRun: (draftId: string): CheckRun | undefined =>
    db.drafts.some((d) => d.id === draftId) ? buildCheckRun(draftId) : undefined,
  parse: (draftId: string): ParseResult => parseProject(requireDraft(draftId).files),
  bibKeys: (draftId: string): string[] => bibKeys(requireDraft(draftId).files),

  /** Every result whose title, authors or key mention a word of the query; all of them for
   * an empty query. The suggested fix for an issue always comes first. */
  search(query: string): SearchResult[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = db.search.filter((r) => {
      if (words.length === 0) return true
      const hay = `${r.title} ${r.authors} ${r.key} ${r.venue}`.toLowerCase()
      return words.some((w) => hay.includes(w))
    })
    return hits.sort((a, b) => Number(Boolean(b.suggestedForCitationId)) - Number(Boolean(a.suggestedForCitationId)))
  },

  /** Search results whose key is not in the draft's bibliography — the editor's "suggested ·
   * not in .bib" completions. */
  suggestedKeys(draftId: string): SearchResult[] {
    const known = new Set(bibKeys(requireDraft(draftId).files))
    return db.search.filter((r) => !known.has(r.key))
  },

  createDraft(title?: string): Draft {
    const id = `draft-${seq++}`
    const draft: Draft = {
      id,
      title: title?.trim() || 'Untitled draft',
      version: 1,
      lastCheckedAt: null,
      status: summarize([]),
      files: [{ name: 'main.tex', kind: 'tex', content: '', dirty: false }],
    }
    db.drafts.unshift(draft)
    return draft
  },

  updateFile(draftId: string, name: string, content: string): ProjectFile {
    const draft = requireDraft(draftId)
    const file = draft.files.find((f) => f.name === name)
    if (!file) throw new Error(`No file ${name} in draft ${draftId}`)
    if (file.content === content) return file
    const before = file.content
    file.content = content
    file.dirty = true
    if (file.kind === 'tex') remapLines(draftId, file, before)
    refresh(draftId)
    return file
  },

  addFile(draftId: string, name: string): ProjectFile {
    const draft = requireDraft(draftId)
    if (draft.files.some((f) => f.name === name)) throw new Error(`${name} already exists`)
    const file: ProjectFile = { name, kind: name.endsWith('.bib') ? 'bib' : 'tex', content: '', dirty: true }
    draft.files.push(file)
    return file
  },

  /** Clears every dirty flag and bumps the version — "v3 · saved". */
  saveDraft(draftId: string): Draft {
    const draft = requireDraft(draftId)
    if (draft.files.some((f) => f.dirty)) {
      draft.version += 1
      for (const f of draft.files) f.dirty = false
    }
    return draft
  },

  /**
   * "Replace with …": rewrites the \cite key in the source, adds the .bib entry when the key
   * is not there yet, and marks the issue resolved with the new source as its verdict. Mock:
   * the replacement is trusted as supporting the sentence (the gateway will re-check it).
   */
  replaceCitation(citationId: string, replacement: SearchResult): Citation {
    const citation = requireCitation(citationId)
    const draft = requireDraft(citation.draftId)
    const file = draft.files.find((f) => f.name === citation.file)
    if (file) {
      const next = replaceCiteKey(file.content, citation.line, citation.key, replacement.key)
      if (next !== file.content) {
        file.content = next
        file.dirty = true
      }
    }
    if (!bibKeys(draft.files).includes(replacement.key)) {
      const bib = bibFile(draft) ?? this.addFile(draft.id, 'main.bib')
      bib.content = `${bib.content.trimEnd()}\n\n${replacement.bibtex}\n`.replace(/^\n+/, '')
      bib.dirty = true
    }
    citation.resolution = { kind: 'replaced', previousKey: citation.key, at: new Date().toISOString() }
    citation.key = replacement.key
    citation.sourceRef = {
      key: replacement.key,
      title: replacement.title,
      authors: replacement.authors,
      year: replacement.year,
      venue: replacement.venue,
      pdf: replacement.evidence?.pdf,
    }
    citation.evidence = replacement.evidence
    citation.verdict = 'supports'
    citation.confidence = replacement.similarity
    citation.explanation = undefined
    citation.suggestedReplacement = undefined
    citation.metadataMatch = { ok: true, text: 'Bib entry added from the search result' }
    refresh(draft.id)
    return citation
  },

  /** "Override · add note" / "Keep mine": the author stands by the citation. */
  overrideCitation(citationId: string, note: string): Citation {
    const citation = requireCitation(citationId)
    citation.resolution = { kind: 'overridden', note: note.trim(), at: new Date().toISOString() }
    refresh(citation.draftId)
    return citation
  },

  /** Puts an issue back on the list. */
  reopenCitation(citationId: string): Citation {
    const citation = requireCitation(citationId)
    citation.resolution = undefined
    refresh(citation.draftId)
    return citation
  },

  /** "Upload source PDF": the source can be read now; the verdict waits for a re-check. */
  attachSourcePdf(citationId: string, fileName: string): Citation {
    const citation = requireCitation(citationId)
    citation.sourceRef = { ...(citation.sourceRef ?? { key: citation.key, title: citation.key, authors: '', year: 0 }), pdf: fileName }
    citation.verdict = 'unchecked'
    citation.confidence = undefined
    citation.explanation = undefined
    refresh(citation.draftId)
    return citation
  },

  /**
   * "Re-check". Mock rules: a citation whose source can be read (has a PDF) and has no verdict
   * yet gets `supports`; one with no bib entry stays unchecked; everything else keeps its
   * verdict. Sets lastCheckedAt.
   */
  recheck(draftId: string): CheckRun {
    const draft = requireDraft(draftId)
    const known = new Set(bibKeys(draft.files))
    for (const citation of citationsOf(draftId)) {
      const readable = Boolean(citation.sourceRef?.pdf)
      if (citation.verdict === 'unchecked' && known.has(citation.key) && readable) {
        citation.verdict = 'supports'
        citation.confidence = 0.8
      }
    }
    draft.lastCheckedAt = new Date().toISOString()
    return buildCheckRun(draftId)
  },

  /** The open issue after `afterCitationId` in file order, wrapping to the first; or the first
   * open issue when no id is given; undefined when nothing is open. */
  nextOpenIssue(draftId: string, afterCitationId?: string): Citation | undefined {
    const issues = citationsOf(draftId).filter(isOpenIssue)
    if (issues.length === 0) return undefined
    if (!afterCitationId) return issues[0]
    const index = issues.findIndex((c) => c.id === afterCitationId)
    return issues[(index + 1) % issues.length]
  },

  /** Settings → "Delete all drafts". Keeps one empty draft so every screen has something to
   * open (same reason writerStore.deleteAll reseeds). */
  deleteAll(): void {
    db.citations = []
    db.drafts = []
    this.createDraft('Untitled draft')
  },
}
