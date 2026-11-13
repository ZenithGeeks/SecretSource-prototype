/**
 * A create button makes one item however often it is clicked while its request is in flight
 * (SCRUM-477): "+ New draft" on Home, "Write a draft" with no drafts yet, New draft on a project
 * and "Create project" in the New project dialog. The request is held back so the button can be
 * clicked again while it is pending.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Home } from '../src/roles/author/screens/Home'
import { Library } from '../src/roles/author/screens/Library'
import { ProjectDetail } from '../src/roles/author/screens/ProjectDetail'
import { Toaster } from '../src/components/Toaster'
import { installFakeGateway, type FakeGateway } from './fakeAuthorGateway'
import { THESIS_FILES } from './fixtures/thesis'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {}, version: '0' } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

let gateway: FakeGateway

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Toaster />{ui}</QueryClientProvider>)
}

/** Holds every `POST <path>` until `release` is called; the rest of the gateway answers as usual. */
function holdPosts(path: string): { release: () => void } {
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const answer = gateway.fetch.getMockImplementation()!
  gateway.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    // The app's request path, as the fake gateway reads it: the /api prefix dropped.
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.pathname.replace(/^\/api/, '') === path) await held
    return answer(input, init)
  })
  return { release }
}

const posts = (path: string) => gateway.calls.filter((c) => c === `POST ${path}`)

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('a double click creates one item', () => {
  test('"+ New draft" on Home', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES })
    const onOpenEditor = vi.fn()
    renderWithQuery(<Home draftId="d1" onSelectDraft={vi.fn()} onOpenEditor={onOpenEditor} onOpenHistory={vi.fn()} />)
    const button = await screen.findByRole('button', { name: '+ New draft' })
    const { release } = holdPosts('/author/drafts')

    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    release()

    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledTimes(1))
    expect(posts('/author/drafts')).toHaveLength(1)
    await waitFor(() => expect(button).toBeEnabled())
  })

  test('"Write a draft" with no drafts yet', async () => {
    gateway = installFakeGateway({})
    const onOpenEditor = vi.fn()
    renderWithQuery(<Home draftId={null} onSelectDraft={vi.fn()} onOpenEditor={onOpenEditor} onOpenHistory={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Write a draft' })
    const { release } = holdPosts('/author/drafts')

    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    release()

    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledTimes(1))
    expect(posts('/author/drafts')).toHaveLength(1)
  })

  test('New draft on a project', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES })
    const onOpenEditor = vi.fn()
    renderWithQuery(<ProjectDetail projectId="proj1" onBack={vi.fn()} onOpenEditor={onOpenEditor} />)
    const button = await screen.findByRole('button', { name: 'New draft' })
    const { release } = holdPosts('/author/drafts')

    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    release()

    await waitFor(() => expect(onOpenEditor).toHaveBeenCalledTimes(1))
    expect(posts('/author/drafts')).toHaveLength(1)
    await waitFor(() => expect(button).toBeEnabled())
  })

  test('"Create project" in the New project dialog, clicked or submitted twice', async () => {
    gateway = installFakeGateway({ files: THESIS_FILES })
    const onOpenProject = vi.fn()
    renderWithQuery(<Library projectId={null} onOpenProject={onOpenProject} onOpenEditor={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /\+ New project/ }))
    const dialog = within(screen.getByRole('dialog'))
    const form = dialog.getByRole('button', { name: 'Create project' }).closest('form')!
    const { release } = holdPosts('/author/projects')

    // Two submits in one go, before React re-renders the button as disabled.
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Creating…' })).toBeDisabled())
    release()

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledTimes(1))
    expect(posts('/author/projects')).toHaveLength(1)
  })
})
