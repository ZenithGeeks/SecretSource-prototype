/**
 * The Ask panel's text field. `/` at the start lists the commands (lib/askCommands) and `@` lists
 * the reader's papers; arrow keys move, Enter or Tab picks, Escape closes. With no menu open, Enter
 * sends as usual (the form around it submits).
 */

import { useState } from 'react'

import { matchCommands, matchPapers, withMention, type PaperRef } from '../lib/askCommands'
import { cn } from '../lib/utils'

type Option = { key: string; name: string; detail: string; pick: () => void }

export function AskInput({
  draft,
  onChange,
  papers,
  disabled,
  placeholder,
  label = 'Your question',
  className = 'w-full bg-transparent py-2 text-[13px] text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed',
  menuClassName = 'absolute bottom-full left-[-0.75rem] z-20 mb-3 w-[calc(100%+1.25rem)]',
  autoFocus = false,
}: {
  draft: string
  onChange: (draft: string) => void
  papers: PaperRef[]
  disabled: boolean
  placeholder: string
  /** The field's accessible name. */
  label?: string
  /** The field's own look; the panel's bare field by default. */
  className?: string
  /** Where the menu sits. */
  menuClassName?: string
  autoFocus?: boolean
}) {
  const [active, setActive] = useState(0)
  // The reader pressed Escape on this draft; typing again brings the menu back.
  const [dismissed, setDismissed] = useState<string | null>(null)

  const options: Option[] = [
    ...matchCommands(draft).map((command) => ({
      key: command.name,
      name: `/${command.name}`,
      detail: command.summary,
      // A command that takes a paper goes straight to the paper list.
      pick: () => onChange(`/${command.name} ${command.paper ? '@' : ''}`),
    })),
    ...matchPapers(draft, papers).map((paper) => ({
      key: paper.id,
      name: `@${paper.label}`,
      detail: '',
      pick: () => onChange(withMention(draft, paper)),
    })),
  ]
  const open = options.length > 0 && dismissed !== draft && !disabled
  const current = Math.min(active, options.length - 1)

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : options.length - 1
      setActive((current + step) % options.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      options[current].pick()
      setActive(0)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(draft)
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={draft}
        onChange={(event) => {
          onChange(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={open ? 'ask-suggestions' : undefined}
        aria-activedescendant={open ? `ask-option-${current}` : undefined}
        placeholder={placeholder}
        className={className}
      />
      {open && (
        <ul
          id="ask-suggestions"
          role="listbox"
          aria-label={draft.startsWith('/') && !draft.includes(' ') ? 'Commands' : 'Papers'}
          className={cn('flex max-h-64 flex-col overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1 shadow-lg', menuClassName)}
        >
          {options.map((option, index) => (
            <li
              key={option.key}
              id={`ask-option-${index}`}
              role="option"
              aria-selected={index === current}
              // mousedown, not click: the field keeps focus, so the menu does not close first.
              onMouseDown={(event) => {
                event.preventDefault()
                option.pick()
              }}
              className={cn('flex cursor-pointer flex-col rounded-lg px-2.5 py-1.5 text-[13px]', index === current && 'bg-accent-soft')}
            >
              <span className="truncate font-medium text-ink">{option.name}</span>
              {option.detail && <span className="truncate text-xs text-ink-muted">{option.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
