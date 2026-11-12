import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  Breadcrumbs,
  InitialAvatar,
  LoadingState,
  MetricCard,
  PageHeading,
  StatusPill,
  StepProgress,
  WorkspaceTabs,
  type BreadcrumbItem,
  type StatusTone,
} from '../src/roles/teacher/components/TeacherUi'

describe('TeacherUi components', () => {
  it('renders StatusPill with each tone style', () => {
    const tones: StatusTone[] = ['accent', 'success', 'warning', 'danger', 'neutral']
    const { rerender } = render(<StatusPill label="Active" tone="accent" />)
    expect(screen.getByText('Active')).toHaveClass('bg-accent-soft', 'text-accent')

    for (const tone of tones) {
      rerender(<StatusPill label={`Tone-${tone}`} tone={tone} />)
      expect(screen.getByText(`Tone-${tone}`)).toBeInTheDocument()
    }
  })

  it('renders InitialAvatar with given initials and custom class', () => {
    render(<InitialAvatar initials="AS" className="custom-class" />)
    const avatar = screen.getByText('AS')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveClass('custom-class')
  })

  it('renders Breadcrumbs with click, link, and static items', () => {
    const onClick = vi.fn()
    const items: BreadcrumbItem[] = [
      { label: 'Classes', onClick },
      { label: 'English 101', href: '/classes/1' },
      { label: 'Assignment 1' },
    ]

    render(<Breadcrumbs items={items} />)

    const button = screen.getByRole('button', { name: 'Classes' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()

    const link = screen.getByRole('link', { name: 'English 101' })
    expect(link).toHaveAttribute('href', '/classes/1')

    const current = screen.getByText('Assignment 1')
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('renders StepProgress with complete, current, and future steps', () => {
    const steps = ['Connect', 'Choose class', 'Confirm']
    render(<StepProgress steps={steps} active={1} />)

    const list = screen.getByRole('list', { name: 'Progress' })
    expect(list).toBeInTheDocument()

    const currentStep = screen.getByText('Choose class')
    expect(currentStep).toHaveClass('font-semibold', 'text-ink')

    const stepItems = screen.getAllByRole('listitem')
    expect(stepItems).toHaveLength(3)

    const currentStepIndicator = screen.getByText('2')
    expect(currentStepIndicator).toHaveAttribute('aria-current', 'step')
  })

  it('renders WorkspaceTabs and calls onChange on click', () => {
    const onChange = vi.fn()
    const { rerender } = render(<WorkspaceTabs active="overview" onChange={onChange} />)

    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')

    const classworkTab = screen.getByRole('tab', { name: 'Classwork' })
    expect(classworkTab).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(classworkTab)
    expect(onChange).toHaveBeenCalledWith('classwork')

    rerender(<WorkspaceTabs active="people" onChange={onChange} />)
    const peopleTab = screen.getByRole('tab', { name: 'People' })
    expect(peopleTab).toHaveAttribute('aria-selected', 'true')
  })

  it('renders PageHeading with eyebrow, title, description, and actions', () => {
    render(
      <PageHeading
        eyebrow="Teacher Portal"
        title="Classroom Overview"
        description="Manage students and essays"
        actions={<button type="button">Sync</button>}
      />,
    )

    expect(screen.getByText('Teacher Portal')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Classroom Overview' })).toBeInTheDocument()
    expect(screen.getByText('Manage students and essays')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('renders MetricCard with labels, values, details, and tone styles', () => {
    const { rerender } = render(<MetricCard label="Pending" value={14} detail="Essays awaiting review" tone="danger" />)

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('14')).toHaveClass('text-refutes')
    expect(screen.getByText('Essays awaiting review')).toBeInTheDocument()

    rerender(<MetricCard label="Total" value="100%" tone="neutral" />)
    expect(screen.getByText('100%')).toHaveClass('text-ink')
  })

  it('renders LoadingState with default or custom label', () => {
    const { rerender } = render(<LoadingState />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()

    rerender(<LoadingState label="Fetching teacher profile..." />)
    expect(screen.getByText('Fetching teacher profile...')).toBeInTheDocument()
  })
})
