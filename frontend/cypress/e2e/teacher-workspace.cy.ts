import { stubTeacher } from '../support/gateway'

describe('Teacher: Class workspace tabs and classwork', () => {
  beforeEach(() => {
    stubTeacher()
  })

  it('displays overview tab with stats and switches tabs', () => {
    cy.visit('/?role=teacher&screen=class-overview&courseId=class-literary-2b')

    // Header info
    cy.findByRole('heading', { level: 1, name: /Literary Analysis · 2B/ }).should('be.visible')
    cy.findByRole('tab', { name: 'Overview' }).should('have.attr', 'aria-selected', 'true')

    // Switch to People tab
    cy.findByRole('tab', { name: 'People' }).click()
    cy.url().should('include', 'screen=people')
    cy.findByRole('region', { name: 'Teachers' }).should('be.visible')
    cy.findByRole('region', { name: 'Students' }).should('be.visible')
    cy.findByText('Alex S.').should('be.visible')
    cy.findByText('Anan P.').should('be.visible')

    // Switch to Classwork tab
    cy.findByRole('tab', { name: 'Classwork' }).click()
    cy.url().should('include', 'screen=classwork')
    cy.findByText('Assignment 2: Evidence-based essay').should('be.visible')
  })

  it('allows selecting assignments in Classwork tab and triggers batch check', () => {
    cy.intercept('POST', '/api/teacher/classes/class-literary-2b/essay-checks:prepare', {
      body: {
        prepared: [
          {
            assignmentId: 'assignment-essay',
            submissionId: 'sub-anan-essay',
            studentId: 'student-anan',
            studentName: 'Anan P.',
            analysisId: 'analysis-1',
            status: 'running',
          },
        ],
        skipped: [],
        failed: [],
      },
    }).as('prepareChecks')

    cy.visit('/?role=teacher&screen=classwork&courseId=class-literary-2b')

    // Select the assignment checkbox
    cy.findByRole('checkbox', { name: 'Select Assignment 2: Evidence-based essay' }).click()

    // The batch check button should become visible with count
    const checkBtn = cy.findByRole('button', { name: /^Check \d+ essays?$/ })
    checkBtn.should('be.visible').click()

    cy.wait('@prepareChecks').its('request.body').should('deep.equal', {
      assignmentIds: ['assignment-essay'],
    })
    cy.findByText('1 essay added to review.').should('be.visible')
  })
})
