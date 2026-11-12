import { stubTeacher } from '../support/gateway'

describe('Teacher: Essay check, citation review, and feedback', () => {
  beforeEach(() => {
    stubTeacher()

    cy.intercept(
      'GET',
      '/api/teacher/classes/class-literary-2b/assignments/assignment-essay/students/student-anan/essay-check',
      {
        assignment: {
          assignmentId: 'assignment-essay',
          courseId: 'class-literary-2b',
          course: 'Literary Analysis',
          name: 'Assignment 2: Evidence-based essay',
        },
        student: { id: 'student-anan', name: 'Anan P.', fileName: 'essay-2.docx', email: 'anan@example.edu' },
        citationSummary: { total: 1, contradicted: 0, silent: 0, backed: 1 },
        reviews: [
          {
            id: 'review-1',
            standing: 'supports',
            citation: 'Smith et al. (2020)',
            claim: 'Climate impact is measurable.',
            sourceQuote: 'We observed measurable climate impacts across regions.',
            sourceLocation: 'p. 12',
            supportingUrls: [],
            professorReview: { outcome: 'not-reviewed', note: '' },
          },
        ],
        feedback: { body: '', preview: '', citedPages: [], citationIds: [] },
        navigation: {},
        analysis: { id: 'analysis-1', status: 'done', error: null },
      },
    )

    cy.intercept('GET', '/api/analyses/analysis-1', {
      id: 'analysis-1',
      file: 'essay-2.docx',
      paper: 'essay-2.docx',
      status: 'done',
      claims: [
        {
          claim: 'Climate impact is measurable.',
          sentence: 'Climate impact is measurable across all regions [1].',
          citations: [{ title: 'Smith et al. (2020)', authors: [], year: '2020', doi: '10.1000/1', arxiv: '', url: '' }],
          verdicts: [{ verdict: 'supports', quote: 'Observed impacts.', reasoning: 'Agrees.', source: 's.pdf', cited: '10.1000/1', evidence: [], pages: [12] }],
          unchecked: [],
          source: null,
        },
      ],
      stages: [],
    })
  })

  it('displays student submission details and allows recheck confirmation modal', () => {
    cy.visit(
      '/?role=teacher&screen=essay-check&courseId=class-literary-2b&assignmentId=assignment-essay&studentId=student-anan',
    )

    cy.findByRole('heading', { level: 1, name: 'Anan P.' }).should('be.visible')
    cy.findByText('essay-2.docx').should('be.visible')

    // Click Recheck essay
    cy.findByRole('button', { name: 'Recheck essay' }).click()
    cy.findByRole('dialog', { name: 'Recheck this essay?' }).should('be.visible')

    // Cancel modal
    cy.findByRole('button', { name: 'Cancel' }).click()
    cy.findByRole('dialog', { name: 'Recheck this essay?' }).should('not.exist')
  })

  it('drafts and saves feedback for student', () => {
    cy.intercept(
      'PUT',
      '/api/teacher/classes/class-literary-2b/assignments/assignment-essay/essay-check/feedback',
      { statusCode: 200, body: {} },
    ).as('saveFeedback')

    cy.visit(
      '/?role=teacher&screen=essay-check&courseId=class-literary-2b&assignmentId=assignment-essay&studentId=student-anan',
    )

    const feedbackInput = cy.findByRole('textbox', { name: 'Email message to the student' })
    feedbackInput.type('Strong citation analysis. Consider reviewing the conclusion.')

    cy.findByRole('button', { name: 'Save draft' }).click()
    cy.wait('@saveFeedback').its('request.body').should('include', {
      studentId: 'student-anan',
    })
  })
})
