/** Roving focus: a radio group is one Tab stop, and the arrow keys move along it without
 * choosing; the claim decision is the labeler's first group, and Segmented rows work the same way. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Segmented } from '../src/components/ui'
import { nextIndex, onRadioKeys, radioTabIndex } from '../src/lib/roving'

describe('nextIndex', () => {
  it('wraps round the ends for a radio group and stops at them otherwise', () => {
    expect(nextIndex('ArrowRight', 2, 3, true)).toBe(0)
    expect(nextIndex('ArrowUp', 0, 3, true)).toBe(2)
    expect(nextIndex('ArrowDown', 2, 3, false)).toBe(2)
    expect(nextIndex('ArrowLeft', 0, 3, false)).toBe(0)
    expect(nextIndex('Home', 2, 3, true)).toBe(0)
    expect(nextIndex('End', 0, 3, false)).toBe(2)
    expect(nextIndex('a', 0, 3, true)).toBeNull()
  })
})

describe('radioTabIndex', () => {
  it('puts the Tab stop on the checked radio, or on the first while none is checked', () => {
    expect(radioTabIndex(true, 2, true)).toBe(0)
    expect(radioTabIndex(false, 0, true)).toBe(-1)
    expect(radioTabIndex(false, 0, false)).toBe(0)
    expect(radioTabIndex(false, 1, false)).toBe(-1)
  })
})

describe('onRadioKeys', () => {
  it('moves focus along the enabled radios without choosing one', () => {
    const chosen: string[] = []
    const bubble = vi.fn()
    render(
      <div onKeyDown={bubble}>
        <div role="radiogroup" aria-label="Level" onKeyDown={onRadioKeys}>
          {['One', 'Two', 'Three'].map((name) => (
            <button key={name} role="radio" aria-checked={false} disabled={name === 'Two'} onClick={() => chosen.push(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>,
    )
    const one = screen.getByRole('radio', { name: 'One' })
    one.focus()
    fireEvent.keyDown(one, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Three' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(one).toHaveFocus()
    expect(bubble).not.toHaveBeenCalled()
    for (const modifiers of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      fireEvent.keyDown(one, { key: 'ArrowRight', ...modifiers })
      expect(one).toHaveFocus()
    }
    fireEvent.keyDown(one, { key: 'x' })
    expect(bubble).toHaveBeenCalledTimes(5)
    expect(one).toHaveFocus()
    expect(chosen).toEqual([])
  })
})

describe('onRadioKeys inside a list that has arrow keys of its own', () => {
  it('keeps a key that moved between radios from reaching the list', () => {
    const listKeys = vi.fn()
    render(
      <div onKeyDown={(event) => listKeys(event.key)}>
        <div role="radiogroup" aria-label="Passage" onKeyDown={onRadioKeys}>
          <button role="radio" aria-checked={false}>Yes</button>
          <button role="radio" aria-checked={false}>No</button>
        </div>
      </div>,
    )
    const yes = screen.getByRole('radio', { name: 'Yes' })
    yes.focus()
    fireEvent.keyDown(yes, { key: 'ArrowDown' })
    expect(screen.getByRole('radio', { name: 'No' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'j' })
    expect(listKeys.mock.calls).toEqual([['j']])
  })
})

describe('Segmented', () => {
  it('is one Tab stop on the chosen option, and the arrow keys move without choosing', () => {
    const chosen: string[] = []
    render(
      <Segmented
        label="View"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        value="two"
        onChange={(value) => chosen.push(value)}
      />,
    )
    const one = screen.getByRole('button', { name: 'One' })
    const two = screen.getByRole('button', { name: 'Two' })
    expect(two).toHaveAttribute('tabindex', '0')
    expect(one).toHaveAttribute('tabindex', '-1')
    two.focus()
    fireEvent.keyDown(two, { key: 'ArrowLeft' })
    expect(one).toHaveFocus()
    expect(chosen).toEqual([])
  })

  it.each(['two', 'missing'] as const)('skips disabled options and enters on the first enabled option when value is %s', (value) => {
    render(<Segmented label="View" options={[
      { value: 'zero', label: 'Zero', disabled: true },
      { value: 'one', label: 'One' },
      { value: 'two', label: 'Two', disabled: true },
      { value: 'three', label: 'Three' },
    ]} value={value} onChange={vi.fn()} />)
    const one = screen.getByRole('button', { name: 'One' })
    expect(one.tabIndex).toBe(0)
    expect(screen.getByRole('button', { name: 'Two' }).tabIndex).toBe(-1)
    one.focus()
    fireEvent.keyDown(one, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Three' })).toHaveFocus()
  })

  it('disables an option that does not apply, and says why', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        label="View"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two', disabled: true, title: 'Nothing to show here' },
        ]}
        value="one"
        onChange={onChange}
      />,
    )
    const two = screen.getByRole('button', { name: 'Two' })
    expect(two).toBeDisabled()
    expect(two).toHaveAttribute('title', 'Nothing to show here')
    fireEvent.click(two)
    expect(onChange).not.toHaveBeenCalled()
  })
})
