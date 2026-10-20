/** The labeler's bell (#598): a count of your papers that finished or failed since you last
 * looked, and a panel that lists yours by state, opens a ready one and retries a failed one. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Pool } from '../src/lib/labeling'
import { PaperBell } from '../src/roles/labeler/components/PaperBell'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.removeItem('labeler.seenPapers')
})

type Paper = Pool['papers'][number]

const paper = (id: string, extra: Partial<Paper> = {}): Paper => ({
  analysis_id: id,
  title: `Paper ${id}`,
  topic: 'CV',
  claims: 4,
  judged: 0,
  team_judged: 0,
  labelers: [],
  status: 'done',
  reason: '',
  mine: true,
  added_by: 'Chanya',
  subject: '',
  keywords: [],
  ...extra,
})

const pool = (papers: Paper[]): Pool => ({ topics: ['CV'], me: 'Chanya', people: [], papers })

/** Answers pool requests with `answers` in turn (the last one repeats) and records the rest. */
function gateway(answers: Pool[]) {
  const posted: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(String(url))
        return Response.json({ id: 'new' })
      }
      return Response.json(answers.length > 1 ? answers.shift() : answers[0])
    }),
  )
  return posted
}

function renderBell(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PaperBell onOpen={onOpen} />
      <p>outside</p>
    </QueryClientProvider>,
  )
  return { client, onOpen }
}

it('counts nothing on a first visit, and lists your ready papers to open', async () => {
  gateway([pool([paper('a1'), paper('t1', { mine: false, title: 'A teammate paper' })])])
  const { onOpen } = renderBell()
  const bell = await screen.findByRole('button', { name: 'Your papers' })

  fireEvent.click(bell)
  const panel = screen.getByRole('dialog', { name: 'Your papers' })
  const ready = within(panel).getByRole('region', { name: 'Ready to label' })
  expect(within(ready).getByText('Paper a1')).toBeInTheDocument()
  expect(within(panel).queryByText('A teammate paper')).not.toBeInTheDocument()

  fireEvent.click(within(ready).getByRole('button', { name: 'Open' }))
  expect(onOpen).toHaveBeenCalledWith('a1')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('counts a paper that finished since you last looked, until you open the panel', async () => {
  window.localStorage.setItem('labeler.seenPapers', JSON.stringify({ a1: 'running' }))
  gateway([pool([paper('a1', { status: 'running', claims: 0 })]), pool([paper('a1')])])
  const { client } = renderBell()
  expect(await screen.findByRole('button', { name: 'Your papers, 1 being read' })).toBeInTheDocument()

  await act(() => client.refetchQueries({ queryKey: ['labeling', 'pool'] }))
  const bell = await screen.findByRole('button', { name: 'Your papers, 1 new' })
  fireEvent.click(bell)
  expect(within(screen.getByRole('dialog')).getByText('New')).toBeInTheDocument()
  expect(bell).toHaveAccessibleName('Your papers')
  expect(JSON.parse(window.localStorage.getItem('labeler.seenPapers')!)).toEqual({ a1: 'done' })
})

it('shows why a paper failed and tries it again', async () => {
  const posted = gateway([pool([paper('f1', { status: 'error', claims: 0, reason: 'The PDF could not be downloaded.' })])])
  renderBell()
  fireEvent.click(await screen.findByRole('button', { name: /^Your papers/ }))
  const failed = within(screen.getByRole('dialog')).getByRole('region', { name: 'Could not be read' })
  expect(within(failed).getByText('The PDF could not be downloaded.')).toBeInTheDocument()

  fireEvent.click(within(failed).getByRole('button', { name: 'Try again Paper f1' }))
  await waitFor(() => expect(posted).toEqual([expect.stringContaining('/labeling/papers/f1/retry')]))
})

it('closes with the bell, the close button, Escape, or a click outside', async () => {
  gateway([pool([paper('a1')])])
  renderBell()
  const bell = await screen.findByRole('button', { name: 'Your papers' })

  fireEvent.click(bell)
  fireEvent.click(bell)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(bell)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(bell)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.activeElement).toBe(bell)

  fireEvent.click(bell)
  fireEvent.pointerDown(screen.getByText('outside'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps one count for the sidebar bell and the phone bell', async () => {
  window.localStorage.setItem('labeler.seenPapers', JSON.stringify({ a1: 'running' }))
  gateway([pool([paper('a1')])])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PaperBell onOpen={vi.fn()} />
      <PaperBell onOpen={vi.fn()} />
    </QueryClientProvider>,
  )
  const [first, second] = await screen.findAllByRole('button', { name: 'Your papers, 1 new' })
  fireEvent.click(first)
  expect(second).toHaveAccessibleName('Your papers')
})

it('closes when the window is resized, and leaves Escape alone when focus is elsewhere', async () => {
  gateway([pool([paper('a1')])])
  renderBell()
  const bell = await screen.findByRole('button', { name: 'Your papers' })

  fireEvent.click(bell)
  fireEvent(window, new Event('resize'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  fireEvent.click(bell)
  const elsewhere = Object.assign(document.createElement('input'), { 'aria-label': 'elsewhere' })
  document.body.append(elsewhere)
  elsewhere.focus()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  elsewhere.remove()
})

it('says so when you have added no papers', async () => {
  gateway([pool([paper('t1', { mine: false })])])
  renderBell()
  fireEvent.click(await screen.findByRole('button', { name: 'Your papers' }))
  expect(screen.getByText(/No papers of yours yet/)).toBeInTheDocument()
})
