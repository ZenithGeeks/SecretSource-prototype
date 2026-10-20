/** The app's toasts: shadcn/ui's Sonner wrapper (ui.shadcn.com/docs/components/sonner) on this
 * app's tokens, so light and dark follow the theme. Call `toast()` from `sonner` anywhere. */

import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      // Below the phone header (3.75rem) and the desktop toolbar (52px), not over their buttons.
      offset={{ top: '4.5rem', right: '1rem' }}
      mobileOffset={{ top: '4.5rem' }}
      icons={{
        success: <CircleCheck className="size-4 text-supports" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4 text-insufficient" />,
        error: <OctagonX className="size-4 text-refutes" />,
        loading: <Loader2 className="size-4 animate-spin" />,
      }}
      // Canvas on accent, not white: the dark theme's accent is light, and white on it is unreadable.
      toastOptions={{ classNames: { description: '!text-ink-muted', actionButton: '!bg-accent !text-canvas' } }}
      style={
        {
          '--normal-bg': 'var(--color-surface)',
          '--normal-text': 'var(--color-ink)',
          '--normal-border': 'var(--color-border-subtle)',
          '--border-radius': '0.75rem',
        } as CSSProperties
      }
      {...props}
    />
  )
}
