import '@testing-library/cypress/add-commands'

// Every /api call that a spec does not stub gets a 404, so no test reaches a real gateway.
// Later intercepts win, so a spec's own stubs and the health check override this one.
beforeEach(() => {
  cy.intercept('/api/**', { statusCode: 404, body: { detail: 'not stubbed in e2e' } })
  cy.intercept('GET', '/api/health', { features: { analyses: true, ask: true } })
  // index.html links Google Fonts; the page falls back to system fonts without it.
  cy.intercept('https://fonts.googleapis.com/**', { statusCode: 200, headers: { 'content-type': 'text/css' }, body: '' })
})
