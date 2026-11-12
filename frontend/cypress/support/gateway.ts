/** Stubs for the gateway routes the Researcher and Labeler screens call, and the role picker. */

/** Opens the app on the role picker and picks a role, as a first-time visitor does. */
export function chooseRole(role: 'Researcher' | 'Labeler' | 'Teacher') {
  cy.visit('/')
  cy.findByRole('radio', { name: new RegExp(role) }).click()
  cy.findByRole('button', { name: `Continue as ${role}` }).click()
}

/** The Researcher's Home, projects, library and graph, plus one past analysis in the sidebar. */
export function stubResearcher() {
  cy.fixture('analysis-old').then((old) => {
    cy.intercept('GET', '/api/analyses', [old])
    cy.intercept('GET', '/api/analyses/a-old', old)
  })
  cy.intercept('GET', '/api/researcher/home', { fixture: 'researcher-home.json' })
  cy.intercept('GET', '/api/researcher/projects', { fixture: 'projects.json' })
  cy.intercept('GET', '/api/researcher/projects/p1/library', { fixture: 'library.json' })
  cy.intercept('GET', '/api/researcher/graph', { fixture: 'graph.json' })
}

/** The Labeler's status, paper pool and the two sessions a spec opens. */
export function stubLabeler(pool: Record<string, unknown> = {}) {
  cy.fixture('labeler-pool').then((base) => {
    cy.intercept('GET', '/api/labeling/pool', { ...base, ...pool })
  })
  cy.intercept('GET', '/api/labeling/status', { annotator: 'Chanya', configured: true, scopus: true })
  cy.intercept('GET', '/api/labeling/sessions/nlp1', { fixture: 'labeler-session.json' })
  cy.intercept('GET', '/api/labeling/sessions/cv1', { fixture: 'labeler-session-blind.json' })
}

/** The Teacher's Home, classes, workspace, history, and Classroom connection status. */
export function stubTeacher() {
  cy.intercept('GET', '/api/teacher/home', { fixture: 'teacher-home.json' })
  cy.intercept('GET', '/api/teacher/classes', { fixture: 'teacher-classes.json' })
  cy.intercept('GET', '/api/teacher/classes/class-literary-2b/workspace', { fixture: 'teacher-workspace.json' })
  cy.intercept('GET', '/api/teacher/classes/class-modern-writing-1a/workspace', { fixture: 'teacher-workspace.json' })
  cy.intercept('GET', '/api/teacher/history', [])
  cy.intercept('GET', '/api/teacher/google/status', { connected: true, email: 'teacher@example.edu', scopes: [] })
}

