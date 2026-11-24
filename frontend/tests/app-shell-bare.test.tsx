/** A bare shell is for a full-bleed screen with its own top bar (the Author's editor): no
 * sidebar, phone top bar or toolbar. The default shell every other screen uses keeps all three,
 * and moving between the two keeps the panel mounted, so a Do it run in it goes on. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { Home, Library } from 'lucide-react'
import { useEffect, useState } from 'react'
import { expect, test, vi } from 'vitest'

import { AppShell, ToolbarActions } from '../src/components/AppShell'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

const NAV = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'library', label: 'Library', icon: Library },
]

let mounts = 0

/** Stands in for the Ask panel: counts its mounts and keeps a value in state. */
function Panel() {
  const [value, setValue] = useState('')
  useEffect(() => {
    mounts += 1
  }, [])
  return <input aria-label="Panel field" value={value} onChange={(event) => setValue(event.target.value)} />
}

const shell = (bare: boolean) => (
  <AppShell
    nav={NAV}
    active="home"
    onNavigate={() => {}}
    role="Author"
    roleIcon={Home}
    breadcrumb={['Home']}
    toolbarLead={<button type="button">Ask AI</button>}
    panel={<Panel />}
    bare={bare}
  >
    <p>content</p>
    <ToolbarActions>
      <button type="button">Export</button>
    </ToolbarActions>
  </AppShell>
)

test('the default shell has the sidebar, the phone top bar and the toolbar, with the panel under it', () => {
  render(shell(false))
  expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open the menu' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Home')
  expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toHaveClass('mx-auto', 'max-w-6xl', 'px-4', 'py-6')
  expect(screen.getByLabelText('Panel field').parentElement).toHaveClass('lg:top-[52px]', 'lg:h-[calc(100vh-52px)]', 'lg:w-[400px]')
})

test('a bare shell has none of them: the content fills the window and the panel runs its full height', () => {
  render(shell(true))
  expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  expect(screen.getByText('content')).toBeInTheDocument()
  expect(screen.getByRole('main')).toHaveClass('h-screen', 'overflow-hidden')
  expect(screen.getByRole('main')).not.toHaveClass('max-w-6xl')
  expect(screen.getByLabelText('Panel field').parentElement).toHaveClass('lg:top-0', 'lg:h-screen', 'lg:w-[400px]')
})

test('moving between the default shell and a bare one keeps the panel mounted', () => {
  mounts = 0
  const { rerender } = render(shell(false))
  const field = screen.getByLabelText('Panel field') as HTMLInputElement
  fireEvent.change(field, { target: { value: 'kept' } })

  rerender(shell(true))
  rerender(shell(false))
  expect(screen.getByLabelText('Panel field')).toBe(field)
  expect(field.value).toBe('kept')
  expect(mounts).toBe(1)
})

test('a breadcrumb part with an action is a button, and the last part is text even if it has one', () => {
  const back = vi.fn()
  const stay = vi.fn()
  render(
    <AppShell
      nav={NAV}
      active="home"
      onNavigate={() => {}}
      role="Author"
      roleIcon={Home}
      breadcrumb={[{ label: 'Library', onSelect: back }, 'Projects', { label: 'Current', onSelect: stay }]}
    >
      <p>content</p>
    </AppShell>,
  )
  const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
  fireEvent.click(within(trail).getByRole('button', { name: 'Library' }))
  expect(back).toHaveBeenCalledOnce()
  // A plain string and the last part are not buttons; the last one marks the current page.
  expect(within(trail).queryByRole('button', { name: 'Projects' })).toBeNull()
  expect(within(trail).queryByRole('button', { name: 'Current' })).toBeNull()
  expect(within(trail).getByText('Current')).toHaveAttribute('aria-current', 'page')
  expect(stay).not.toHaveBeenCalled()
})

test('a full-width shell is locked to the window and is the containing block for what is inside it', () => {
  // An absolute element (an sr-only input) deep in a scrolled panel anchors to the nearest
  // positioned ancestor. Unless that is the clipped shell, it stretches the page and the window
  // scrolls the workspace away.
  const { container } = render(
    <AppShell nav={NAV} active="home" onNavigate={() => {}} role="Labeler" roleIcon={Home} breadcrumb={['Home']} wide="full">
      <p>content</p>
    </AppShell>,
  )
  expect(container.firstElementChild).toHaveClass('lg:relative', 'lg:h-dvh', 'lg:min-h-0', 'lg:overflow-clip')
  expect(screen.getByRole('complementary', { name: 'Sidebar' })).toHaveClass('lg:h-dvh')
})

test('a full-width screen can put a header row in the top bar, and draws it in place with no bar', () => {
  const header = (
    <ToolbarActions orInline>
      <span>Claim strip</span>
    </ToolbarActions>
  )
  const { unmount } = render(
    <AppShell nav={NAV} active="home" onNavigate={() => {}} role="Labeler" roleIcon={Home} breadcrumb={['Papers', 'A paper']} wide="full">
      {header}
    </AppShell>,
  )
  expect(screen.getByText('Claim strip').closest('main')).toBeNull()
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' }).parentElement
  expect(breadcrumb).toHaveClass('max-w-xs', 'lg:shrink-0')
  expect(breadcrumb).not.toHaveClass('shrink-0')
  expect(breadcrumb?.nextElementSibling).toHaveClass('shrink-0', 'lg:flex-1', 'lg:shrink')
  unmount()
  render(header)
  expect(screen.getByText('Claim strip')).toBeInTheDocument()
})
