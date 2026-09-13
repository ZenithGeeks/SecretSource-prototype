/**
 * In-session mutable store for the researcher screens. Seeded from the mocks and mutated by
 * the UI so create/add actions actually persist while the app is open (until real gateway
 * endpoints exist). researcher.ts reads its getters through this; mutations run via
 * useResearcherActions, which invalidates the relevant React Query caches.
 */

import { MOCK_HOME, MOCK_LIBRARIES, MOCK_PROJECTS } from '../mocks/researcher'
import type {
  LibraryPaper,
  PaperClaim,
  PaperDetail,
  Project,
  ResearcherHome,
  ResearcherLibrary,
} from './researcher'

/** Deep clone so mutations never touch the shared mock module. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Stable id from a title, so library rows and paper detail agree without a real backend id. */
export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

function withIds(libs: Record<string, ResearcherLibrary>): Record<string, ResearcherLibrary> {
  for (const key of Object.keys(libs)) {
    libs[key].papers.forEach((p) => {
      if (!p.id) p.id = slug(p.title)
    })
  }
  return libs
}

const db = {
  projects: clone(MOCK_PROJECTS) as Project[],
  libraries: withIds(clone(MOCK_LIBRARIES)) as Record<string, ResearcherLibrary>,
  home: clone(MOCK_HOME) as ResearcherHome,
}

let seq = 1

/** Synthesize a paper's claim list from its verdict counts (until the gateway returns real
 * per-claim verdicts). backed → supports, contradicted → refutes, the rest → insufficient. */
function claimsFrom(p: LibraryPaper): PaperClaim[] {
  const backed = p.backed ?? 0
  const contra = p.contradicted ?? 0
  const total = p.claims
  const silent = Math.max(0, total - backed - contra)
  const out: PaperClaim[] = []
  const push = (n: number, verdict: PaperClaim['verdict'], note: string) => {
    for (let i = 0; i < n; i++)
      out.push({
        claim: `Claim ${out.length + 1} from ${p.title.split(':')[0]}`,
        verdict,
        quote: note,
        linked: p.linked,
      })
  }
  push(backed, 'supports', 'A cited source states this. Open it to see the passage.')
  push(contra, 'refutes', 'A cited source disagrees — the quote is on its page.')
  push(silent, 'insufficient', 'No cited source states this outright.')
  return out
}

export const store = {
  projects: (): Project[] => db.projects,
  library: (id: string): ResearcherLibrary => db.libraries[id] ?? db.libraries['retrieval-survey'],
  home: (): ResearcherHome => db.home,

  /** One paper's detail, or null if the id isn't in that project. */
  paper(projectId: string, paperId: string): PaperDetail | null {
    const lib = db.libraries[projectId]
    const p = lib?.papers.find((x) => x.id === paperId)
    if (!p) return null
    const backed = p.backed ?? 0
    const contra = p.contradicted ?? 0
    return {
      id: p.id ?? paperId,
      projectId,
      title: p.title,
      cite: p.cite,
      cluster: p.cluster,
      linked: p.linked,
      tally: { claims: p.claims, backed, contradicted: contra, silent: Math.max(0, p.claims - backed - contra) },
      claimsDetail: claimsFrom(p),
    }
  },

  /** Delete a project (not the catch-all Unsorted). */
  deleteProject(projectId: string): void {
    db.projects = db.projects.filter((p) => p.id !== projectId)
    delete db.libraries[projectId]
  },

  /** Create an empty project and return its id. */
  createProject(name: string): string {
    const id = `project-${seq++}`
    db.projects.unshift({
      id,
      name,
      papers: 0,
      claims: 0,
      clusters: 0,
      tally: { backed: 0, silent: 0, contradicted: 0, unchecked: 0 },
      updated: 'Created just now',
    })
    db.libraries[id] = { summary: '0 papers · new project', clusters: ['All', 'Unverified'], papers: [] }
    return id
  },

  /** Add a paper to a project's library and keep the project's counts in step. */
  addPaper(projectId: string, paper: LibraryPaper): void {
    const lib = db.libraries[projectId] ?? db.libraries.unsorted
    lib.papers.unshift(paper)
    const project = db.projects.find((p) => p.id === projectId)
    if (project) {
      project.papers = lib.papers.length
      project.updated = 'Updated just now'
    }
    const clusters = new Set(lib.papers.map((p) => p.cluster)).size
    lib.summary = `${lib.papers.length} papers · ${clusters} clusters · indexed for search by meaning`
  },

  /** File a queued suggestion out of the reading queue. */
  fileQueuePaper(paperTitle: string): void {
    db.home.queue = db.home.queue.filter((entry) => entry.paper !== paperTitle)
  },
}
