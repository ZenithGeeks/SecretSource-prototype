import { stubTeacher } from '../support/gateway'

describe('Teacher: Classes list and navigation', () => {
  beforeEach(() => {
    stubTeacher()
  })

  it('lists imported classes and filters by query', () => {
    cy.visit('/?role=teacher&screen=classes')

    cy.findByRole('heading', { level: 1, name: 'Classes' }).should('be.visible')
    cy.findByRole('heading', { level: 2, name: 'Literary Analysis' }).should('be.visible')
    cy.findByRole('heading', { level: 2, name: 'Modern Writing' }).should('be.visible')

    // Filter by Modern
    cy.findByRole('textbox', { name: 'Search classes' }).type('Modern')
    cy.findByRole('heading', { level: 2, name: 'Modern Writing' }).should('be.visible')
    cy.findByRole('heading', { level: 2, name: 'Literary Analysis' }).should('not.exist')
  })

  it('opens class workspace when clicking a class card', () => {
    cy.visit('/?role=teacher&screen=classes')

    cy.findByRole('button', { name: /Literary Analysis/ }).click()
    cy.url().should('include', 'screen=class-overview')
    cy.url().should('include', 'courseId=class-literary-2b')
    cy.findByRole('heading', { level: 1, name: /Literary Analysis/ }).should('be.visible')
  })

  it('navigates to add-class wizard on "Add class" click', () => {
    cy.visit('/?role=teacher&screen=classes')

    cy.findByRole('button', { name: 'Add class' }).click()
    cy.url().should('include', 'screen=add-class-connect')
    cy.findByRole('heading', { level: 1, name: 'Connect Google Classroom' }).should('be.visible')
  })
})
