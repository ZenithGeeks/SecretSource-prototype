/**
 * "Images" at the end of the file bar (SCRUM-463): the draft's figures, each with a remove
 * button, and "Upload images…". The preview draws a figure where \includegraphics names it,
 * matched by path, then by file name, then without the extension (lib/latexPreview findImage),
 * so a figure uploaded under its own file name is found from "figures/posv" too.
 *
 * A disclosure, not a menu: the panel holds buttons and a file input. Escape or a click outside
 * closes it and focus goes back to the button.
 */

import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { cn } from '../../../../lib/utils'
import type { DraftImage } from '../../../../types/draftCheck'
import { HIGHLIGHT } from '../../hover'

/** What the gateway keeps (backend/app/author/images.py). */
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.svg,.pdf'

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImagesMenu({
  images,
  busy,
  onUpload,
  onRemove,
}: {
  images: DraftImage[]
  /** An upload or a removal is under way. */
  busy: boolean
  onUpload: (files: File[]) => void
  onRemove: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn('flex items-center gap-1 px-3.5 py-2 text-xs text-accent', HIGHLIGHT, open && 'bg-accent-soft')}
      >
        <ImageIcon className="size-3.5" aria-hidden="true" />
        Images{images.length ? ` · ${images.length}` : ''}
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="region"
          aria-label="Draft images"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            close()
          }}
          className="absolute right-0 top-full z-30 mt-px flex w-[300px] flex-col rounded-lg border border-border-subtle bg-surface py-1.5 shadow-xl"
        >
          {images.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">No images yet. The preview shows a figure once its file is here.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {images.map((image) => (
                <li key={image.name} className="flex items-center gap-2 px-3 py-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={image.name}>
                    {image.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-muted">{size(image.size)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove(image.name)}
                    aria-label={`Remove ${image.name}`}
                    title={`Remove ${image.name}`}
                    className={cn('shrink-0 rounded p-1 text-ink-muted hover:text-refutes disabled:opacity-60', HIGHLIGHT)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 border-t border-border-subtle px-3 pt-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className={cn('flex items-center gap-1.5 rounded py-1 text-xs font-medium text-accent disabled:opacity-60', HIGHLIGHT)}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
              Upload images…
            </button>
            <p className="pb-1 text-[11px] text-ink-muted">PNG, JPG, SVG or PDF, up to 5 MB each.</p>
            <input
              ref={input}
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              aria-label="Upload images"
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                if (files.length) onUpload(files)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
