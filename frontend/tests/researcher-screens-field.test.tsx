/** "What does your library say?": asking a question, the answer's count tiles and verdict table,
 * and the researcher API client behind it. The gateway is a fetch stub. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { count } from '../src/roles/researcher/components/LibraryCount'
import { researcherApi } from '../src/lib/researcher'
import { useKnowledgeGraph } from '../src/lib/useResearcher'
import { FieldConsensus } from '../src/roles/researcher/screens/FieldConsensus'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

const row = (paper: string, verdict: 'supports' | 'refutes' | 'insufficient', over: Record<string, unknown> = {}) => ({
  paper, cite: 'Someone · 2022', verdict, quote: `${paper} says so`, claim: 'A claim', analysis: `an-${paper}`, claimIndex: 1,
  ...over,
})

const answer = (over: Record<string, unknown> = {}) => ({
  question: 'q', supports: 1, refutes: 1, silent: 2, span: '2019–2023', note: 'A note.', unlisted: 0,
  rows: [row('PLAID', 'supports'), row('DPR', 'refutes'), row('BEIR', 'insufficient'), row('MS MARCO', 'insufficient', { quote: '' })],
  ...over,
})

function gateway(response: unknown, status = 200) {
  const asked: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      asked.push(init?.body ? JSON.parse(String(init.body)) : undefined)
      return new Response(JSON.stringify(response), { status })
    }),
  )
  return asked
}

function renderField(onOpenAnalysis = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FieldConsensus onOpenAnalysis={onOpenAnalysis} />
    </QueryClientProvider>,
  )
  return onOpenAnalysis
}

describe('asking the field', () => {
  it('shows a loading line, then the answer for the typed question only after Ask', async () => {
    const asked = gateway(answer())
    renderField()
    expect(screen.getByText('Checking your library…')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'does it scale?' } })
    expect(asked.every((body) => (body as { question: string }).question === '')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(asked).toContainEqual({ question: 'does it scale?' }))
    expect(await screen.findAllByTestId('consensus-count')).toHaveLength(3)
  })

  it('says the question could not be checked when the gateway fails', async () => {
    gateway({ detail: 'x' }, 500)
    renderField()
    expect(await screen.findByText('That question could not be checked')).toBeInTheDocument()
  })

  it('shows only the note when no row matched, and a plain line when there is no note either', async () => {
    gateway(answer({ rows: [], note: 'No claim matches that.' }))
    const first = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FieldConsensus onOpenAnalysis={() => {}} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('No claim matches that.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('consensus-row')).toHaveLength(0)
    first.unmount()

    gateway(answer({ rows: [], note: '' }))
    renderField()
    await waitFor(() => expect(screen.queryByText('Checking your library…')).not.toBeInTheDocument())
    expect(screen.queryByText('No claim matches that.')).not.toBeInTheDocument()
    expect(screen.getByText('No claim in your papers matches that question.')).toBeInTheDocument()
  })

  it('offers Retry, which asks again', async () => {
    gateway({ detail: 'x' }, 500)
    renderField()
    expect(await screen.findByText('That question could not be checked')).toBeInTheDocument()
    gateway(answer())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('consensus-count')).toHaveLength(3)
  })
})

describe('the answer', () => {
  it('shows the counts with their words, and the span tile only when there is one', async () => {
    gateway(answer({ supports: 1, refutes: 3 }))
    renderField()
    const tiles = await screen.findAllByTestId('consensus-count')
    expect(tiles.map((t) => t.textContent)).toEqual(['1', '3', '2'])
    expect(screen.getByText('2019–2023')).toBeInTheDocument()
    expect(screen.getByText('silent or not checked')).toBeInTheDocument()
  })

  it('leaves out the span tile when the answer has none', async () => {
    gateway(answer({ span: '' }))
    renderField()
    await screen.findAllByTestId('consensus-count')
    expect(screen.queryByText('evidence spans')).not.toBeInTheDocument()
  })

  it('lists the deciding rows first and folds the silent ones behind Show them', async () => {
    gateway(answer({ unlisted: 4 }))
    const onOpenAnalysis = renderField()
    expect(await screen.findAllByTestId('consensus-row')).toHaveLength(2)
    expect(screen.getByText('2 papers are silent or not checked')).toBeInTheDocument()
    expect(screen.getByText('4 more verdicts match. Ask a narrower question to see them.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(screen.getAllByTestId('consensus-row')).toHaveLength(4)
    expect(screen.getByText('“BEIR says so”')).toBeInTheDocument()
    // A row with no quote shows the claim without a quotation.
    expect(screen.queryByText('“”')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide them' }))
    expect(screen.getAllByTestId('consensus-row')).toHaveLength(2)

    fireEvent.click(within(screen.getAllByTestId('consensus-row')[0]).getByRole('button', { name: /^Open the analysis of /  }))
    expect(onOpenAnalysis).toHaveBeenCalledWith('an-PLAID')
  })

  it('counts a single silent paper in the singular', async () => {
    gateway(answer({ rows: [row('PLAID', 'supports'), row('BEIR', 'insufficient')] }))
    renderField()
    expect(await screen.findByText('1 paper is silent or not checked')).toBeInTheDocument()
  })

  it('shows the silent rows at once when nothing backs or contradicts', async () => {
    gateway(answer({ rows: [row('BEIR', 'insufficient')] }))
    renderField()
    expect(await screen.findAllByTestId('consensus-row')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Show them' })).not.toBeInTheDocument()
  })

  it('words the backing papers in the singular or plural', async () => {
    gateway(answer({ supports: 1 }))
    const first = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FieldConsensus onOpenAnalysis={() => {}} />
      </QueryClientProvider>,
    )
    await screen.findAllByTestId('consensus-count')
    expect(screen.getByText(/^paper /)).toBeInTheDocument()
    first.unmount()

    gateway(answer({ supports: 2 }))
    renderField()
    await screen.findAllByTestId('consensus-count')
    expect(screen.getByText(/^papers /)).toBeInTheDocument()
  })
})

describe('researcherApi', () => {
  function record() {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return Response.json({})
      }),
    )
    return calls
  }

  it('encodes the project id in every project route', async () => {
    const calls = record()
    await researcherApi.getLibrary('a/b')
    await researcherApi.addToProject('a/b', 'x')
    await researcherApi.renameProject('a/b', 'N')
    await researcherApi.deleteProject('a/b')
    expect(calls.map((c) => [c.init?.method ?? 'GET', c.url])).toEqual([
      ['GET', '/api/researcher/projects/a%2Fb/library'],
      ['POST', '/api/researcher/projects/a%2Fb/papers'],
      ['PATCH', '/api/researcher/projects/a%2Fb'],
      ['DELETE', '/api/researcher/projects/a%2Fb'],
    ])
    expect(JSON.parse(String(calls[1].init!.body))).toEqual({ analysis_id: 'x' })
  })

  it('reads the graph and the home summary', async () => {
    const calls = record()
    await researcherApi.getGraph()
    await researcherApi.getHome()
    expect(calls.map((c) => c.url)).toEqual(['/api/researcher/graph', '/api/researcher/home'])
  })
})

describe('count', () => {
  it('pluralises', () => {
    expect([count(0, 'paper'), count(1, 'paper'), count(2, 'claim')]).toEqual(['0 papers', '1 paper', '2 claims'])
  })
})

describe('useKnowledgeGraph', () => {
  it('loads the graph from the gateway', async () => {
    const graph = { clusters: [], nodes: [], edges: [], paperEdges: [] }
    gateway(graph)
    const { result } = renderHook(() => useKnowledgeGraph(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          {children}
        </QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.data).toEqual(graph))
  })
})
