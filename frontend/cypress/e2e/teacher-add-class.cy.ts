import { stubTeacher } from '../support/gateway'

describe('Teacher: Add class wizard flow', () => {
  beforeEach(() => {
    stubTeacher()

    cy.intercept('GET', '/api/teacher/classes/importable', [
      {
        id: 'class-cpe-401',
        name: 'Distributed Systems',
        section: 'Sec 1',
        subject: 'Computer Engineering',
        status: 'active',
        studentCount: 35,
        assignmentCount: 6,
        topicCount: 4,
        teacherName: 'Prof. Turing',
      },
    ])

    cy.intercept('GET', '/api/teacher/classes/importable/class-cpe-401/preview', {
      course: {
        id: 'class-cpe-401',
        name: 'Distributed Systems',
        section: 'Sec 1',
        subject: 'Computer Engineering',
        status: 'active',
        studentCount: 35,
        assignmentCount: 6,
        topicCount: 4,
        teacherName: 'Prof. Turing',
      },
      resources: [
        { key: 'course', label: 'Course information', count: 1, detail: 'Classroom course settings' },
        { key: 'people', label: 'Roster', count: 35, detail: 'Enrolled students and teachers' },
        { key: 'classwork', label: 'Assignments', count: 6, detail: 'Course work items' },
      ],
    })
  })

  it('completes the full Add Class workflow from Connect to Review Import', () => {
    cy.intercept('POST', '/api/teacher/classes/class-cpe-401/import', {
      body: {
        course: {
          id: 'class-cpe-401',
          name: 'Distributed Systems',
          section: 'Sec 1',
          subject: 'Computer Engineering',
          status: 'active',
          studentCount: 35,
          assignmentCount: 6,
          topicCount: 4,
          announcementCount: 0,
          linkedFileCount: 0,
          teacherName: 'Prof. Turing',
          lastSyncedAt: 'Today',
        },
      },
    }).as('importClass')

    cy.visit('/?role=teacher&screen=add-class-connect')

    // Step 1: Connect
    cy.findByRole('heading', { level: 1, name: 'Connect Google Classroom' }).should('be.visible')
    cy.findByRole('button', { name: 'Continue with Google' }).click()

    // Step 2: Choose class
    cy.url().should('include', 'screen=add-class-course')
    cy.findByRole('heading', { level: 1, name: 'Choose a class' }).should('be.visible')
    cy.findByText(/Distributed Systems · Sec 1/).should('be.visible')

    // Select course
    cy.findByRole('button', { name: /Distributed Systems/ }).click()
    cy.findByRole('button', { name: 'Review import' }).click()

    // Step 3: Review import
    cy.url().should('include', 'screen=add-class-review')
    cy.findByRole('heading', { level: 1, name: 'Review class import' }).should('be.visible')
    cy.findByText('Course information').should('be.visible')
    cy.findByText('Assignments').should('be.visible')

    // Click Import class
    cy.findByRole('button', { name: 'Import class' }).click()
    cy.wait('@importClass')

    // Redirects to class overview
    cy.url().should('include', 'screen=class-overview')
    cy.url().should('include', 'courseId=class-cpe-401')
  })

  it('navigates back to Connect step using Back button', () => {
    cy.visit('/?role=teacher&screen=add-class-course')

    cy.findByRole('heading', { level: 1, name: 'Choose a class' }).should('be.visible')
    cy.findByRole('button', { name: 'Back' }).click()

    cy.url().should('include', 'screen=add-class-connect')
    cy.findByRole('heading', { level: 1, name: 'Connect Google Classroom' }).should('be.visible')
  })

  it('displays error alert when import fails on review step', () => {
    cy.intercept('POST', '/api/teacher/classes/class-cpe-401/import', {
      statusCode: 500,
      body: { message: 'Google Classroom API quota exceeded' },
    })

    cy.visit('/?role=teacher&screen=add-class-review&courseId=class-cpe-401')

    cy.findByRole('button', { name: 'Import class' }).click()
    cy.findByRole('alert').should('contain.text', 'Google Classroom API quota exceeded')
  })
})
