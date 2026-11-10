/**
 * The small pieces of Ask: the toolbar button's note, the field's menu, the welcome card for a
 * graph node, and the command result cards that the other Ask tests leave out.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AskButton } from '../src/components/AskButton'
import { AskInput } from '../src/components/AskInput'
import { AskWelcome } from '../src/components/AskWelcome'
import { CommandResult } from '../src/components/CommandResult'
import type { CommandView } from '../src/lib/askCommands'

beforeEach(() => window.localStorage.removeItem('ask.introSeen'))

describe('the Ask button', () => {
  const about = { kind: 'library' as const, label: 'your library' }

  it('keeps its note when some other key is pressed, and drops it on Escape', () => {
    render(<AskButton role="researcher" open={false} about={about} onToggle={() => {}} />)

    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByRole('note', { name: 'About Ask AI' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(window.localStorage.getItem('ask.introSeen')).toBe('1')
  })
})

describe('the Ask field menu', () => {
  const papers = [
    { id: 'a1', label: 'ColBERTv2' },
    { id: 'a2', label: 'ColPali' },
  ]

  function Field({ first }: { first: string }) {
    const [draft, setDraft] = useState(first)
    return <AskInput draft={draft} onChange={setDraft} papers={papers} disabled={false} placeholder="Ask" />
  }
  const input = () => screen.getByRole('textbox', { name: 'Your question' }) as HTMLInputElement

  it('ignores keys when no menu is open', () => {
    render(<Field first="plain words" />)

    expect(fireEvent.keyDown(input(), { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(input(), { key: 'Enter' })).toBe(true)
  })

  it('wraps upwards from the first paper to the last, and ignores other keys', () => {
    render(<Field first="/find_in_paper @Col" />)
    const options = () => screen.getAllByRole('option')

    expect(options()).toHaveLength(2)
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(fireEvent.keyDown(input(), { key: 'x' })).toBe(true)
    expect(screen.getByRole('listbox', { name: 'Papers' })).toBeInTheDocument()
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('puts a paper in the line with Enter, or with the mouse', () => {
    const { unmount } = render(<Field first="/find_in_paper @Col" />)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('/find_in_paper @ColPali ')
    unmount()

    render(<Field first="/get_analysis @col" />)
    fireEvent.mouseDown(screen.getByRole('option', { name: '@ColBERTv2' }))
    expect(input().value).toBe('/get_analysis @ColBERTv2 ')
  })
})

describe('the welcome card', () => {
  it('suggests questions about a graph node by its name', () => {
    const onAsk = vi.fn()
    render(<AskWelcome role="researcher" about={{ kind: 'node', label: 'Batch norm' }} canNarrow onAsk={onAsk} />)

    expect(screen.getByRole('heading', { name: 'Ask about Batch norm' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Where do my papers disagree about Batch norm?' }))
    expect(onAsk).toHaveBeenCalledWith('Where do my papers disagree about Batch norm?')
    expect(screen.queryByText(/Open a paper or select a graph node first/)).not.toBeInTheDocument()
  })
})

describe('command result cards', () => {
  const show = (view: CommandView) => render(<CommandResult view={view} command="/x" />)

  it('says when text is not in the paper', () => {
    show({ kind: 'page', page: null })

    expect(screen.getByText('That text is not in this paper.')).toBeInTheDocument()
  })

  it('says every claim is saved when none is left to label', () => {
    show({ kind: 'progress', saved: 4, claims: 4, reviewed: 3, next: null })

    expect(screen.getByText('Every claim is saved.')).toBeInTheDocument()
    expect(screen.queryByText('Next to label')).not.toBeInTheDocument()
  })

  it('says how far an analysis got when it is not done, with its message when it has one', () => {
    const claims = [{ number: 1, claim: 'C', standing: 'backed' as const }]
    const { unmount } = show({ kind: 'claims', title: 'Paper', status: 'error', message: 'GROBID timed out', claims })
    expect(screen.getByText('Analysis error: GROBID timed out')).toBeInTheDocument()
    unmount()

    const running = show({ kind: 'claims', title: 'Paper', status: 'running', claims })
    expect(screen.getByText('Analysis running')).toBeInTheDocument()
    running.unmount()

    show({ kind: 'claims', title: 'Paper', status: 'done', claims })
    expect(screen.queryByText(/^Analysis/)).not.toBeInTheDocument()
  })

  it('copies BibTeX, and says it did', async () => {
    show({ kind: 'code', text: '@article{a}' })

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy' })))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('@article{a}')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
