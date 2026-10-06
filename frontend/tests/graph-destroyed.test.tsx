import cytoscape from 'cytoscape'
import { describe, expect, test } from 'vitest'

import { fitReadable } from '../src/lib/graphFit'

describe('fitReadable', () => {
  test('does not throw on a destroyed cytoscape core', () => {
    const cy = cytoscape({ headless: true, elements: [{ data: { id: 'a' } }] })
    cy.destroy()
    expect(() => fitReadable(cy)).not.toThrow()
  })

  test('still fits a live core', () => {
    const cy = cytoscape({ headless: true, elements: [{ data: { id: 'a' } }] })
    expect(() => fitReadable(cy)).not.toThrow()
    cy.destroy()
  })
})
