/** components/SettingsModal.tsx + settingsTabs.tsx: what stays inert while previewing another
 * role's tabs from the Roles group, and keyboard travel along the settings tab list. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Avatar } from '../src/components/settings'
import { SettingsModal } from '../src/components/SettingsModal'

// Signed-out, no Supabase: request() then sends without a token instead of throwing
// SignedOut, whatever a local .env says (the same env dependency as SCRUM-245).
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
import { getSettings, greeting, resetSettings, updateSettings } from '../src/lib/settings'
import { resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { resetTeacherStore } from '../src/lib/teacherStore'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderModal(currentRole: 'writer' | 'researcher' | 'teacher' | 'labeler') {
  return renderWithQuery(<SettingsModal open onClose={vi.fn()} currentRole={currentRole} onSwitchRole={vi.fn()} />)
}

/** The Roles group in the aside: its own tablist, separate from the Settings one. */
function roleTabs() {
  return within(screen.getByRole('tablist', { name: 'Roles' }))
}

function previewRole(label: 'Author' | 'Researcher' | 'Teacher') {
  fireEvent.click(roleTabs().getByRole('tab', { name: label }))
}

beforeEach(() => {
  resetSettings()
  resetTeacherPreferences()
  resetTeacherStore()
})
afterEach(() => vi.unstubAllGlobals())

/** The PATCH /user/preferences bodies sent so far (the GET on open is skipped). */
function patchBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).patch)
}

describe('role preview never writes another role’s settings', () => {
  test('Class and marking is read-only while an Author previews Teacher', async () => {
    renderModal('writer')
    previewRole('Teacher')
    fireEvent.click(screen.getByRole('tab', { name: 'Class and marking' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Switch to Teacher to change them.')
    expect(screen.getByRole('combobox', { name: 'Default class' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Hide student names' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Show student report' })).toBeDisabled()
    expect(screen.getByDisplayValue('Alex S.')).toBeDisabled() // "Send reports as" input

    // Clicking a disabled switch changes nothing.
    const hideNames = screen.getByRole('switch', { name: 'Hide student names' })
    fireEvent.click(hideNames)
    expect(hideNames).toHaveAttribute('aria-checked', 'false')
  })

  test('Field map is read-only while an Author previews Researcher', async () => {
    renderModal('writer')
    previewRole('Researcher')
    fireEvent.click(screen.getByRole('tab', { name: 'Field map' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Switch to Researcher to change them.')
    expect(screen.getByRole('combobox', { name: 'Group papers by' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Smallest group to draw' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Mark disagreements on the map' })).toBeDisabled()
  })

  test('Field map is read-only while a Teacher previews Researcher', () => {
    renderModal('teacher')
    previewRole('Researcher')
    fireEvent.click(screen.getByRole('tab', { name: 'Field map' }))
    expect(screen.getByRole('status')).toHaveTextContent('Switch to Researcher')
    expect(screen.getByRole('combobox', { name: 'Group papers by' })).toBeDisabled()
  })

  test('the signed-in role’s own extra tab stays editable, with no preview notice', () => {
    renderModal('researcher')
    fireEvent.click(screen.getByRole('tab', { name: 'Field map' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Group papers by' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Mark disagreements on the map' })).toBeEnabled()

    // Going back to your own role from a preview re-enables everything.
    previewRole('Teacher')
    fireEvent.click(screen.getByRole('tab', { name: 'Class and marking' }))
    expect(screen.getByDisplayValue('Alex S.')).toBeDisabled() // "Send reports as" input
    previewRole('Researcher')
    fireEvent.click(screen.getByRole('tab', { name: 'Field map' }))
    expect(screen.getByRole('combobox', { name: 'Group papers by' })).toBeEnabled()
  })
})

describe('settings tab list keyboard travel', () => {
  function settingsTabs() {
    return Array.from(screen.getByRole('tablist', { name: 'Settings sections' }).querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  }

  test('is a roving tabindex: only the selected tab is in the Tab order', () => {
    renderModal('writer')
    const tabs = settingsTabs()
    expect(tabs.filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(['Account'])
    expect(tabs.filter((t) => t.tabIndex === -1)).toHaveLength(tabs.length - 1)

    fireEvent.click(screen.getByRole('tab', { name: 'Checking' }))
    expect(settingsTabs().filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(['Checking'])
  })

  test('arrow keys move selection and DOM focus together, wrapping at both ends', () => {
    renderModal('writer')
    const account = screen.getByRole('tab', { name: 'Account' })
    account.focus()

    fireEvent.keyDown(account, { key: 'ArrowDown' })
    const roleTab = screen.getByRole('tab', { name: 'Appearance' })
    expect(roleTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(roleTab)
    expect(account).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(roleTab, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(account)
    expect(account).toHaveAttribute('aria-selected', 'true')

    // Up from the first wraps to the last; Down from the last wraps to the first.
    const last = settingsTabs().at(-1)!
    fireEvent.keyDown(account, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(last)
    expect(last).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(last, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(account)
  })

  test('Home and End jump to the first and last tab', () => {
    renderModal('teacher')
    const account = screen.getByRole('tab', { name: 'Account' })
    account.focus()

    fireEvent.keyDown(account, { key: 'End' })
    const classMarking = screen.getByRole('tab', { name: 'Class and marking' })
    expect(document.activeElement).toBe(classMarking)
    expect(classMarking).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Class and marking' })).toBeInTheDocument()

    fireEvent.keyDown(classMarking, { key: 'Home' })
    expect(document.activeElement).toBe(account)
    expect(account).toHaveAttribute('aria-selected', 'true')
  })
})

describe('row accessible names', () => {
  test('a bare input as a Row’s only child is labelled by the row, like Toggle and Select', () => {
    renderModal('teacher')
    fireEvent.click(screen.getByRole('tab', { name: 'Class and marking' }))
    const input = screen.getByRole('textbox', { name: 'Send reports as' })
    expect(input).toHaveValue('Alex S.')
    expect(input).toBeEnabled()
  })
})

describe('display name', () => {
  test('Account has a Display name row that saves through the shared PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderModal('researcher')

    const input = screen.getByRole('textbox', { name: 'Display name' })
    expect(input).toHaveValue('Alex')

    fireEvent.change(input, { target: { value: 'Ada Lovelace' } })
    expect(getSettings().displayName).toBe('Ada Lovelace') // optimistic
    expect(screen.getByText('AL')).toBeInTheDocument() // avatar initials follow
    await waitFor(() => expect(patchBodies(fetchMock)).toContainEqual({ displayName: 'Ada Lovelace' }))
  })

  test('an empty or whitespace-only name never blanks the badge, and is stored trimmed', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    renderModal('researcher')
    const input = screen.getByRole('textbox', { name: 'Display name' })

    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByText('?')).toBeInTheDocument() // initials fallback, not an empty badge
    fireEvent.blur(input)
    expect(getSettings().displayName).toBe('')
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: '  Ada  ' } })
    fireEvent.blur(input)
    expect(getSettings().displayName).toBe('Ada')
  })

  test('the greeting drops the name when it is blank', () => {
    expect(greeting('Ada Lovelace')).toBe('Good morning, Ada Lovelace')
    expect(greeting('  Ada ')).toBe('Good morning, Ada')
    expect(greeting('')).toBe('Good morning')
    expect(greeting('   ')).toBe('Good morning')
  })
})

describe('avatar image', () => {
  const photo = '/api/user/avatar/me?v=1'

  test('falls back to the initials badge when the photo fails to load, not the alt text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })))
    render(<Avatar initials="AL" photoUrl={photo} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('AL')).toBeInTheDocument())
    expect(screen.queryByText('Profile photo')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('shows the photo once fetched, and revokes the blob URL on change and unmount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(new Blob(['png']), { status: 200 }))),
    )
    const revoke = vi.mocked(URL.revokeObjectURL)
    revoke.mockClear()

    const { rerender, unmount } = render(<Avatar initials="AL" photoUrl={photo} />)
    const img = await screen.findByRole('img', { name: 'Profile photo' })
    expect(img).toHaveAttribute('src', 'blob:vitest')

    rerender(<Avatar initials="AL" photoUrl="/api/user/avatar/me?v=2" />)
    expect(revoke).toHaveBeenCalledWith('blob:vitest') // the old copy goes when the url changes
    await screen.findByRole('img', { name: 'Profile photo' })

    revoke.mockClear()
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:vitest') // and on unmount
  })
})

describe('avatar upload and remove when the preferences PATCH fails', () => {
  const stored = '/api/user/avatar/me?v=1'

  /** A gateway where the file calls succeed and the preferences PATCH fails. `onDisk` is
   * whether the avatar file is there to fetch afterwards: it is after an upload (the upload
   * replaced it) and not after a remove. */
  function gateway(onDisk: boolean) {
    return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/user/preferences') && method === 'GET') return Promise.resolve(new Response('{}', { status: 200 }))
      if (url.endsWith('/api/user/preferences') && method === 'PATCH') return Promise.resolve(new Response('down', { status: 500 }))
      if (url.endsWith('/api/user/avatar') && method === 'POST') return Promise.resolve(new Response(JSON.stringify({ url: stored }), { status: 200 }))
      if (url.endsWith('/api/user/avatar') && method === 'DELETE') return Promise.resolve(new Response(JSON.stringify({ deleted: true }), { status: 200 }))
      if (onDisk) return Promise.resolve(new Response(new Blob(['png']), { status: 200 }))
      return Promise.resolve(new Response('no avatar', { status: 404 }))
    })
  }

  test('a failed PATCH after a successful upload keeps the new avatarUrl, since the file on disk is already the new photo', async () => {
    vi.stubGlobal('fetch', gateway(true))
    const { container } = renderModal('researcher')
    expect(getSettings().avatarUrl).toBe('')

    const file = new File(['png'], 'me.png', { type: 'image/png' })
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [file] } })

    // The backend keeps one avatar file per user and the upload replaced it, so rolling the
    // url back to '' would show initials over a photo that exists. The store follows the disk.
    expect(await screen.findByRole('status')).toHaveTextContent('could not be saved to your account')
    expect(getSettings().avatarUrl).toBe(stored)
    expect(await screen.findByRole('img', { name: 'Profile photo' })).toBeInTheDocument()
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  test('a failed upload leaves the avatarUrl alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/api/user/avatar') && init?.method === 'POST') return Promise.resolve(new Response('down', { status: 500 }))
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
    const { container } = renderModal('researcher')

    const file = new File(['png'], 'me.png', { type: 'image/png' })
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(picker, { target: { files: [file] } })

    expect(await screen.findByRole('status')).toHaveTextContent('could not be uploaded')
    expect(getSettings().avatarUrl).toBe('')
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/user/preferences'), expect.objectContaining({ method: 'PATCH' }))
  })

  test('a failed PATCH after a successful remove restores the previous avatarUrl and shows initials', async () => {
    updateSettings({ avatarUrl: stored })
    vi.stubGlobal('fetch', gateway(false))
    renderModal('researcher')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('status')).toHaveTextContent('could not be removed')
    expect(getSettings().avatarUrl).toBe(stored) // rolled back to what the server blob still has
    expect(await screen.findByText('A')).toBeInTheDocument() // the file is gone, so initials
    expect(screen.queryByRole('img', { name: 'Profile photo' })).not.toBeInTheDocument()
    expect(screen.queryByText('Profile photo')).not.toBeInTheDocument()
  })
})

describe('search and the Roles group', () => {
  test('picking a role clears the search, so its tab set is not hidden behind a stale query', () => {
    renderModal('writer')
    const search = screen.getByRole('textbox', { name: 'Search settings' })

    fireEvent.change(search, { target: { value: 'Teach' } })
    // Only the Teacher role matches; the Settings list and the panel are gone.
    expect(screen.queryByRole('tablist', { name: 'Settings sections' })).not.toBeInTheDocument()
    expect(screen.getByText('No settings match "Teach".')).toBeInTheDocument()

    previewRole('Teacher')
    expect(search).toHaveValue('')
    expect(screen.getByRole('tab', { name: 'Class and marking' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.queryByText(/No settings match/)).not.toBeInTheDocument()
  })
})

describe('roles group keyboard travel', () => {
  function roleButtons() {
    return Array.from(screen.getByRole('tablist', { name: 'Roles' }).querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  }

  test('is a roving tabindex: only the previewed role is in the Tab order', () => {
    renderModal('researcher')
    expect(roleButtons().filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(['Researcher'])
    previewRole('Teacher')
    expect(roleButtons().filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(['Teacher'])
  })

  test('arrow keys move the preview and DOM focus together, wrapping at both ends', () => {
    renderModal('writer')
    const author = roleTabs().getByRole('tab', { name: 'Author' })
    author.focus()

    fireEvent.keyDown(author, { key: 'ArrowDown' })
    const researcher = roleTabs().getByRole('tab', { name: 'Researcher' })
    expect(document.activeElement).toBe(researcher)
    expect(researcher).toHaveAttribute('aria-selected', 'true')
    expect(author).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Field map' })).toBeInTheDocument() // the tab set swapped
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(researcher, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(author)
    expect(author).toHaveAttribute('aria-selected', 'true')

    const labeler = roleTabs().getByRole('tab', { name: 'Labeler' })
    fireEvent.keyDown(author, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(labeler)
    expect(screen.queryByRole('tab', { name: 'Checking' })).toBeNull() // the labeler's tab set
    fireEvent.keyDown(labeler, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(author)
  })

  test('Home and End jump to the first and last role, and the Settings list is untouched', () => {
    renderModal('researcher')
    const researcher = roleTabs().getByRole('tab', { name: 'Researcher' })
    researcher.focus()

    fireEvent.keyDown(researcher, { key: 'End' })
    const labeler = roleTabs().getByRole('tab', { name: 'Labeler' })
    expect(document.activeElement).toBe(labeler)
    expect(labeler).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(labeler, { key: 'Home' })
    expect(document.activeElement).toBe(roleTabs().getByRole('tab', { name: 'Author' }))
    // Settings tabs keep their own selection: still Account.
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('labeler settings', () => {
  test('has the shared tabs without Your data and Checking, and names the Labeler role', () => {
    renderModal('labeler')
    const settingsTabs = within(screen.getByRole('tablist', { name: 'Settings sections' }))
    expect(settingsTabs.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Account',
      'Appearance',
      'Notifications',
      'Agents',
      'Role and home',
    ])
    fireEvent.click(settingsTabs.getByRole('tab', { name: 'Role and home' }))
    expect(screen.getByText('Labeler', { selector: 'span' })).toBeInTheDocument()
  })

  test('turns on the dark theme from Appearance', () => {
    renderModal('labeler')
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'Dark' } })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  test('has no verdict badge toggle, since the labeler shows no verdicts', () => {
    renderModal('labeler')
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }))
    expect(screen.queryByText('Colour the verdict badges')).toBeNull()
  })
})

/** A gateway that answers DELETE /user/data and records which scope each call asked for. */
function deleteGateway(answer: { deleted: number; skipped: number }) {
  const deletes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes('/api/user/data')) {
        deletes.push(url.slice(url.indexOf('/api/user/data')))
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
  )
  return deletes
}

describe('researcher Delete all', () => {
  test('reports papers still being checked that the gateway kept, and deletes only the Researcher scope', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const deletes = deleteGateway({ deleted: 2, skipped: 1 })
    renderModal('researcher')
    fireEvent.click(screen.getByRole('tab', { name: 'Your data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 papers deleted. 1 paper still being checked was kept; delete again once it finishes.',
    )
    // PR #291 review: the Researcher's Delete all must not take the Author's drafts with it.
    expect(deletes).toEqual(['/api/user/data?scope=researcher'])
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/^Delete all uploaded papers\?/)
  })
})

describe('author Delete all', () => {
  test('deletes only the Author scope, so the Researcher papers stay, and reports checks still running', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const deletes = deleteGateway({ deleted: 3, skipped: 1 })
    renderModal('writer')
    fireEvent.click(screen.getByRole('tab', { name: 'Your data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Every draft was deleted. 1 check still running was kept; delete again once it finishes.',
    )
    expect(deletes).toEqual(['/api/user/data?scope=author'])
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/^Delete all drafts\?/)
  })

  test('a declined confirm sends nothing', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const deletes = deleteGateway({ deleted: 0, skipped: 0 })
    renderModal('writer')
    fireEvent.click(screen.getByRole('tab', { name: 'Your data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(deletes).toEqual([])
  })
})
