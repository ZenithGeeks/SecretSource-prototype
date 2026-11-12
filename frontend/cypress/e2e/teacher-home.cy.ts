import { chooseRole, stubTeacher } from '../support/gateway'

describe('Teacher: Home overview and quick actions', () => {
  it('loads home overview and displays review queue and quick actions', () => {
    stubTeacher()
    chooseRole('Teacher')

    // Heading greeting is visible
    cy.findByRole('heading', { level: 1, name: /^Good morning/ }).should('be.visible')
    cy.findByText(/awaiting review/).should('be.visible')

    // Quick action buttons
    cy.findByRole('button', { name: /Check student essays/ }).should('be.visible')
    cy.findByRole('button', { name: /Due soon/ }).should('be.visible')

    // Submissions listed under Literary Analysis
    cy.findByRole('heading', { level: 2, name: 'Literary Analysis' }).should('be.visible')
    cy.findByText('Anan P.').should('be.visible')

    // Classroom sync card displays email
    cy.findByText('Google Classroom sync').should('be.visible')
    cy.findByText(/teacher@example\.edu/).should('be.visible')
  })

  it('navigates to assignment detail when "Check student essays" is clicked', () => {
    stubTeacher()
    cy.intercept('GET', '/api/teacher/classes/class-literary-2b/assignments/assignment-essay', {
      assignment: {
        id: 'assignment-essay',
        title: 'Assignment 2: Evidence-based essay',
        dueAt: 'Tomorrow, 11:59 PM',
        enrolledCount: 25,
        submittedCount: 19,
        missingCount: 6,
        returnedCount: 0,
        pendingReviewCount: 2,
      },
      submissions: [],
    })

    cy.visit('/?role=teacher&screen=home')
    cy.findByRole('button', { name: /Check student essays/ }).click()

    cy.url().should('include', 'screen=assignment-detail')
    cy.url().should('include', 'courseId=class-literary-2b')
  })

  it('shows error state and allows retry when home overview fails to load', () => {
    cy.intercept('GET', '/api/teacher/home', { statusCode: 500, body: { error: 'Database unavailable' } })
    cy.intercept('GET', '/api/teacher/classes', { fixture: 'teacher-classes.json' })
    cy.intercept('GET', '/api/teacher/history', [])
    cy.intercept('GET', '/api/teacher/google/status', { connected: true, email: 'teacher@example.edu' })

    cy.visit('/?role=teacher&screen=home')

    cy.findByRole('heading', { level: 1, name: 'Your overview could not load' }).should('be.visible')
    cy.findByRole('button', { name: 'Try again' }).should('be.visible')
  })
})
