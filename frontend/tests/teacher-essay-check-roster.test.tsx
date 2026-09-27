import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { EssayCheckRoster } from '../src/roles/teacher/components/EssayCheckRoster'

describe('Essay Check student navigation', () => {
  it('lists the assignment students one by one without a delete action', async () => {
    const onSelect = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><EssayCheckRoster courseId="class-literary-2b" assignmentId="assignment-essay" selectedStudentId="student-anan" onSelect={onSelect} /></QueryClientProvider>)

    const student = await screen.findByRole('button', { name: /Anan P\./ })
    expect(student).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Bee S\./ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bee S\./ }))
    expect(onSelect).toHaveBeenCalledWith('student-bee')
  })
})
