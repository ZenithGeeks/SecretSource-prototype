/**
 * The Researcher's Graph component as the Author renders it: with an `emptyMessage`, an
 * account with nothing analysed sees a message rather than a bare canvas; without one (the
 * Researcher) the canvas header shows as before. Against the fake gateway, whose
 * /researcher/graph is empty.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { Graph } from '../src/roles/researcher/screens/Graph'
import { installFakeGateway } from './fakeAuthorGateway'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
// The canvas itself needs a real browser; the test is about what shows before it mounts.
vi.mock('react-cytoscapejs', () => ({ default: () => <div data-testid="cytoscape-canvas" /> }))

function renderGraph(emptyMessage?: { title: string; hint: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Graph onOpenAnalysis={() => undefined} emptyMessage={emptyMessage} />
    </QueryClientProvider>,
  )
}

// The palette follows the OS theme through matchMedia, and the canvas watches its size with a
// ResizeObserver; jsdom has neither.
beforeAll(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  installFakeGateway({})
})

afterEach(() => vi.unstubAllGlobals())

describe('Graph for a role with nothing analysed', () => {
  test('with an emptyMessage (the Author) the empty graph shows the message instead of the canvas', async () => {
    renderGraph({ title: 'Nothing to graph yet', hint: 'Analyse a paper on History first.' })
    expect(await screen.findByText('Nothing to graph yet')).toBeInTheDocument()
    expect(screen.getByText('Analyse a paper on History first.')).toBeInTheDocument()
    expect(screen.queryByTestId('cytoscape-canvas')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What rests on what' })).toBeNull()
  })

  test('without one (the Researcher) the canvas and its header show as before', async () => {
    renderGraph()
    expect(await screen.findByRole('heading', { name: 'What rests on what' })).toBeInTheDocument()
    expect(screen.getByTestId('cytoscape-canvas')).toBeInTheDocument()
  })
})
