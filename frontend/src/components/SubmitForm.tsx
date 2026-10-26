/**
 * Start an analysis from a reference (path, DOI, arXiv ID, URL) or an uploaded PDF
 * (Figma "New analysis"): one dashed drop zone holding the input, the PDF line and the
 * "Compare full text" switch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, Loader2, Search } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../lib/api'
import { OFFLINE_REASON, useFeature } from '../lib/features'
import { cn } from '../lib/utils'

export function SubmitForm({ onStarted }: { onStarted: (id: string) => void }) {
  const [reference, setReference] = useState('')
  const [verify, setVerify] = useState(true)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const online = useFeature('analyses')

  const start = useMutation({
    mutationFn: (input: string | File) =>
      typeof input === 'string'
        ? api.startAnalysis(input, verify)
        : api.uploadAnalysis(input, verify),
    onSuccess: ({ id }) => {
      setReference('')
      // The history list should show the run from the moment it starts, not when it ends.
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
      onStarted(id)
    },
  })

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file && online && !start.isPending) start.mutate(file)
      }}
      className={cn(
        'flex flex-col items-center gap-3.5 rounded-[18px] border-[1.5px] border-dashed bg-surface p-6 transition-colors',
        dragging ? 'border-accent bg-accent-soft' : 'border-border-subtle',
      )}
    >
      <form
        className="flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface py-1.5 pr-1.5 pl-3.5 shadow-[0_1px_1px_rgba(31,20,36,0.04)]"
        onSubmit={(event) => {
          event.preventDefault()
          if (reference.trim()) start.mutate(reference.trim())
        }}
      >
        <Search className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Paste a DOI, arXiv ID or link"
          aria-label="Paper to analyze"
          className="min-w-0 flex-1 bg-transparent py-1 text-[15px] placeholder:text-ink-muted focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!reference.trim() || !online || start.isPending}
          className="inline-flex items-center gap-2 rounded-[9px] bg-accent px-3 py-[7px] text-[13px] font-medium whitespace-nowrap text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {start.isPending && <Loader2 className="size-4 animate-spin" />}
          Analyze
        </button>
      </form>

      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={!online || start.isPending}
        className="inline-flex items-center gap-1.5 rounded text-[13px] text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <FileUp className="size-4" aria-hidden="true" />
        or drop a PDF here · up to 40 MB
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        aria-label="PDF to analyze"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) start.mutate(file)
          event.target.value = ''
        }}
      />

      {/* The deep check: each claim is compared with the full text of the cited work. */}
      <div className="flex w-full items-center gap-2.5 rounded-xl bg-neutral-soft px-3.5 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={verify}
          aria-labelledby="compare-full-text"
          onClick={() => setVerify(!verify)}
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            verify ? 'bg-accent' : 'bg-border-subtle',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]',
              verify ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          <p id="compare-full-text" className="text-[13px] leading-[18px] font-medium">
            Compare full text
          </p>
          <p className="text-xs leading-4 text-ink-muted">
            Compare each claim with the full text of the cited work. Slower, about 4 minutes.
          </p>
        </div>
      </div>

      {!online && (
        <p role="status" className="w-full text-sm text-refutes">
          {OFFLINE_REASON.analyses}
        </p>
      )}
      {start.isError && (
        <p role="alert" className="w-full text-sm text-refutes">
          {(start.error as Error).message}
        </p>
      )}
    </div>
  )
}
