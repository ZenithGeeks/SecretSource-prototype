/** components/settingsSections.tsx through the Settings modal: the Account tab (avatar, name,
 * email, password), every role's Your data tab, and the controls that save a setting. The
 * preview rules are in settings-modal.test.tsx and the notifications toggle in
 * notifications-setting.test.tsx. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsModal } from '../src/components/SettingsModal'
import { getSettings, resetSettings, updateSettings } from '../src/lib/settings'
import { getTeacherPreferences, resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { resetTeacherStore } from '../src/lib/teacherStore'

const mocked = vi.hoisted(() => ({
  authEnabled: false,
  supabase: null as unknown,
}))
vi.mock('../src/lib/supabase', () => ({
  get authEnabled() {
    return mocked.authEnabled
  },
  get supabase() {
    return mocked.supabase
  },
  sessionStorageKey: '',
}))

type Role = 'writer' | 'researcher' | 'teacher' | 'labeler'

/** What the gateway answers, by "METHOD /path". Anything not listed answers `{}`. */
let answers: Record<string, () => Response>
let calls: { method: string; path: string; body?: string }[]

function json(body: unknown, status = 200) {
  return () => new Response(JSON.stringify(body), { status })
}

function stubGateway() {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.slice(url.indexOf('/api') + 4)
      const method = init?.method ?? 'GET'
      calls.push({ method, path, body: typeof init?.body === 'string' ? init.body : undefined })
      const answer = answers[`${method} ${path}`] ?? answers[`${method} ${path.split('?')[0]}`]
      if (answer) return answer()
      if (method === 'GET' && path === '/memories') return new Response('[]', { status: 200 })
      return new Response('{}', { status: 200 })
    }),
  )
}

function renderModal(currentRole: Role) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsModal open onClose={vi.fn()} currentRole={currentRole} onSwitchRole={vi.fn()} />
    </QueryClientProvider>,
  )
}

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const patches = () => calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body as string).patch)

beforeEach(() => {
  mocked.authEnabled = false
  mocked.supabase = null
  answers = {}
  resetSettings()
  resetTeacherPreferences()
  resetTeacherStore()
  stubGateway()
  // Saving a file clicks a temporary link; jsdom would try to navigate to it.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Account: avatar', () => {
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
  const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } })
  const png = () => new File(['x'], 'me.png', { type: 'image/png' })

  it('does nothing when the picker is closed without a file', () => {
    renderModal('writer')
    fireEvent.change(fileInput(), { target: { files: [] } })
    expect(calls).toHaveLength(0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens the file picker from Upload', () => {
    renderModal('writer')
    const click = vi.spyOn(fileInput(), 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(click).toHaveBeenCalled()
  })

  it('uploads a photo, keeps its address and saves it to the account', async () => {
    answers['POST /user/avatar'] = json({ url: '/api/user/avatar/me?v=1' })
    renderModal('writer')
    choose(png())

    await waitFor(() => expect(getSettings().avatarUrl).toBe('/api/user/avatar/me?v=1'))
    await waitFor(() => expect(patches()).toContainEqual({ avatarUrl: '/api/user/avatar/me?v=1' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('refuses a file that is not a PNG, JPEG or WebP image', () => {
    renderModal('writer')
    choose(new File(['x'], 'me.gif', { type: 'image/gif' }))
    expect(screen.getByRole('status')).toHaveTextContent('Avatars must be a PNG, JPEG or WebP image.')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('refuses a file over 2 MB', () => {
    renderModal('writer')
    const big = png()
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    choose(big)
    expect(screen.getByRole('status')).toHaveTextContent('Avatars must be under 2MB.')
  })

  it('says so when the upload fails', async () => {
    answers['POST /user/avatar'] = json('no', 500)
    renderModal('writer')
    choose(png())
    expect(await screen.findByText('The avatar could not be uploaded. Try again.')).toBeInTheDocument()
    expect(getSettings().avatarUrl).toBe('')
  })

  it('says the account record is behind when the photo uploaded but the save failed', async () => {
    answers['POST /user/avatar'] = json({ url: '/api/user/avatar/me?v=2' })
    answers['PATCH /user/preferences'] = json('no', 500)
    renderModal('writer')
    choose(png())

    expect(await screen.findByText(/uploaded, but it could not be saved to your account/)).toBeInTheDocument()
    expect(getSettings().avatarUrl).toBe('/api/user/avatar/me?v=2')
  })

  it('removes the photo and saves that to the account', async () => {
    updateSettings({ avatarUrl: '/api/user/avatar/me?v=1' })
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(patches()).toContainEqual({ avatarUrl: '' }))
    expect(getSettings().avatarUrl).toBe('')
  })

  it('puts the photo back and says so when it could not be removed', async () => {
    updateSettings({ avatarUrl: '/api/user/avatar/me?v=1' })
    answers['DELETE /user/avatar'] = json('no', 500)
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('The avatar could not be removed. Try again.')).toBeInTheDocument()
    expect(getSettings().avatarUrl).toBe('/api/user/avatar/me?v=1')
  })
})

describe('Account: display name', () => {
  it('stores the name as typed and tidies spaces when the field loses focus', () => {
    renderModal('writer')
    const field = screen.getByRole('textbox', { name: 'Display name' })

    fireEvent.change(field, { target: { value: '  Ada  ' } })
    expect(getSettings().displayName).toBe('  Ada  ')
    fireEvent.blur(field)
    expect(getSettings().displayName).toBe('Ada')
  })

  it('does not save again on blur when there is nothing to trim', () => {
    renderModal('writer')
    const field = screen.getByRole('textbox', { name: 'Display name' })
    fireEvent.change(field, { target: { value: 'Ada' } })
    const before = calls.length
    fireEvent.blur(field)
    expect(calls).toHaveLength(before)
  })
})

describe('Account: email and password', () => {
  const updateUser = vi.fn()

  function signedIn() {
    mocked.authEnabled = true
    mocked.supabase = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        updateUser,
      },
    }
  }

  beforeEach(() => {
    updateUser.mockReset()
    updateUser.mockResolvedValue({ error: null })
  })

  it('asks to sign in before changing the email or password when auth is off', () => {
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sign in to change your email address.')

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sign in to change your password.')
  })

  it('asks Supabase for the new email and tells the person to check their inbox', async () => {
    signedIn()
    vi.spyOn(window, 'prompt').mockReturnValue('  new@kmutt.ac.th ')
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    expect(await screen.findByText('Check your inbox to confirm the new address.')).toBeInTheDocument()
    expect(updateUser).toHaveBeenCalledWith({ email: 'new@kmutt.ac.th' })
  })

  it('shows Supabase’s message when the email change is refused', async () => {
    signedIn()
    updateUser.mockResolvedValue({ error: { message: 'Email already taken' } })
    vi.spyOn(window, 'prompt').mockReturnValue('taken@kmutt.ac.th')
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByText('Email already taken')).toBeInTheDocument()
  })

  it.each([
    ['is cancelled', null],
    ['is left empty', '  '],
    ['is the current address', 'alex@kmutt.ac.th'],
  ])('does nothing when the prompt %s', (_name, answer) => {
    signedIn()
    vi.spyOn(window, 'prompt').mockReturnValue(answer)
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('updates the password', async () => {
    signedIn()
    vi.spyOn(window, 'prompt').mockReturnValue('long enough')
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password updated.')).toBeInTheDocument()
    expect(updateUser).toHaveBeenCalledWith({ password: 'long enough' })
  })

  it('shows Supabase’s message when the password change is refused', async () => {
    signedIn()
    updateUser.mockResolvedValue({ error: { message: 'Password is too weak' } })
    vi.spyOn(window, 'prompt').mockReturnValue('password1')
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Password is too weak')).toBeInTheDocument()
  })

  it('refuses a password under 8 characters', () => {
    signedIn()
    vi.spyOn(window, 'prompt').mockReturnValue('short')
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByRole('status')).toHaveTextContent('Password must be at least 8 characters.')
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('does nothing when the password prompt is cancelled', () => {
    signedIn()
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    renderModal('writer')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(updateUser).not.toHaveBeenCalled()
  })
})

describe('Your data: researcher', () => {
  const openData = () => {
    renderModal('researcher')
    openTab('Your data')
  }

  it('exports the library of every project as one JSON file', async () => {
    answers['GET /researcher/projects'] = json([{ id: 'p1', name: 'Thesis' }])
    answers['GET /researcher/projects/p1/library'] = json({ papers: [] })
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(await screen.findByText('Library exported.')).toBeInTheDocument()
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('deletes nothing when the person declines the confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/user/data'))).toBe(false)
  })

  it.each([
    [{ deleted: 3, skipped: 0 }, 'Every uploaded paper was deleted.'],
    [{ deleted: 1, skipped: 1 }, '1 paper deleted. 1 paper still being checked was kept; delete again once it finishes.'],
    [{ deleted: 3, skipped: 2 }, '3 papers deleted. 2 papers still being checked were kept; delete again once they finish.'],
  ])('reports %j after deleting', async (result, message) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    answers['DELETE /user/data'] = json(result)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('says the papers are still there when the delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    answers['DELETE /user/data'] = json('no', 500)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(await screen.findByText(/Delete failed — the papers are still there/)).toBeInTheDocument()
  })
})

describe('Your data: author', () => {
  const openData = () => {
    renderModal('writer')
    openTab('Your data')
  }

  it('exports drafts, projects, sources and checks', async () => {
    answers['GET /author/export'] = json({ drafts: [] })
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByText('Drafts, projects, sources and checks exported.')).toBeInTheDocument()
  })

  it('says so when the export fails', async () => {
    answers['GET /author/export'] = json('no', 500)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByText('Export failed — try again.')).toBeInTheDocument()
  })

  it('deletes nothing when the person declines the confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it.each([
    [{ deleted: 3, skipped: 0 }, 'Every draft was deleted.'],
    [{ deleted: 3, skipped: 1 }, 'Every draft was deleted. 1 check still running was kept; delete again once it finishes.'],
    [{ deleted: 3, skipped: 2 }, 'Every draft was deleted. 2 checks still running were kept; delete again once they finish.'],
  ])('reports %j after deleting', async (result, message) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    answers['DELETE /user/data'] = json(result)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('says the drafts are still there when the delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    answers['DELETE /user/data'] = json('no', 500)
    openData()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(await screen.findByText(/Delete failed — your drafts are still there/)).toBeInTheDocument()
  })
})

describe('Your data: teacher', () => {
  it('keeps the local essay data when the person declines the confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderModal('teacher')
    openTab('Your data')
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    expect(screen.queryByText('Local uploaded essay data was reset.')).not.toBeInTheDocument()
  })
})

describe('Your data: previewing another role', () => {
  it.each([
    ['Researcher', 'Switch to Researcher to delete.'],
    ['Author', 'Switch to Author to delete.'],
    ['Teacher', 'Switch to Teacher to delete.'],
  ])('%s keeps Delete all off and says how to enable it', (label, hint) => {
    renderModal(label === 'Teacher' ? 'writer' : 'labeler')
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Roles' })).getByRole('tab', { name: label }))
    openTab('Your data')
    expect(screen.getByText(new RegExp(hint))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeDisabled()
  })
})

describe('Notifications: turning the setting off', () => {
  it('saves it off without asking the browser again', () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    updateSettings({ notifyDone: true })
    renderModal('writer')
    openTab('Notifications')

    fireEvent.click(screen.getByRole('switch', { name: 'When a paper finishes' }))

    expect(getSettings().notifyDone).toBe(false)
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('controls that save a setting', () => {
  it('Checking: citation style, strictness and the two switches', async () => {
    renderModal('writer')
    openTab('Checking')

    fireEvent.change(screen.getByRole('combobox', { name: 'Citation style' }), { target: { value: 'Chicago' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'How strict a match must be' }), { target: { value: 'Strict' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Check a paper as soon as it is added' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Flag quotes that differ from the source' }))

    expect(getSettings()).toMatchObject({ citationStyle: 'Chicago', strictness: 'Strict', checkOnAdd: false, flagQuotes: false })
    await waitFor(() => expect(patches()).toHaveLength(4))
  })

  it('Appearance: the verdict badge colours', () => {
    renderModal('writer')
    openTab('Appearance')
    fireEvent.click(screen.getByRole('switch', { name: 'Colour the verdict badges' }))
    expect(getSettings().colorBadges).toBe(false)
  })

  it('Field map: grouping, smallest group and disagreements', () => {
    renderModal('researcher')
    openTab('Field map')

    fireEvent.change(screen.getByRole('combobox', { name: 'Group papers by' }), { target: { value: 'Citations' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Smallest group to draw' }), { target: { value: '5 papers' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Mark disagreements on the map' }))

    expect(getSettings()).toMatchObject({ groupBy: 'Citations', smallestGroup: '5 papers', markDisagreements: false })
  })

  it('Class and marking: default class, student report and sender name', async () => {
    renderModal('teacher')
    openTab('Class and marking')

    const select = screen.getByRole('combobox', { name: 'Default class' })
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
    const other = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .find((value) => value !== getTeacherPreferences().defaultClassId) as string
    fireEvent.change(select, { target: { value: other } })
    fireEvent.click(screen.getByRole('switch', { name: 'Show student report' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Send reports as' }), { target: { value: 'Ms Ada' } })

    expect(getTeacherPreferences()).toMatchObject({
      defaultClassId: other,
      studentReportVisibility: false,
      sendReportsAs: 'Ms Ada',
    })
  })
})
