import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null }))
vi.mock('../src/lib/useAuth', () => ({ useAuth: () => ({ session: null, loading: false }) }))

import { Root } from '../src/Root'
import { TEACHER_GOOGLE_RETURN_KEY } from '../src/lib/teacherGoogleReturn'
import { teacherApi } from '../src/lib/teacher'

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

function renderRoot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><Root /></QueryClientProvider>)
}

describe('Google Classroom OAuth return', () => {
  test('restores course selection when OAuth returns to the local app root', async () => {
    sessionStorage.setItem(TEACHER_GOOGLE_RETURN_KEY, String(Date.now()))
    vi.spyOn(teacherApi, 'getImportableClasses').mockResolvedValue([])

    renderRoot()

    expect(await screen.findByRole('heading', { name: 'Choose a class' })).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('role')).toBe('teacher')
    expect(new URLSearchParams(window.location.search).get('screen')).toBe('add-class-course')
    expect(sessionStorage.getItem(TEACHER_GOOGLE_RETURN_KEY)).toBeNull()
  })
})
