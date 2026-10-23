/**
 * A search box in the style of shadcn/ui's input, built on this app's tokens: a visible label,
 * a search icon, a clear button once there is text, and a spinner while a search runs. Enter
 * submits the form it sits in.
 */

import { Loader2, Search, X } from 'lucide-react'
import { useId } from 'react'

import { cn } from '../lib/utils'
import { IconButton } from './ui'

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  busy = false,
  maxLength,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  busy?: boolean
  maxLength?: number
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink">
        {label}
      </label>
      <div className="group relative flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-ink-muted" aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(
            'min-h-11 w-full rounded-xl border border-border-subtle bg-canvas py-2 pr-10 pl-9 text-sm text-ink transition-colors',
            'placeholder:text-ink-muted hover:border-ink-muted/40 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent/30',
            // The browser's own clear button would sit next to ours.
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
        <span className="absolute right-1.5 flex items-center">
          {busy ? (
            <Loader2 className="m-2 size-4 animate-spin text-ink-muted" aria-label="Searching" />
          ) : (
            value && (
              <IconButton onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`} className="size-8">
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            )
          )}
        </span>
      </div>
    </div>
  )
}
