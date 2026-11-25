/** A feature /health says is off turns its controls off and says why, and they come back when
 * /health says it works again (lib/features, #763). */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantPanel } from '../src/components/AssistantPanel'
import { FailedRun } from '../src/components/FailedRun'
import { SubmitForm } from '../src/components/SubmitForm'
import type { Analysis } from '../src/lib/api'
import { useAssistant } from '../src/lib/assistant'
import { OFFLINE_REASON } from '../src/lib/features'
import { HomeAnalyzeCard } from '../src/roles/researcher/components/HomeAnalyzeCard'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => vi.unstubAllGlobals())

/** /health answers with `features`; every other route with an empty list. */
function gateway(features: { analyses: boolean; ask: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.endsWith('/health') ? Response.json({ ok: true, features }) : Response.json([]))),
  )
}

function withClient(client: QueryClient, ui: ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function Panel() {
  return (
    <AssistantPanel
      role="researcher"
      assistant={useAssistant()}
      context={{ screen: 'library' }}
      about={{ kind: 'library', label: 'your library' }}
      onClearAbout={() => {}}
      onClose={() => {}}
      onShowSource={() => {}}
    />
  )
}

describe('a feature that is offline', () => {
  it('turns off Analyze and the PDF upload, says why, and turns them back on when the worker is back', async () => {
    gateway({ analyses: false, ask: true })
    const client = new QueryClient()
    withClient(client, <SubmitForm onStarted={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Paper to analyze' }), { target: { value: '10.1000/x' } })

    expect(await screen.findByText(OFFLINE_REASON.analyses)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /drop a PDF/ })).toBeDisabled()

    gateway({ analyses: true, ask: true })
    await act(() => client.refetchQueries({ queryKey: ['health'] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled())
    expect(screen.queryByText(OFFLINE_REASON.analyses)).not.toBeInTheDocument()
  })

  it('keeps Ask from sending a question but still runs a /command', async () => {
    gateway({ analyses: true, ask: false })
    withClient(new QueryClient(), <Panel />)
    const field = screen.getByRole('textbox', { name: 'Your question' })

    fireEvent.change(field, { target: { value: 'What is late interaction?' } })
    expect(await screen.findByText(OFFLINE_REASON.ask)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    fireEvent.change(field, { target: { value: '/get_gaps' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})

describe('the Home card and a failed run share one answer from /health', () => {
  const failed = { id: 'a1', paper: '10.1/x', status: 'error', claims: [], stages: [], message: 'litellm.RateLimitError: 429' } as Analysis

  it('both turn off while the checking server is offline and both come back with it', async () => {
    gateway({ analyses: false, ask: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    withClient(
      client,
      <>
        <HomeAnalyzeCard reference="" onReferenceChange={() => {}} inputRef={createRef()} onStarted={() => {}} />
        <FailedRun analysis={failed} onOpen={() => {}} />
      </>,
    )
    const home = within(screen.getByRole('region', { name: 'Analyze a paper' }))
    expect(await home.findByText(OFFLINE_REASON.analyses)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeDisabled()

    gateway({ analyses: true, ask: true })
    await act(() => client.refetchQueries({ queryKey: ['health'] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run it again' })).toBeEnabled())
    expect(home.queryByText(OFFLINE_REASON.analyses)).not.toBeInTheDocument()
  })
})
