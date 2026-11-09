/** components/AppShell.tsx: the profile menu, the phone drawer and the folded rail. The bare
 * shell is in app-shell-bare.test.tsx, folding in app-shell-fold.test.tsx and the shown name in
 * profile-chip-name.test.tsx. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { Home, Library } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../src/components/AppShell'
import { resetSettings, updateSettings } from '../src/lib/settings'

const mocked = vi.hoisted(() => ({
  authEnabled: false,
  session: null as null | { user: { email: string; user_metadata: Record<string, unknown> } },
  signOut: vi.fn(),
}))
vi.mock('../src/lib/supabase', () => ({
  get authEnabled() {
    return mocked.authEnabled
  },
  supabase: null,
  sessionStorageKey: '',
}))
vi.mock('../src/lib/useAuth', () => ({ useAuth: () => ({ session: mocked.session }), signOut: mocked.signOut }))

const NAV = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'library', label: 'Library', icon: Library },
]

const onNavigate = vi.fn()
const onChangeRole = vi.fn()
const onOpenSettings = vi.fn()

function shell(props: Partial<React.ComponentProps<typeof AppShell<string>>> = {}) {
  return render(
    <AppShell
      nav={NAV}
      active="home"
      onNavigate={onNavigate}
      role="Author"
      roleIcon={Home}
      onChangeRole={onChangeRole}
      onOpenSettings={onOpenSettings}
      {...props}
    >
      <p>content</p>
    </AppShell>,
  )
}

const openProfile = () => fireEvent.click(screen.getByRole('button', { name: /Alex/ }))

beforeEach(() => {
  mocked.authEnabled = false
  mocked.session = null
  resetSettings()
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem('shell.sidebarFolded')
})

describe('the profile menu', () => {
  it('shows the identity, the role and a local-only address when nobody is signed in', () => {
    shell()
    openProfile()

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Signed in locally')).toBeInTheDocument()
    expect(within(menu).getByText('Author')).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('falls back to "Your account" when the display name is blank and nobody is signed in', () => {
    updateSettings({ displayName: '   ' })
    shell()
    expect(screen.getByRole('button', { name: /Your account/ })).toBeInTheDocument()
  })

  it('uses the first letters of a two-word name for the initials', () => {
    updateSettings({ displayName: 'ada lovelace' })
    shell()
    expect(screen.getByRole('button', { name: /ada lovelace/ })).toBeInTheDocument()
  })

  it('opens Settings from the menu item and closes the menu', () => {
    shell()
    openProfile()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens Settings from the gear without opening the menu', () => {
    shell()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('has no Settings entry or gear when the role does not pass onOpenSettings', () => {
    shell({ onOpenSettings: undefined })
    openProfile()
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('asks to change the role', () => {
    shell()
    openProfile()
    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    expect(onChangeRole).toHaveBeenCalledTimes(1)
  })

  it('offers Sign out when auth is on, and signing out closes the menu', () => {
    mocked.authEnabled = true
    mocked.session = { user: { email: 'ada@kmutt.ac.th', user_metadata: {} } }
    shell()
    fireEvent.click(screen.getByRole('button', { name: /ada@kmutt.ac.th/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(mocked.signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on a click outside, but not on a click inside', () => {
    shell()
    openProfile()
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and ignores other keys', () => {
    shell()
    openProfile()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('the phone drawer', () => {
  const openDrawer = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }))
    return screen.getByRole('dialog', { name: 'Menu' })
  }

  it('closes on Escape and ignores other keys', () => {
    shell()
    openDrawer()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes from its Close button', () => {
    shell()
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Close the menu' }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes when the dimmed area is clicked', () => {
    shell()
    const drawer = openDrawer()
    fireEvent.click(drawer.firstElementChild as Element)
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes after going to a screen', () => {
    shell()
    const drawer = openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Library' }))

    expect(onNavigate).toHaveBeenCalledWith('library')
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes when Settings is opened from it', () => {
    shell()
    const drawer = openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes after a click on something marked data-closes-menu, and stays open for any other', () => {
    shell({
      sidebar: (
        <>
          <button type="button" data-closes-menu>
            Open analysis
          </button>
          <button type="button">Delete analysis</button>
        </>
      ),
    })
    const drawer = openDrawer()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete analysis' }))
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Open analysis' }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('leaves out the profile footer when showProfileMenu is false', () => {
    shell({ showProfileMenu: false })
    expect(screen.queryByRole('button', { name: /Alex/ })).not.toBeInTheDocument()
  })
})

describe('the folded rail', () => {
  it('goes to a screen from its icon and marks only the current one', () => {
    window.localStorage.setItem('shell.sidebarFolded', '1')
    shell({ foldable: true })

    const rail = within(screen.getByRole('complementary', { name: 'Sidebar' }))
    expect(rail.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(rail.getByRole('button', { name: 'Library' })).not.toHaveAttribute('aria-current')

    fireEvent.click(rail.getByRole('button', { name: 'Library' }))
    expect(onNavigate).toHaveBeenCalledWith('library')
  })

  it('starts open when the browser will not say what was chosen before', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    shell({ foldable: true })
    expect(screen.getByRole('button', { name: 'Fold the sidebar' })).toBeInTheDocument()
  })
})

describe('the sidebar', () => {
  it('lights the profile row while Settings is showing', () => {
    shell({ settingsActive: true })
    expect(screen.getByRole('button', { name: /Alex/ })).toHaveClass('border-accent')
  })
})
