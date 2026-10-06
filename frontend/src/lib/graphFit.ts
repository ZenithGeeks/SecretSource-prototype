import type cytoscape from 'cytoscape'

/** Fit the whole graph, but never so far out that it reads tiny: below 0.9 the labels blur, so
 * clamp to 0.9 and centre and let the user pan or press Fit. A no-op once the graph is destroyed
 * (cola layouts and rAF callbacks can outlive the component). */
export function fitReadable(cy: cytoscape.Core): void {
  if (cy.destroyed()) return
  cy.resize()
  cy.fit(undefined, 40)
  if (cy.zoom() < 0.9) {
    cy.zoom({ level: 0.9, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  }
}
