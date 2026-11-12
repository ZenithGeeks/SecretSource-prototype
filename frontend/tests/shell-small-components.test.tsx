/** The small shared components: Brand, SearchField, FacetFilter, Mascot, SplitPane, and the
 * pieces of ui.tsx and settingsTabs.tsx the other tests do not reach. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/components/Brand'
import { FacetFilter } from '../src/components/FacetFilter'
import { Mascot } from '../src/components/Mascot'
import { SearchField } from '../src/components/SearchField'
import { getSettingsTabs } from '../src/components/settingsTabs'
import { SplitPane } from '../src/components/SplitPane'
import { Progress, VerdictBadge } from '../src/components/ui'
import type { Role } from '../src/lib/roles'
import { resetSettings, updateSettings } from '../src/lib/settings'
import { renderWithMotion } from './motion'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  resetSettings()
})

describe('Brand', () => {
  it('shows the tagline by default, and drops it when compact or hero', () => {
    const tagline = /Checks whether the sources/
    const { rerender } = render(<Brand />)
    expect(screen.getByText(tagline)).toBeInTheDocument()

    rerender(<Brand compact />)
    expect(screen.queryByText(tagline)).not.toBeInTheDocument()

    rerender(<Brand hero />)
    expect(screen.queryByText(tagline)).not.toBeInTheDocument()
    expect(screen.getByText('Secret')).toHaveClass('font-semibold')
  })
})

describe('SearchField', () => {
  it('reports typing, and clears from its own button once there is text', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchField label="Search papers" value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Clear search papers' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search papers'), { target: { value: 'colbert' } })
    expect(onChange).toHaveBeenLastCalledWith('colbert')

    rerender(<SearchField label="Search papers" value="colbert" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search papers' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('shows a spinner instead of the clear button while a search runs', () => {
    render(<SearchField label="Search papers" value="colbert" onChange={() => {}} busy />)
    expect(screen.getByLabelText('Searching')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search papers' })).not.toBeInTheDocument()
  })
})

describe('FacetFilter', () => {
  const options = [
    { value: 'a', label: 'Alpha', count: 3 },
    { value: 'b', label: 'Beta', count: 0 },
    { value: 'c', label: 'Gamma', count: 1 },
  ]
  const trigger = () => screen.getByRole('button', { name: /^Status/ })

  it('adds a value, removes it again, and shows the chosen labels on the button', () => {
    const onChange = vi.fn()
    const { rerender } = render(<FacetFilter label="Status" options={options} selected={[]} onChange={onChange} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    expect(onChange).toHaveBeenLastCalledWith(['a'])

    rerender(<FacetFilter label="Status" options={options} selected={['a', 'b']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    expect(onChange).toHaveBeenLastCalledWith(['b'])
    expect(trigger()).toHaveTextContent('AlphaBeta')
  })

  it('sums up three or more chosen values and clears them all from the panel', () => {
    const onChange = vi.fn()
    render(<FacetFilter label="Status" options={options} selected={['a', 'b', 'c']} onChange={onChange} />)
    expect(trigger()).toHaveTextContent('3 chosen')

    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('moves the panel left when the button sits near the right edge', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 900 } as DOMRect)
    render(<FacetFilter label="Status" options={options} selected={[]} onChange={() => {}} />)
    fireEvent.click(trigger())
    // window.innerWidth is 1024: 1024 - 16 - 256 - 900 = -148
    expect(screen.getByRole('group', { name: 'Status' })).toHaveStyle({ left: '-148px' })
  })

  it('closes on a press outside, but not inside, and on focus leaving', () => {
    render(<FacetFilter label="Status" options={options} selected={[]} onChange={() => {}} />)
    fireEvent.click(trigger())
    fireEvent.pointerDown(screen.getByRole('group', { name: 'Status' }))
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument()

    fireEvent.click(trigger())
    fireEvent.focusOut(screen.getByRole('checkbox', { name: /Alpha/ }), { relatedTarget: screen.getByRole('checkbox', { name: /Beta/ }) })
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument()

    fireEvent.focusOut(trigger(), { relatedTarget: document.body })
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the button, ignoring other keys', () => {
    render(<FacetFilter label="Status" options={options} selected={[]} onChange={() => {}} />)
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })
})

describe('Mascot', () => {
  it('draws each role with its prop', () => {
    const roles: Role[] = ['researcher', 'writer', 'teacher', 'labeler']
    for (const role of roles) {
      const { container, unmount } = render(<Mascot role={role} animated />)
      expect(container.querySelector('svg')).toBeInTheDocument()
      unmount()
    }
  })

  it('wiggles its prop while hovered and settles when the pointer leaves', async () => {
    const { container } = renderWithMotion(<Mascot role="writer" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    // framer-motion reports a hover on the next animation frame.
    const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))
    svg.dispatchEvent(new MouseEvent('pointerenter'))
    await settle()
    svg.dispatchEvent(new MouseEvent('pointerleave'))
    await settle()
    expect(svg).toBeInTheDocument()
  })
})

describe('SplitPane drag', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
    HTMLElement.prototype.setPointerCapture = vi.fn()
  })

  const pane = (storageKey?: string) => (
    <SplitPane left={<p>left</p>} right={<p>right</p>} leftLabel="Paper" rightLabel="Claims" storageKey={storageKey} />
  )
  const move = (target: Element, clientX: number) => act(() => void target.dispatchEvent(new MouseEvent('pointermove', { clientX })))

  it('follows the pointer, keeps the ratio when released, and stops following after that', () => {
    render(pane('test.split.drag'))
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { pointerId: 1 })
    move(handle, 300)
    expect(handle).toHaveAttribute('aria-valuenow', '30')
    expect(window.localStorage.getItem('test.split.drag')).toBeNull() // written on release, not on every move

    handle.dispatchEvent(new Event('pointerup'))
    expect(window.localStorage.getItem('test.split.drag')).toBe('0.3')

    move(handle, 600)
    expect(handle).toHaveAttribute('aria-valuenow', '30')
  })

  it('also ends the drag when the pointer is cancelled', () => {
    render(pane())
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { pointerId: 1 })
    move(handle, 400)
    handle.dispatchEvent(new Event('pointercancel'))
    move(handle, 700)

    expect(handle).toHaveAttribute('aria-valuenow', '40')
  })

  it('starts from the default when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(pane('test.split.blocked'))
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50')
  })

  it('still moves when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(pane('test.split.blocked'))
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '55')
  })

  it('ignores keys it does not use', () => {
    render(pane())
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'a' })
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '50')
  })
})

describe('ui.tsx', () => {
  it('shows a verdict as plain text, with the dot in the text colour, when the badges are not coloured', () => {
    updateSettings({ colorBadges: false })
    render(<VerdictBadge verdict="supports" />)
    expect(screen.getByText('Source backs it').closest('span[data-verdict]')).toHaveClass('text-ink')
    expect(screen.getByTestId('verdict-dot')).toHaveClass('bg-current')
  })

  it('draws an empty bar when the maximum is zero', () => {
    render(<Progress value={0} max={0} label="Pages read" />)
    expect(screen.getByRole('progressbar', { name: 'Pages read' }).firstElementChild).toHaveStyle({ width: '0%' })
  })
})

describe('getSettingsTabs', () => {
  it('names the first role when the current role is not one it knows', () => {
    const tabs = getSettingsTabs('writer', 'nobody' as Role, () => {})
    render(<>{tabs.find((tab) => tab.id === 'role')?.content}</>)
    expect(screen.getByText('Author')).toBeInTheDocument()
  })
})
