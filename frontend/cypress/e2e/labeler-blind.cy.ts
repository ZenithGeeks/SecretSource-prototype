import { chooseRole, stubLabeler } from '../support/gateway'

describe('Labeler: blind checks', () => {
  it('shows the Blind checks tab to a lead', () => {
    stubLabeler({ lead: true, blind_checks: [{ name: 'Chanya', analysis_id: 'cv1' }] })
    chooseRole('Labeler')

    cy.findByRole('button', { name: 'Blind checks' }).click()
    cy.findByText('Assign blind checks').should('be.visible')
  })

  it('does not show the lead\'s assign form to someone who is not a lead', () => {
    stubLabeler({ blind: ['cv1'] })
    chooseRole('Labeler')

    cy.findByRole('button', { name: 'Blind checks' }).click()
    cy.findByText('A CV paper to check blind').should('be.visible')
    cy.findByText('Assign blind checks').should('not.exist')
  })

  it('turns Review and Ask off on a blind paper', () => {
    stubLabeler({ blind: ['cv1'] })
    chooseRole('Labeler')

    cy.findByRole('button', { name: 'Blind checks' }).click()
    cy.findByRole('button', { name: 'Start' }).click()
    cy.findByText('Blind check').should('be.visible')

    cy.findByRole('button', { name: /^Ask AI/ }).click()
    cy.findByText(/Review and Ask are off on a blind check/).should('be.visible')
    cy.findByRole('button', { name: 'Review' }).should('not.exist')
    cy.findByRole('button', { name: 'Ask' }).should('not.exist')
  })
})
