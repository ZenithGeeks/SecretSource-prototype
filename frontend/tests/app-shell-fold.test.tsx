/** A foldable shell folds its sidebar to a rail of nav icons, and the choice survives a reload
 * (#586: labelers wanted more room for the two PDFs). */

import { fireEvent, render, screen } from '@testing-library/react'
import { Tags } from 'lucide-react'
import { afterEach, expect, test, vi } from 'vitest'

import { AppShell } from '../src/components/AppShell'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => window.localStorage.removeItem('shell.sidebarFolded'))

const shell = (foldable: boolean) => (
  <AppShell
    nav={[{ key: 'papers', label: 'Papers to label', icon: Tags }]}
    active="papers"
    onNavigate={() => {}}
    role="Labeler"
    roleIcon={Tags}
    foldable={foldable}
  >
    <p>content</p>
  </AppShell>
)

const isFolded = () => screen.getByRole('complementary', { name: 'Sidebar' }).hasAttribute('data-folded')

test('folds the sidebar to icons, keeps focus on the toggle, and remembers the choice', () => {
  const { unmount } = render(shell(true))
  const toggle = screen.getByRole('button', { name: 'Fold the sidebar' })
  toggle.focus()
  fireEvent.click(toggle)

  expect(isFolded()).toBe(true)
  expect(screen.getByRole('button', { name: 'Open the sidebar' })).toBe(toggle)
  expect(document.activeElement).toBe(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getAllByRole('button', { name: 'Papers to label' }).some((b) => b.getAttribute('aria-current') === 'page')).toBe(true)
  expect(window.localStorage.getItem('shell.sidebarFolded')).toBe('1')

  unmount()
  render(shell(true))
  expect(isFolded()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Open the sidebar' }))
  expect(isFolded()).toBe(false)
  expect(window.localStorage.getItem('shell.sidebarFolded')).toBe('0')
})

test('a shell that is not foldable has no fold button and ignores a stored choice', () => {
  window.localStorage.setItem('shell.sidebarFolded', '1')
  render(shell(false))
  expect(screen.queryByRole('button', { name: 'Fold the sidebar' })).not.toBeInTheDocument()
  expect(isFolded()).toBe(false)
})
