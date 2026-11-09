import { chooseRole, stubResearcher } from '../support/gateway'

describe('Researcher: graph', () => {
  it('counts the papers and claims and draws the graph on a canvas', () => {
    stubResearcher()
    chooseRole('Researcher')

    cy.findByRole('button', { name: 'Graph' }).click()
    cy.findByText('2 papers · 1 claims').should('be.visible')
    // Cytoscape draws on canvas layers, so its nodes are not in the DOM to query.
    cy.get('canvas').should(($canvases) => {
      expect($canvases.length).to.be.greaterThan(0)
      expect($canvases[0].width).to.be.greaterThan(0)
    })
  })
})
