/**
 * In-session mutable store for the researcher screens. Seeded from the mocks and mutated by
 * the UI so create/add actions actually persist while the app is open (until real gateway
 * endpoints exist). researcher.ts reads its getters through this; mutations run via
 * useResearcherActions, which invalidates the relevant React Query caches.
 */

import { MOCK_HOME, MOCK_LIBRARIES, MOCK_PROJECTS } from '../mocks/researcher'
import type { LibraryPaper, Project, ResearcherHome, ResearcherLibrary } from './researcher'

/** Deep clone so mutations never touch the shared mock module. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const db = {
  projects: clone(MOCK_PROJECTS) as Project[],
  libraries: clone(MOCK_LIBRARIES) as Record<string, ResearcherLibrary>,
  home: clone(MOCK_HOME) as ResearcherHome,
}

let seq = 1

export const store = {
  projects: (): Project[] => db.projects,
  library: (id: string): ResearcherLibrary => db.libraries[id] ?? db.libraries['retrieval-survey'],
  home: (): ResearcherHome => db.home,

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
