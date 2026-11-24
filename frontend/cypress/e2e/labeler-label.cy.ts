import { chooseRole, stubLabeler } from '../support/gateway'

describe('Labeler: label a paper', () => {
  beforeEach(() => {
    stubLabeler()
  })

  it('picks a topic and the table lists the papers', () => {
    cy.intercept('PUT', '/api/labeling/people', { body: {} }).as('setTopic')
    chooseRole('Labeler')
    // The team's topics are folded behind Team until asked for (#1059).
    cy.findByRole('button', { name: 'Team' }).click()

    cy.findByRole('radiogroup', { name: 'Topic for Chanya' }).within(() => {
      cy.findByRole('radio', { name: 'NLP' }).click()
    })
    cy.wait('@setTopic').its('request.body').should('deep.equal', { name: 'Chanya', topic: 'NLP' })
    cy.findByText('Late interaction retrieval').should('be.visible')
  })

  it('saves a level and a rationale for a claim, then moves to the next claim', () => {
    cy.intercept('POST', '/api/labeling/sessions/nlp1/save', { body: { claims: 1, candidates: 1, labels: 1 } }).as('save')
    chooseRole('Labeler')

    cy.findByRole('button', { name: 'Late interaction retrieval (Label)' }).click()
    cy.findByRole('heading', { name: 'Claim 1 of 2' }).should('be.visible')

    cy.findByRole('radiogroup', { name: 'Decision on this claim' }).within(() => {
      cy.findByRole('radio', { name: /Keep/ }).click()
    })
    cy.findByRole('radiogroup', { name: /^Passage 1 of/ }).within(() => {
      cy.findByRole('radio', { name: /^Relevant/ }).click()
    })
    cy.findByRole('radio', { name: '3 · Clear' }).click()
    cy.findByLabelText(/^Why this level/).type('The table shows a four point gain.')
    cy.window().then((win) => {
      expect(win.document.documentElement.scrollHeight).to.be.at.most(win.innerHeight)
    })

    cy.findByRole('button', { name: 'Save and next claim' }).click()

    cy.wait('@save').its('request.body').then((body) => {
      expect(body.claims[0]).to.include({ claim_id: 'nlp1#0', status: 'accepted' })
      expect(body.candidates[0]).to.include({ cand_id: 'c1', status: 'relevant' })
      expect(body.labels[0]).to.include({
        claim_id: 'nlp1#0',
        reference_id: 'refB',
        evidence: 3,
        rationale: 'The table shows a four point gain.',
      })
    })
    cy.findByRole('heading', { name: 'Claim 2 of 2' }).should('be.visible')
  })

  it('keeps a short wide window on the workspace: only the panels scroll', () => {
    // Short enough that the label panel overflows. Absolute elements deep in it (sr-only
    // inputs) used to escape the locked shell and let the window scroll the workspace away.
    cy.viewport(1440, 560)
    chooseRole('Labeler')
    cy.findByRole('button', { name: 'Late interaction retrieval (Label)' }).click()
    cy.findByRole('heading', { name: 'Claim 1 of 2' }).should('be.visible')
    cy.findByRole('radiogroup', { name: 'Decision on this claim' }).within(() => {
      cy.findByRole('radio', { name: /Keep/ }).click()
    })
    // Judging a passage shows the level form, whose sr-only radios sit below the fold.
    cy.findByRole('radiogroup', { name: /^Passage 1 of/ }).within(() => {
      cy.findByRole('radio', { name: /^Relevant/ }).click()
    })
    cy.findByRole('radio', { name: '3 · Clear' }).should('exist')

    cy.window().then((win) => {
      const doc = win.document
      expect(doc.documentElement.scrollHeight, 'page height').to.be.at.most(win.innerHeight)
      const sidebar = doc.querySelector('aside[aria-label="Sidebar"]') as HTMLElement
      expect(sidebar.scrollWidth, 'sidebar width').to.be.at.most(sidebar.clientWidth)
      const scrolls = [...doc.querySelectorAll('main *')].filter((el) => {
        const style = win.getComputedStyle(el)
        return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight
      })
      expect(scrolls.length, 'panels that scroll').to.be.greaterThan(0)
    })
  })
})
