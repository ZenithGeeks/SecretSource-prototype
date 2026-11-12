import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TeacherDialog } from '../src/roles/teacher/components/TeacherDialog'

describe('TeacherDialog', () => {
  it('does not render dialog content when open is false', () => {
    render(
      <TeacherDialog open={false} title="Test Dialog" onClose={vi.fn()}>
        <p>Dialog Content</p>
      </TeacherDialog>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument()
  })

  it('renders title, description, and children when open is true', () => {
    render(
      <TeacherDialog
        open={true}
        title="Confirm Review"
        description="Are you sure you want to finalize this review?"
        onClose={vi.fn()}
      >
        <button type="button">Confirm</button>
      </TeacherDialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Confirm Review' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to finalize this review?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <TeacherDialog open={true} title="Dialog" onClose={onClose}>
        <p>Content</p>
      </TeacherDialog>,
    )

    const closeBtn = screen.getByRole('button', { name: 'Close dialog' })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(
      <TeacherDialog open={true} title="Dialog" onClose={onClose}>
        <p>Content</p>
      </TeacherDialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('handles focus trap with Tab and Shift+Tab', () => {
    render(
      <TeacherDialog open={true} title="Focus Test" onClose={vi.fn()}>
        <input aria-label="First input" type="text" />
        <button type="button">Action button</button>
      </TeacherDialog>,
    )

    const closeBtn = screen.getByRole('button', { name: 'Close dialog' })
    expect(screen.getByRole('textbox', { name: 'First input' })).toBeInTheDocument()
    const actionBtn = screen.getByRole('button', { name: 'Action button' })

    // On open, close button is focused
    expect(closeBtn).toHaveFocus()

    // Focus last element then press Tab -> should wrap to first element (close button)
    actionBtn.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(closeBtn).toHaveFocus()

    // Focus first element then press Shift+Tab -> should wrap to last element (action button)
    closeBtn.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(actionBtn).toHaveFocus()
  })
})
