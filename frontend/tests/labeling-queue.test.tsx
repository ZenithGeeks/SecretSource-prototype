import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  puts: [] as { path: string; body: unknown }[],
  pool: {
    topics: ['NLP', 'HPC', 'Software Engineering'],
    me: 'Chanya',
    people: [
      { name: 'Chanya', topic: 'NLP' },
      { name: 'Nuttadon', topic: '' },
    ],
    papers: [
      { analysis_id: 'x1', title: 'HPC paper', topic: 'HPC', claims: 3 },
      { analysis_id: 'x2', title: 'NLP paper', topic: 'NLP', claims: 5 },
    ],
  },
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      gateway.puts.push({ path, body: JSON.parse(String(init.body)) })
      return {}
    }
    if (path === '/labeling/status') return { annotator: 'Chanya', configured: true, sheet_url: '', share_with: '' }
    if (path === '/labeling/pool') return gateway.pool
    throw new Error(`unexpected ${path}`)
  }),
  fetchFile: vi.fn(),
  api: {
    listAnalyses: async () => [
      { id: 'mine', status: 'done', title: 'My paper', file: 'mine.pdf', paper: 'mine.pdf', claims: [{}, {}] },
    ],
  },
}))

import { Queue } from '../src/roles/labeler/screens/Queue'

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Queue onOpen={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('topics in the queue', () => {
  beforeEach(() => {
    gateway.puts.length = 0
  })

  it('lists shared papers with the viewer\'s own topic first', async () => {
    renderQueue()
    const shared = await screen.findByRole('region', { name: 'Shared by the team' })
    const titles = within(shared).getAllByText(/paper$/).map((el) => el.textContent)
    expect(titles).toEqual(['NLP paper', 'HPC paper'])
    expect(within(shared).getByText(/your topic/)).toBeInTheDocument()
  })

  it('sets a teammate\'s topic from the dropdown', async () => {
    renderQueue()
    fireEvent.change(await screen.findByLabelText('Topic for Nuttadon'), { target: { value: 'HPC' } })
    await waitFor(() =>
      expect(gateway.puts).toEqual([{ path: '/labeling/people', body: { name: 'Nuttadon', topic: 'HPC' } }]),
    )
  })

  it('shares one of your own papers under a topic', async () => {
    renderQueue()
    fireEvent.change(await screen.findByLabelText(/Share My paper with the team/), { target: { value: 'Software Engineering' } })
    await waitFor(() =>
      expect(gateway.puts).toEqual([
        { path: '/labeling/papers/mine/topic', body: { topic: 'Software Engineering' } },
      ]),
    )
  })
})
