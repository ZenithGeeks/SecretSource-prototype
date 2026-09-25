/** components/SettingsModal.tsx + settingsTabs.tsx: what stays inert while previewing another
 * role's tabs from the Roles group, and keyboard travel along the settings tab list. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { SettingsModal } from '../src/components/SettingsModal'

// Signed-out, no Supabase: request() then sends without a token instead of throwing
// SignedOut, whatever a local .env says (the same env dependency as SCRUM-245).
vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))
import { getSettings, greeting, resetSettings } from '../src/lib/settings'
import { resetTeacherPreferences } from '../src/lib/teacherPreferences'
import { resetTeacherStore } from '../src/lib/teacherStore'

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function renderModal(currentRole: 'writer' | 'researcher' | 'teacher') {
  return renderWithQuery(<SettingsModal open onClose={vi.fn()} currentRole={currentRole} onSwitchRole={vi.fn()} />)
}

/** The Roles group in the aside: plain buttons (role="tab" but outside the Settings tablist),
 * found by their label. */
function previewRole(label: 'Author' | 'Researcher' | 'Teacher') {
  fireEvent.click(screen.getByRole('tab', { name: label }))
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
    expect(screen.getByDisplayValue('Wittawat S.')).toBeDisabled() // "Send reports as" input

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
    expect(screen.getByDisplayValue('Wittawat S.')).toBeDisabled() // "Send reports as" input
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
    const roleTab = screen.getByRole('tab', { name: 'Role and home' })
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
    expect(input).toHaveValue('Wittawat S.')
    expect(input).toBeEnabled()
  })
})

describe('display name', () => {
  test('Account has a Display name row that saves through the shared PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderModal('researcher')

    const input = screen.getByRole('textbox', { name: 'Display name' })
    expect(input).toHaveValue('Wittawat')

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
