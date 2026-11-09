/** The hooks behind the analysis screens: a gateway file as a blob url, one analysis kept
 * current from its stage stream, the list of analyses, and the "finished" notices. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  fetchFile: vi.fn(),
  getAnalysis: vi.fn(),
  listAnalyses: vi.fn(),
  onStages: vi.fn(),
  showDoneNotice: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
vi.mock('../src/lib/desktopNotice', () => ({ showDoneNotice: gateway.showDoneNotice }))
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  fetchFile: gateway.fetchFile,
  api: { getAnalysis: gateway.getAnalysis, listAnalyses: gateway.listAnalyses, onStages: gateway.onStages },
}))

import type { Analysis, Stage } from '../src/lib/api'
import { useAnalyses, useAnalysis, useAnalysisNotices } from '../src/lib/useAnalysis'
import { useAuthorizedUrl } from '../src/lib/useAuthorizedUrl'

function analysis(status: Analysis['status'], stages: Stage[] = [], id = 'a1'): Analysis {
  return { id, paper: `${id}.pdf`, status, claims: [], stages }
}

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

describe('useAuthorizedUrl', () => {
  it('gives a blob url once the file is fetched and releases it on unmount', async () => {
    gateway.fetchFile.mockResolvedValue(new Blob(['x']))
    const { result, unmount } = renderHook(() => useAuthorizedUrl('/api/papers/a.pdf'))
    expect(result.current).toEqual({ failed: false })
    await waitFor(() => expect(result.current.url).toBe('blob:vitest'))
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:vitest')
  })

  it('reports a file that could not be fetched', async () => {
    gateway.fetchFile.mockRejectedValue(new Error('404'))
    const { result } = renderHook(() => useAuthorizedUrl('/api/papers/a.pdf'))
    await waitFor(() => expect(result.current).toEqual({ failed: true }))
  })

  it('fetches nothing without a url', () => {
    const { result } = renderHook(() => useAuthorizedUrl(undefined))
    expect(result.current).toEqual({ failed: false })
    expect(gateway.fetchFile).not.toHaveBeenCalled()
  })

  it('does not show the answer for an earlier url', async () => {
    gateway.fetchFile.mockResolvedValueOnce(new Blob(['x'])).mockReturnValueOnce(new Promise(() => {}))
    const { result, rerender } = renderHook(({ url }) => useAuthorizedUrl(url), { initialProps: { url: '/a' } })
    await waitFor(() => expect(result.current.url).toBe('blob:vitest'))
    rerender({ url: '/b' })
    expect(result.current).toEqual({ failed: false })
  })

  it('ignores a fetch that finishes after the component is gone', async () => {
    let finish: (blob: Blob) => void = () => {}
    let fail: (error: Error) => void = () => {}
    gateway.fetchFile
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    const first = renderHook(() => useAuthorizedUrl('/a'))
    const second = renderHook(() => useAuthorizedUrl('/b'))
    first.unmount()
    second.unmount()
    await act(async () => {
      finish(new Blob(['x']))
      fail(new Error('late'))
    })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('useAnalysis', () => {
  /** Mounts the hook on a running analysis and returns the stream's callbacks. */
  async function follow(initial: Analysis = analysis('running', [{ stage: 'queued' }, { stage: 'extracting' }])) {
    const close = vi.fn()
    gateway.getAnalysis.mockResolvedValue(initial)
    gateway.onStages.mockReturnValue(close)
    const view = renderHook(() => useAnalysis('a1'), { wrapper })
    await waitFor(() => expect(gateway.onStages).toHaveBeenCalled())
    const [, onStage, onOpen] = gateway.onStages.mock.calls[0] as [string, (stage: Stage) => void, () => void]
    const stages = () => client.getQueryData<Analysis>(['analysis', 'a1'])!.stages.map((s) => s.stage)
    return { close, onStage, onOpen, stages, ...view }
  }

  it('does nothing without an id', () => {
    renderHook(() => useAnalysis(null), { wrapper })
    expect(gateway.getAnalysis).not.toHaveBeenCalled()
  })

  it('does not follow a finished analysis', async () => {
    gateway.getAnalysis.mockResolvedValue(analysis('done'))
    const { result } = renderHook(() => useAnalysis('a1'), { wrapper })
    await waitFor(() => expect(result.current.data?.status).toBe('done'))
    expect(gateway.onStages).not.toHaveBeenCalled()
  })

  it('skips the stages the fetch already holds and appends the new ones', async () => {
    const { onStage, stages } = await follow()
    act(() => onStage({ stage: 'queued' }))
    act(() => onStage({ stage: 'extracting' }))
    expect(stages()).toEqual(['queued', 'extracting'])
    act(() => onStage({ stage: 'planned', checks: 1 }))
    expect(stages()).toEqual(['queued', 'extracting', 'planned'])
  })

  it('counts the replay again after a reconnect', async () => {
    const { onStage, onOpen, stages } = await follow()
    act(() => onStage({ stage: 'planned' }))
    act(() => onOpen())
    act(() => onStage({ stage: 'queued' }))
    act(() => onStage({ stage: 'extracting' }))
    act(() => onStage({ stage: 'planned' }))
    expect(stages()).toEqual(['queued', 'extracting', 'planned'])
  })

  it('counts no replay when the cache holds no analysis yet', async () => {
    const { onStage, onOpen, stages } = await follow()
    client.removeQueries({ queryKey: ['analysis', 'a1'] })
    act(() => onOpen())
    act(() => onStage({ stage: 'planned' }))
    expect(client.getQueryData(['analysis', 'a1'])).toBeUndefined()
    expect(stages).toBeTypeOf('function')
  })

  it('refetches once for a burst of stages that change the analysis', async () => {
    const { onStage } = await follow(analysis('running'))
    vi.useFakeTimers()
    act(() => {
      onStage({ stage: 'extracted' })
      onStage({ stage: 'verified' })
      onStage({ stage: 'failed' })
      onStage({ stage: 'figures' })
    })
    expect(gateway.getAnalysis).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(gateway.getAnalysis).toHaveBeenCalledTimes(2)
  })

  it('does not refetch for a stage that changes nothing, or for a replayed one', async () => {
    const { onStage } = await follow()
    vi.useFakeTimers()
    act(() => {
      onStage({ stage: 'extracted' }) // replayed
      onStage({ stage: 'extracting' }) // replayed
      onStage({ stage: 'verifying' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(gateway.getAnalysis).toHaveBeenCalledTimes(1)
  })

  it('refreshes the analysis and the list and closes the stream when the run ends', async () => {
    const { onStage, close } = await follow(analysis('running'))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => onStage({ stage: 'extracted' }))
    act(() => onStage({ stage: 'done' }))
    act(() => onStage({ stage: 'error' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analyses'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analysis', 'a1'] })
    expect(close).toHaveBeenCalledTimes(1) // the second ending stage does not close it again
  })

  it('closes the stream on unmount', async () => {
    const { close, unmount } = await follow()
    unmount()
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('useAnalyses', () => {
  it('lists analyses and polls only while one is running', async () => {
    gateway.listAnalyses.mockResolvedValue([analysis('running')])
    const { result } = renderHook(() => useAnalyses(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    const options = client.getQueryCache().find({ queryKey: ['analyses'] })!.observers[0].options
    const poll = options.refetchInterval as (query: { state: { data?: Analysis[] } }) => number | false
    expect(poll({ state: { data: [analysis('running')] } })).toBe(3000)
    expect(poll({ state: { data: [analysis('done')] } })).toBe(false)
    expect(poll({ state: {} })).toBe(false)
  })
})

describe('useAnalysisNotices', () => {
  it('announces a run seen running that is now done or stopped, once, and opens it on click', () => {
    const onOpen = vi.fn()
    const { rerender } = renderHook(({ list }) => useAnalysisNotices(list, onOpen), {
      initialProps: { list: undefined as Analysis[] | undefined },
    })
    rerender({ list: [analysis('running', [], 'a'), analysis('running', [], 'b'), analysis('done', [], 'c')] })
    expect(gateway.showDoneNotice).not.toHaveBeenCalled()
    rerender({ list: [analysis('done', [], 'a'), analysis('error', [], 'b'), analysis('done', [], 'c')] })
    expect(gateway.showDoneNotice).toHaveBeenCalledTimes(2)
    expect(gateway.showDoneNotice).toHaveBeenCalledWith('Analysis finished', 'a.pdf', 'a', expect.any(Function))
    expect(gateway.showDoneNotice).toHaveBeenCalledWith('Analysis stopped', 'b.pdf', 'b', expect.any(Function))
    gateway.showDoneNotice.mock.calls[0][3]()
    expect(onOpen).toHaveBeenCalledWith('a')
    rerender({ list: [analysis('done', [], 'a')] })
    expect(gateway.showDoneNotice).toHaveBeenCalledTimes(2)
  })

  it('keeps announcing a run that is still running as not finished', () => {
    const { rerender } = renderHook(({ list }) => useAnalysisNotices(list, vi.fn()), {
      initialProps: { list: [analysis('running')] as Analysis[] | undefined },
    })
    rerender({ list: [analysis('running')] })
    expect(gateway.showDoneNotice).not.toHaveBeenCalled()
  })
})
