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

test('folds the sidebar to icons, keeps the nav working, and remembers the choice', () => {
  const { unmount } = render(shell(true))
  fireEvent.click(screen.getByRole('button', { name: 'Fold the sidebar' }))

  expect(screen.getByRole('complementary', { name: 'Sidebar, folded' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Papers to label' }).some((b) => b.getAttribute('aria-current') === 'page')).toBe(true)
  expect(window.localStorage.getItem('shell.sidebarFolded')).toBe('1')

  unmount()
  render(shell(true))
  expect(screen.getByRole('complementary', { name: 'Sidebar, folded' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open the sidebar' }))
  expect(screen.queryByRole('complementary', { name: 'Sidebar, folded' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem('shell.sidebarFolded')).toBe('0')
})

test('a shell that is not foldable has no fold button and ignores a stored choice', () => {
  window.localStorage.setItem('shell.sidebarFolded', '1')
  render(shell(false))
  expect(screen.queryByRole('button', { name: 'Fold the sidebar' })).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Sidebar, folded' })).not.toBeInTheDocument()
})
