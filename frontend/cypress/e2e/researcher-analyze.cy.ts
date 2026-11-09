import { chooseRole, stubResearcher } from '../support/gateway'

describe('Researcher: analyze a paper', () => {
  it('starts an analysis from Home and follows it to claim cards with verdicts', () => {
    stubResearcher()
    cy.fixture('analysis-running').then((running) => {
      cy.fixture('analysis-done').then((done) => {
        let finished = false
        cy.intercept('POST', '/api/analyses', { body: { id: 'a-new' } }).as('start')
        cy.intercept('GET', '/api/analyses/a-new', (req) => req.reply(finished ? done : running))
        // The stage stream replays what is recorded, then reports the end a moment later.
        cy.intercept('GET', '/api/analyses/a-new/events', (req) => {
          finished = true
          const stages = done.stages.map((stage: object) => `data: ${JSON.stringify(stage)}\n\n`).join('')
          req.reply({ headers: { 'content-type': 'text/event-stream' }, body: stages, delay: 1500 })
        })
      })
    })

    chooseRole('Researcher')
    cy.findByRole('heading', { level: 1, name: /^Good / }).should('be.visible')

    cy.findByLabelText('Paper to analyze').type('10.1145/new-paper')
    cy.findByRole('button', { name: 'Analyze' }).click()
    cy.wait('@start').its('request.body').should('deep.equal', { paper: '10.1145/new-paper', verify: true })

    // Running first: the breadcrumb names the paper, the claims are not there yet.
    cy.findByText('Late interaction beats single-vector retrieval.').should('not.exist')

    cy.findByText('Late interaction beats single-vector retrieval.', { timeout: 10000 }).should('be.visible')
    cy.findByText('Index size shrinks tenfold with residual compression.').should('be.visible')
    cy.findByRole('button', { name: '1 contradicts' }).should('be.visible')
    cy.findByRole('button', { name: '1 backs it' }).should('be.visible')
  })
})
