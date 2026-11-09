import { chooseRole, stubResearcher } from '../support/gateway'

describe('Researcher: analyses history', () => {
  it('reopens a past analysis from the sidebar and shows its claim and verdict', () => {
    stubResearcher()
    chooseRole('Researcher')

    cy.findByRole('button', { name: 'Analyses' }).click()
    cy.findByText('Recent analyses').should('be.visible')

    cy.findByText('colbert-v2.pdf').click()
    cy.findByText('Late interaction generalizes across domains.').should('be.visible')
    cy.findByRole('button', { name: '1 silent' }).should('be.visible')
  })
})
