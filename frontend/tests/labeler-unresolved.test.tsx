/** A claim whose cited work has no PDF: which reference opens for it (never one it does not cite),
 * and the card the reference pane shows for each work that could not be read. */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  citedReferences,
  citedRefs,
  uncheckedReason,
  unresolvedCitations,
  type Reference,
  type SessionClaim,
  type Unresolved,
} from '../src/lib/labeling'
import { UnresolvedReferences } from '../src/roles/labeler/components/UnresolvedReferences'

const claim = (over: Partial<SessionClaim> = {}): SessionClaim => ({
  claim_id: 'paperA#0',
  claim: 'GPU systems make up six of the ten fastest.',
  sentence: 'GPU-based systems make up six of the ten most powerful HPC systems [b23].',
  section: '1',
  source: null,
  candidates: [],
  ...over,
})
const references: Reference[] = [
  { reference_id: 'refB', file: 'refB.pdf', label: 'Ref B', ref: 'b4' },
  { reference_id: 'refC', file: 'refC.pdf', label: 'Ref C' }, // no marker known
  { reference_id: 'refD', file: 'refD.pdf', label: 'Ref D', ref: 'b8' },
]
const TOP500 = { ref: 'b23', label: 'Top500', reason: 'not-downloadable', url: 'https://www.top500.org/', doi: '', year: '2021' }

describe('the references a claim cites', () => {
  it('takes the gateway’s list, in the claim’s order, and only the ones with a PDF', () => {
    const cites = claim({ cited: ['b23', 'b8', 'b4'] })
    expect(citedRefs(cites)).toEqual(['b23', 'b8', 'b4'])
    expect(citedReferences(cites, references).map((r) => r.reference_id)).toEqual(['refD', 'refB'])
  })

  it('reads the markers in the sentence when the gateway is older than the list', () => {
    const cites = claim({ sentence: 'As shown before [b8, b99]; see also [b4].' })
    expect(citedRefs(cites)).toEqual(['b8', 'b99', 'b4'])
    expect(citedReferences(cites, references).map((r) => r.reference_id)).toEqual(['refD', 'refB'])
  })

  it('is empty for a claim that cites nothing, whatever the analysis read', () => {
    expect(citedReferences(claim({ cited: [] }), references)).toEqual([])
    expect(citedReferences(claim({ sentence: 'No marker here.' }), references)).toEqual([])
  })
})

describe('unresolvedCitations', () => {
  const session = { references, unread: [] as Reference[] }

  it('lists a citation that was not checked, with its reason in words and its link', () => {
    expect(unresolvedCitations(claim({ cited: ['b23'], unchecked: [TOP500] }), session)).toEqual([
      {
        ref: 'b23',
        label: 'Top500',
        year: '2021',
        reason: 'the PDF would not download',
        links: [{ text: 'https://www.top500.org/', href: 'https://www.top500.org/' }],
      },
    ])
  })

  it('links a DOI through doi.org, before the URL, with its odd characters escaped', () => {
    const row = { ...TOP500, doi: '10.1002/(SICI)1097-0258<1::AID>3.0.CO;2-#', url: 'http://example.org/paper' }
    expect(unresolvedCitations(claim({ unchecked: [row] }), session)[0].links).toEqual([
      { text: 'doi:10.1002/(SICI)1097-0258<1::AID>3.0.CO;2-#', href: 'https://doi.org/10.1002/(SICI)1097-0258%3C1%3A%3AAID%3E3.0.CO%3B2-%23' },
      { text: 'http://example.org/paper', href: 'http://example.org/paper' },
    ])
  })

  it('follows only http and https links: the link comes from a PDF', () => {
    const rows = [
      { ...TOP500, url: 'javascript:alert(1)' },
      { ...TOP500, ref: 'b24', url: 'ftp://example.org/file' },
    ]
    expect(unresolvedCitations(claim({ unchecked: rows }), session).map((c) => c.links)).toEqual([[], []])
  })

  it('reads a row from a gateway older than the link fields', () => {
    const [row] = unresolvedCitations(claim({ unchecked: [{ ref: 'b23', label: 'Top500', reason: 'web-source' }] }), session)
    expect(row).toEqual({ ref: 'b23', label: 'Top500', year: '', reason: 'a web page, not a paper we can check a claim against', links: [] })
  })

  it('keeps the legacy wording for old unresolved citations without a lookup identifier', () => {
    const [row] = unresolvedCitations(claim({
      unchecked: [{ ref: 'b23', label: 'A talk', reason: 'unresolvable' }],
    }), session)
    expect(row.reason).toBe('no DOI or arXiv ID to look it up by')
  })

  it('keeps the legacy web-page wording for older unresolved citations with a URL', () => {
    const [row] = unresolvedCitations(claim({
      unchecked: [{ ref: 'b23', label: 'A site', reason: 'unresolvable', url: 'https://example.org' }],
    }), session)
    expect(row.reason).toBe('a web page, not a paper we can check a claim against')
  })

  it('keeps the legacy index wording when an older unresolved citation has a DOI', () => {
    const [row] = unresolvedCitations(claim({
      unchecked: [{ ref: 'b23', label: 'A paper', reason: 'unresolvable', doi: '10.1000/example' }],
    }), session)
    expect(row.reason).toBe('no matching work was found in the indexes checked')
  })

  it('leaves out a work that has a PDF from another claim: that one opens', () => {
    const named = { ref: 'b4', label: 'Ref B', reason: 'named' }
    expect(unresolvedCitations(claim({ cited: ['b4', 'b23'], unchecked: [named, TOP500] }), session).map((c) => c.ref)).toEqual(['b23'])
  })

  it('adds a cited work that was never looked up, once, after the unchecked ones', () => {
    const unread: Reference[] = [
      { reference_id: 'unread-b23', file: '', label: 'Top500', ref: 'b23', year: '2021' },
      { reference_id: 'unread-b30', file: '', label: 'A talk', ref: 'b30' },
      { reference_id: 'unread-b31', file: '', label: 'Cited elsewhere', ref: 'b31' },
      { reference_id: 'unread-x', file: '', label: 'No marker' },
    ]
    const rows = unresolvedCitations(claim({ cited: ['b23', 'b30'], unchecked: [TOP500] }), { references, unread })
    expect(rows.map((c) => [c.ref, c.label, c.year, c.reason])).toEqual([
      ['b23', 'Top500', '2021', 'the PDF would not download'],
      ['b30', 'A talk', '', 'this reference was not checked in the analysis'],
    ])
    expect(rows[1].sourceOutcome).toEqual({
      source_kind: 'unknown', outcome: 'not-attempted', retryable: false, attempts: [],
    })
  })

  it('is empty for a claim that cites nothing, and for a gateway with neither field', () => {
    expect(unresolvedCitations(claim({ cited: [], unchecked: [] }), session)).toEqual([])
    expect(unresolvedCitations(claim(), { references })).toEqual([])
  })
})

describe('uncheckedReason', () => {
  it('has words for "named", api.ts’s words for its codes, and something for a code it does not know', () => {
    expect(uncheckedReason('named')).toBe('the paper only names it, so it was not checked')
    expect(uncheckedReason('no-open-access')).toBe('no free copy published')
    expect(uncheckedReason('a-new-code')).toBe('checking it failed')
    expect(uncheckedReason('failed', {
      source_kind: 'paper', outcome: 'no-accessible-copy', retryable: false, attempts: [],
    })).toBe('the work was identified, but no free copy was found')
  })
})

describe('UnresolvedReferences', () => {
  const card = (over: Partial<Unresolved> = {}): Unresolved => ({
    ref: 'b23',
    label: 'Top500',
    year: '2021',
    reason: 'the PDF would not download',
    links: [{ text: 'https://www.top500.org/', href: 'https://www.top500.org/' }],
    ...over,
  })

  it('shows a card with the marker, title, year, reason and a link that opens in a new tab', () => {
    render(<UnresolvedReferences citations={[card()]} />)
    const pane = within(screen.getByRole('region', { name: 'Reference not found' }))
    expect(pane.getByText('This claim cites 1 work we could not read.')).toBeInTheDocument()
    const item = pane.getByRole('listitem')
    expect(item).toHaveTextContent('[b23] Top500 (2021)')
    expect(item).toHaveTextContent('Not read: the PDF would not download')
    const link = within(item).getByRole('link', { name: /https:\/\/www\.top500\.org\// })
    expect(link).toHaveAttribute('href', 'https://www.top500.org/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAccessibleName(/opens in a new tab/)
    expect(screen.queryByText('No reference paper')).toBeNull()
  })

  it('links the DOI and the URL when the reference has both', () => {
    const doi = { text: 'doi:10.1016/j.jpdc.2014.07.003', href: 'https://doi.org/10.1016/j.jpdc.2014.07.003' }
    render(<UnresolvedReferences citations={[card({ links: [doi, card().links[0]] })]} />)
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([doi.href, 'https://www.top500.org/'])
  })

  it('shows a sanitized retrieval attempt and distinguishes a retryable outage', () => {
    render(<UnresolvedReferences citations={[
      card({
        reason: 'the source location blocked the download',
        links: [],
        sourceOutcome: {
          source_kind: 'paper', outcome: 'blocked', retryable: false,
          attempts: [{
            provider: 'unpaywall', result: 'blocked', host: 'publisher.example',
            locator: 'https://publisher.example/paper.pdf', status_code: 403,
          }],
        },
      }),
      card({
        ref: 'b24',
        reason: 'a lookup or download failed temporarily',
        links: [],
        sourceOutcome: {
          source_kind: 'unknown', outcome: 'temporary-failure', retryable: true,
          attempts: [{
            provider: 'semantic_scholar', result: 'temporary-failure',
            host: 'api.semanticscholar.org', locator: 'javascript:ignored', status_code: 503,
          }, { provider: 'resolver', result: 'no-match' }],
        },
      }),
    ]} />)

    expect(screen.getByText('This may be a temporary failure; retrying later may help.')).toBeInTheDocument()
    const attempts = screen.getAllByText(/unpaywall: blocked|semantic_scholar: temporary-failure/)
    expect(attempts).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'https://publisher.example/paper.pdf' }))
      .toHaveAttribute('href', 'https://publisher.example/paper.pdf')
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument()
  })

  it('shows one card for each work, and one with no marker, year or link as just its title and reason', () => {
    const bare = card({ ref: '', label: 'A talk', year: '', reason: 'the paper only names it, so it was not checked', links: [] })
    render(<UnresolvedReferences citations={[card(), bare]} />)
    expect(screen.getByText('This claim cites 2 works we could not read.')).toBeInTheDocument()
    const [, second] = screen.getAllByRole('listitem')
    expect(second.querySelector('p')).toHaveTextContent(/^A talk$/)
    expect(second).toHaveTextContent('Not read: the paper only names it, so it was not checked')
    expect(within(second).queryByRole('link')).toBeNull()
  })

  it('says "No reference paper" only for a claim that cites nothing', () => {
    render(<UnresolvedReferences citations={[]} />)
    expect(screen.getByText('No reference paper')).toBeInTheDocument()
    expect(screen.getByText('This claim cites no paper.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Reference not found' })).toBeNull()
  })
})
