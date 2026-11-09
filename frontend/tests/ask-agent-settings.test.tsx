/** Settings, Agents: the access card when it cannot load or a group is opened, and the setup copy. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  url: 'https://gatehouse.example',
  preferences: {} as Record<string, unknown>,
  patches: [] as Record<string, unknown>[],
  failLoad: false,
}))

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  request: vi.fn(async (_path: string, init?: RequestInit) => {
    if (gateway.failLoad) throw new Error('503: down')
    if (init?.method === 'PATCH') {
      const { patch } = JSON.parse(String(init.body)) as { patch: Record<string, unknown> }
      gateway.patches.push(patch)
      gateway.preferences = { ...gateway.preferences, ...patch }
    }
    return gateway.preferences
  }),
}))
vi.mock('../src/lib/agentAccess', async (original) => ({
  ...(await original<typeof import('../src/lib/agentAccess')>()),
  get GATEHOUSE_URL() {
    return gateway.url
  },
}))
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

import { AgentAccessCard } from '../src/components/AgentAccessCard'
import { AgentsSection } from '../src/components/AgentsSection'

function renderCard(ui = <AgentAccessCard />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  gateway.url = 'https://gatehouse.example'
  gateway.preferences = {}
  gateway.patches = []
  gateway.failLoad = false
})

describe('the access card', () => {
  it('says so when the saved setting cannot be loaded', async () => {
    gateway.failLoad = true
    renderCard()

    expect(await screen.findByText(/Your access setting could not be loaded/)).toBeInTheDocument()
  })

  it('takes a ticked tool off the Custom list when it is ticked again', async () => {
    gateway.preferences = { agentAccess: { level: 'custom', tools: ['bibtex', 'list_papers'] } }
    renderCard()

    fireEvent.click(await screen.findByRole('checkbox', { name: /Make BibTeX entries/ }))

    await waitFor(() => expect(gateway.patches).toEqual([{ agentAccess: { level: 'custom', tools: ['list_papers'] } }]))
  })

  it('opens and closes a group of tools', async () => {
    renderCard()
    const screenGroup = await screen.findByRole('button', { name: /Your open tab/ })

    expect(screenGroup).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Papers and claims/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screenGroup)
    expect(screenGroup).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Point with its cursor')).toBeInTheDocument()
    fireEvent.click(screenGroup)
    expect(screen.queryByText('Point with its cursor')).not.toBeInTheDocument()
  })

  it('marks the tools Read only leaves off', async () => {
    gateway.preferences = { agentAccess: { level: 'read' } }
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: /Your open tab/ }))

    const off = screen.getByText('Open screens').closest('li')!
    expect(within(off).getByText('Off')).toBeInTheDocument()
    expect(within(screen.getByText('See what is on the screen').closest('li')!).getByText('Read')).toBeInTheDocument()
  })
})

describe('Settings, Agents, step 1', () => {
  it('says there is no agent gateway when the app was built without one', () => {
    gateway.url = ''
    renderCard(<AgentsSection role="researcher" />)

    expect(screen.getByText(/This server has no agent gateway yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })

  it('copies the setup for the chosen agent, and offers Copy again for the next one', async () => {
    renderCard(<AgentsSection role="researcher" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('claude mcp add --transport http'))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })
})
