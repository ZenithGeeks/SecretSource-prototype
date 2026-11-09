import { chooseRole, stubResearcher } from '../support/gateway'

describe('Researcher: library', () => {
  it('lists the projects, and opening one shows its papers', () => {
    stubResearcher()
    chooseRole('Researcher')

    cy.findByRole('button', { name: 'Library' }).click()
    cy.findByRole('heading', { name: 'Library' }).should('be.visible')

    cy.findByRole('button', { name: 'Open Retrieval survey' }).click()
    cy.findByRole('heading', { name: 'Retrieval survey' }).should('be.visible')
    cy.findByText('ColBERTv2').should('be.visible')
    cy.findByText('Tevatron toolkit').should('be.visible')
  })
})
