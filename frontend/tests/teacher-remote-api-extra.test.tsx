import { describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', () => ({ request }))
vi.mock('../src/lib/teacherStore', () => ({ store: {} }))

import { createRemoteTeacherApi } from '../src/lib/teacher'

describe('remote Teacher API additional endpoints', () => {
  it('calls getHome correctly', async () => {
    request.mockResolvedValue({ reviewQueueCount: 0, submissions: [], dueSoon: [] })
    const api = createRemoteTeacherApi()
    await api.getHome()
    expect(request).toHaveBeenCalledWith('/teacher/home')
  })

  it('calls getClasses and getImportableClasses', async () => {
    request.mockResolvedValue([])
    const api = createRemoteTeacherApi()
    await api.getClasses()
    expect(request).toHaveBeenCalledWith('/teacher/classes')

    await api.getImportableClasses()
    expect(request).toHaveBeenCalledWith('/teacher/classes/importable')
  })

  it('calls getClassImportPreview and importClass', async () => {
    request.mockResolvedValueOnce({ course: {}, resources: [] })
    request.mockResolvedValueOnce({ course: { id: 'c-101', name: 'Imported Class' } })

    const api = createRemoteTeacherApi()
    await api.getClassImportPreview('c-101')
    expect(request).toHaveBeenCalledWith('/teacher/classes/importable/c-101/preview')

    const imported = await api.importClass('c-101')
    expect(request).toHaveBeenCalledWith('/teacher/classes/c-101/import', { method: 'POST' })
    expect(imported).toEqual({ id: 'c-101', name: 'Imported Class' })
  })

  it('calls getWorkspace and getAssignmentDetail', async () => {
    request.mockResolvedValueOnce({ course: { id: 'c-1' }, assignments: [] })
    request.mockResolvedValueOnce({ assignment: { id: 'a-1' }, submissions: [] })

    const api = createRemoteTeacherApi()
    await api.getWorkspace('c-1')
    expect(request).toHaveBeenCalledWith('/teacher/classes/c-1/workspace')

    await api.getAssignmentDetail('c-1', 'a-1')
    expect(request).toHaveBeenCalledWith('/teacher/classes/c-1/assignments/a-1')
  })

  it('calls startGoogleConnection with email query param and switchAccount flag', async () => {
    request.mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/o/oauth2' })
    const api = createRemoteTeacherApi()

    await api.startGoogleConnection('prof@example.com', true)
    expect(request).toHaveBeenCalledWith('/teacher/google/connect?loginHint=prof%40example.com&switch=true')

    await api.startGoogleConnection()
    expect(request).toHaveBeenCalledWith('/teacher/google/connect?')
  })
})
