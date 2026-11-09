/**
 * The Ask panel's /commands and @ papers (lib/askCommands, components/AskInput): the menus list
 * and filter, a line parses into the tool's arguments, a result reads as statements or a note, and
 * a command runs the tool through POST /agent/tools/{name}.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantPanel } from '../src/components/AssistantPanel'
import { CommandResult } from '../src/components/CommandResult'
import { describeResult, matchCommands, matchPapers, parseCommand, withMention } from '../src/lib/askCommands'
import { useAssistant } from '../src/lib/assistant'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const PAPERS = [
  { id: 'a1', label: 'Lost in the Middle' },
  { id: 'a2', label: 'Lost in the Middle 2' },
  { id: 'a3', label: 'ColBERTv2' },
]

describe('command and paper matching', () => {
  it('lists the commands that start with what follows the slash, and nothing once there is an argument', () => {
    expect(matchCommands('/')).toHaveLength(10)
    expect(matchCommands('/get_c').map((c) => c.name)).toEqual(['get_claim'])
    expect(matchCommands('/get_claim @Lost')).toEqual([])
    expect(matchCommands('why is this')).toEqual([])
  })

  it('lists papers by a word of their name after the last @', () => {
    expect(matchPapers('/get_analysis @col', PAPERS).map((p) => p.id)).toEqual(['a3'])
    expect(matchPapers('/get_analysis @', PAPERS)).toHaveLength(3)
    expect(matchPapers('no mention here', PAPERS)).toEqual([])
    expect(withMention('/get_analysis @col', PAPERS[2])).toBe('/get_analysis @ColBERTv2 ')
  })
})

describe('parsing a command line', () => {
  it('takes the paper from the @mention, the longest name first, and the claim number from the end', () => {
    expect(parseCommand('/get_claim @Lost in the Middle 2 3', PAPERS)).toEqual({
      name: 'get_claim',
      args: { analysis_id: 'a2', claim_number: 3 },
    })
  })

  it('uses the open paper when none is named', () => {
    expect(parseCommand('/get_analysis', PAPERS, 'open1')).toEqual({ name: 'get_analysis', args: { analysis_id: 'open1' } })
  })

  it('sends the rest of the line as the text argument', () => {
    expect(parseCommand('/check_text Dense retrieval needs no index.', PAPERS)).toEqual({
      name: 'check_text',
      args: { text: 'Dense retrieval needs no index.' },
    })
    expect(parseCommand('/find_in_paper @ColBERTv2 late interaction', PAPERS)).toEqual({
      name: 'find_in_paper',
      args: { analysis_id: 'a3', text: 'late interaction' },
    })
  })

  it('says what is missing', () => {
    expect(parseCommand('/nope', PAPERS)).toEqual({ error: 'There is no /nope command. Type / to see them.' })
    expect(parseCommand('/get_analysis', PAPERS)).toMatchObject({ error: expect.stringContaining('Name a paper with @') })
    expect(parseCommand('/get_claim @ColBERTv2', PAPERS)).toMatchObject({ error: expect.stringContaining('claim number') })
    expect(parseCommand('/check_text', PAPERS)).toMatchObject({ error: expect.stringContaining('Add the text') })
  })
})

describe('reading a tool result', () => {
  it('turns check_text into statements with their verdicts, and says what was left out', () => {
    const shown = describeResult('check_text', {
      results: [{ text: 'A.', source: 'x.pdf', page: 2, verdict: 'refutes', quote: 'q', reasoning: 'r' }],
      not_checked: 2,
    })

    expect(shown.statements).toEqual([
      { index: 0, text: 'A.', source: 'x.pdf', page: 2, verdict: 'refutes', quote: 'q', reasoning: 'r' },
    ])
    expect(shown.note).toContain('2 more sentences were not checked')
  })

  it('shows an analysis as a view with its claims, and a tool error as a message', () => {
    const shown = describeResult('get_analysis', {
      title: 'T',
      status: 'done',
      standing: { backed: 1 },
      claims: [{ number: 1, claim: 'C one', standing: 'backed' }],
    })
    expect(shown.view).toMatchObject({ kind: 'claims', title: 'T', claims: [{ number: 1, claim: 'C one', standing: 'backed' }] })
    expect(describeResult('get_claim', { status: 'error', message: 'no analysis' })).toEqual({
      view: { kind: 'message', text: 'no analysis' },
    })
  })

  it('marks the words of a search, once each, for the claims it found', () => {
    const shown = describeResult('search_claims', { claims: [{ title: 'P', number: 2, claim: 'Late interaction', standing: 'silent' }] }, { query: 'late Interaction late' })

    expect(shown.view).toMatchObject({ kind: 'claims', highlight: ['late', 'interaction'] })
  })
})

describe('the result cards', () => {
  it('lists claims with a standing badge each, and marks the searched words', () => {
    const { view } = describeResult(
      'search_claims',
      {
        claims: [
          { title: 'ColBERTv2', number: 2, claim: 'Late interaction was introduced in ColBERT.', standing: 'backed' },
          { title: 'ColPali', number: 8, claim: 'Engines scale to millions of documents.', standing: 'contradicted' },
        ],
      },
      { query: 'late interaction' },
    )
    render(<CommandResult view={view!} command="/search_claims" />)

    const rows = within(screen.getByRole('region', { name: 'Result of /search_claims' })).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Backed')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Contradicted')).toBeInTheDocument()
    expect(within(rows[0]).getByText('ColBERTv2')).toBeInTheDocument()
    expect(rows[0].querySelectorAll('mark')).toHaveLength(2) // "Late" and "interaction"
    expect(rows[1].querySelectorAll('mark')).toHaveLength(0)
  })

  it('shows an analysis with a count per standing', () => {
    const { view } = describeResult('get_analysis', {
      title: 'Qwen2-VL',
      status: 'done',
      standing: { backed: 1, silent: 16, contradicted: 0, unchecked: 1 },
      claims: [{ number: 1, claim: 'It reads any resolution.', standing: 'silent' }],
    })
    render(<CommandResult view={view!} command="/get_analysis" />)

    const tally = screen.getByRole('list', { name: 'Claims by standing' })
    expect(within(tally).getByText('Not backed').parentElement).toHaveTextContent('16 Not backed')
    expect(within(tally).queryByText('Contradicted')).not.toBeInTheDocument() // none: nothing to show
  })

  it('shows the evidence behind a claim with the quote and the verdict as a badge', () => {
    const { view } = describeResult('get_claim', {
      number: 3,
      claim: 'ColBERT cuts the index by 10x.',
      sentence: 'As shown, ColBERT cuts the index by 10x [b1].',
      standing: 'backed',
      verdicts: [{ cited: '2004.12832', verdict: 'supports', quote: '6-10x smaller', reasoning: 'The paper says so.' }],
      unchecked: [{ source: 'x', reason: 'not found' }],
    })
    render(<CommandResult view={view!} command="/get_claim" />)

    expect(screen.getByText('“6-10x smaller”')).toBeInTheDocument()
    expect(screen.getAllByText('Backed')).toHaveLength(2) // the claim's, and the cited paper's
    expect(screen.getByText("Can't check")).toBeInTheDocument()
    expect(screen.getByText('not found')).toBeInTheDocument()
  })

  it('shows the gaps as three counts', () => {
    render(<CommandResult view={{ kind: 'gaps', notBacked: 4, contradicted: 2, missing: 7 }} command="/get_gaps" />)

    const tiles = screen.getAllByRole('listitem')
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining('4Not backed'),
      expect.stringContaining('2Contradicted'),
      expect.stringContaining('7Not held'),
    ])
  })
})

describe('a command that fails', () => {
  it('says why in its own turn, with no Ask again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"no such paper: x.pdf"}', { status: 404 })))
    render(<Panel />)

    fireEvent.change(field(), { target: { value: '/find_in_paper @ColBERTv2 late interaction' } })
    await act(async () => fireEvent.submit(field().closest('form')!))

    expect(await screen.findByText(/\/find_in_paper could not run: 404/)).toBeInTheDocument()
    expect(screen.queryByText(/The answer failed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask again' })).not.toBeInTheDocument()
  })
})

function Panel() {
  const assistant = useAssistant()
  const [client] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={client}>
      <AssistantPanel
        role="researcher"
        assistant={assistant}
        context={{ screen: 'library' }}
        about={{ kind: 'library', label: 'your library' }}
        papers={PAPERS}
        onClearAbout={() => {}}
        onClose={() => {}}
        onShowSource={() => {}}
      />
    </QueryClientProvider>
  )
}

const field = () => screen.getByRole('textbox', { name: 'Your question' })

describe('the Ask input', () => {
  it('opens the command list on a slash, moves with the arrows and picks with Enter', () => {
    render(<Panel />)

    fireEvent.change(field(), { target: { value: '/' } })
    const options = within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option')
    expect(options).toHaveLength(10)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(field()).toHaveValue('/find_support ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('goes on to the paper list after a command that takes a paper, and Escape closes a menu', () => {
    render(<Panel />)

    fireEvent.change(field(), { target: { value: '/get_analysis' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(field()).toHaveValue('/get_analysis @')
    expect(within(screen.getByRole('listbox', { name: 'Papers' })).getAllByRole('option')).toHaveLength(3)
    fireEvent.keyDown(field(), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('runs a command through the tool route and shows the answer, and refuses a bad one without a request', async () => {
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/health')) return Response.json({})
        calls.push({ url, body: JSON.parse(String(init?.body)) })
        return Response.json({ page: 4 })
      }),
    )
    render(<Panel />)

    fireEvent.change(field(), { target: { value: '/find_in_paper @ColBERTv2 late interaction' } })
    await act(async () => fireEvent.submit(field().closest('form')!))
    expect(await screen.findByText('Found on page 4.')).toBeInTheDocument()
    expect(calls).toEqual([
      { url: expect.stringContaining('/agent/tools/find_in_paper'), body: { analysis_id: 'a3', text: 'late interaction' } },
    ])

    fireEvent.change(field(), { target: { value: '/get_claim' } })
    await act(async () => fireEvent.submit(field().closest('form')!))
    expect(await screen.findByText(/Name a paper with @/)).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('waits for Start before /submit_analysis starts a paid run, and Cancel sends nothing', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health')) return Response.json({})
        calls.push(url)
        return Response.json({ id: 'new1' })
      }),
    )
    render(<Panel />)

    fireEvent.change(field(), { target: { value: '/submit_analysis 2004.12832' } })
    await act(async () => fireEvent.submit(field().closest('form')!))
    expect(screen.getByRole('alert')).toHaveTextContent('Start checking 2004.12832?')
    expect(calls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls).toEqual([])

    fireEvent.change(field(), { target: { value: '/submit_analysis 2004.12832' } })
    await act(async () => fireEvent.submit(field().closest('form')!))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })))
    expect(calls).toEqual([expect.stringContaining('/agent/tools/submit_analysis')])
  })
})
