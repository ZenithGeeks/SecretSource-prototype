import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ExportMenu } from '../src/roles/author/components/editor/ExportMenu'

describe('ExportMenu', () => {
  test('opens as a menu with the four exports and the open-issues warning', () => {
    const onExport = vi.fn()
    render(<ExportMenu openIssues={3} busy={null} onExport={onExport} />)
    const button = screen.getByRole('button', { name: /Export/ })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'Verification report (PDF)every citation, verdict and evidence',
      'Updated .bibnew and fixed entries merged',
      'Annotated .tex% SecretSource: comments on flagged \\cite',
      'Project .zipall .tex, .bib and figures',
    ])
    expect(screen.getByText('3 issues still open — the report will list them.')).toBeInTheDocument()
    expect(items[0]).toHaveFocus()

    fireEvent.click(items[1])
    expect(onExport).toHaveBeenCalledWith('bib')
  })

  test('arrow keys move, Escape closes and returns focus, outside click closes', async () => {
    render(<ExportMenu openIssues={0} busy={null} onExport={() => undefined} />)
    const button = screen.getByRole('button', { name: /Export/ })
    button.focus()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const items = await screen.findAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    expect(screen.queryByText(/still open/)).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    await waitFor(() => expect(items[1]).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    await waitFor(() => expect(items[3]).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    await waitFor(() => expect(items[0]).toHaveFocus())

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(button).toHaveFocus()

    fireEvent.click(button)
    await screen.findByRole('menu')
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  test('a handler that returns false keeps the menu open, and a busy item shows it', async () => {
    const onExport = vi.fn(() => false)
    const { rerender } = render(<ExportMenu openIssues={1} busy={null} onExport={onExport} />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getAllByRole('menuitem')[0])
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('report'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('1 issue still open — the report will list it.')).toBeInTheDocument()

    rerender(<ExportMenu openIssues={1} busy="report" onExport={onExport} />)
    expect(screen.getAllByRole('menuitem')[0]).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('menuitem')[1]).toBeDisabled()
  })
})
