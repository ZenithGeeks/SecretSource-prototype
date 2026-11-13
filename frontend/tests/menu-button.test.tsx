/** MenuButton's keys, through ProjectMenu (the menu button pattern from useMenuKeys). */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ProjectMenu } from '../src/components/library'

describe('MenuButton', () => {
  test('focus enters the menu, arrows wrap, Home/End jump, Escape and a pick return focus', () => {
    const onRename = vi.fn()
    render(<ProjectMenu label="Actions for Thesis" onRename={onRename} onDelete={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Actions for Thesis' })

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    const rename = screen.getByRole('menuitem', { name: 'Rename' })
    const remove = screen.getByRole('menuitem', { name: 'Delete project' })
    expect(rename).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(rename).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(rename).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(remove).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })
})
