/**
 * Researcher Home's "Analyze a paper" card: a reference input (DOI, arXiv ID, link) or a dropped
 * PDF, one primary Analyze button, and the deep-check switch. Same calls as the Analyses form
 * (api.startAnalysis / api.uploadAnalysis with the `verify` flag); once the run starts, Home opens it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, Loader2, Search } from 'lucide-react'
import { type RefObject, useRef, useState } from 'react'

import { Toggle } from '../../../components/settings'
import { Button } from '../../../components/ui'
import { api } from '../../../lib/api'
import { OFFLINE_REASON, useFeature } from '../../../lib/features'
import { cn } from '../../../lib/utils'

export function HomeAnalyzeCard({
  reference,
  onReferenceChange,
  inputRef,
  onStarted,
}: {
  reference: string
  onReferenceChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  onStarted: (id: string) => void
}) {
  const [verify, setVerify] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [notPdf, setNotPdf] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const online = useFeature('analyses')

  const start = useMutation({
    mutationFn: (input: string | File) =>
      typeof input === 'string' ? api.startAnalysis(input, verify) : api.uploadAnalysis(input, verify),
    onSuccess: ({ id }) => {
      onReferenceChange('')
      queryClient.invalidateQueries({ queryKey: ['analyses'] })
      onStarted(id)
    },
  })

  const pickPdf = (file: File | undefined) => {
    if (!file) return
    const isPdf = file.type === 'application/pdf'
    setNotPdf(!isPdf)
    if (isPdf && online) start.mutate(file)
  }

  return (
    <section
      aria-labelledby="home-analyze-title"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        pickPdf(event.dataTransfer.files?.[0])
      }}
      className={cn(
        'flex flex-col gap-3.5 rounded-2xl border bg-surface p-5 shadow-sm sm:p-6',
        dragging ? 'border-accent bg-accent-soft' : 'border-border-subtle',
      )}
    >
      <h2 id="home-analyze-title" className="type-title font-semibold text-ink">
        Analyze a paper
      </h2>
      <form
        // The field wraps its buttons onto a second line on a phone, and shows focus as a ring
        // because the input itself has no outline.
        className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border-subtle bg-surface py-1.5 pl-3.5 pr-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
        onSubmit={(event) => {
          event.preventDefault()
          if (reference.trim()) start.mutate(reference.trim())
        }}
      >
        <span className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            value={reference}
            onChange={(event) => onReferenceChange(event.target.value)}
            placeholder="Paste a DOI, arXiv ID or link, or drop a PDF here"
            aria-label="Paper to analyze"
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!online || start.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Upload PDF
          </button>
          <Button
            type="submit"
            className="rounded-[9px] px-3 py-[7px] text-[13px]"
            disabled={!reference.trim() || !online || start.isPending}
          >
            {start.isPending && <Loader2 className="size-4 animate-spin" />}
            Analyze
          </Button>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            pickPdf(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </form>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
        <Toggle on={verify} onChange={setVerify} aria-labelledby="home-deep-check" />
        <span id="home-deep-check" className="text-ink">
          Compare each claim with the full text of the cited work
        </span>
        <span className="text-ink-muted">· about 4 min</span>
      </div>
      {!online && (
        <p role="status" className="text-sm text-refutes">
          {OFFLINE_REASON.analyses}
        </p>
      )}
      {notPdf && (
        <p role="alert" className="text-sm text-refutes">
          Only PDF files can be analyzed. Paste a DOI, arXiv ID or link for anything else.
        </p>
      )}
      {start.isError && (
        <p role="alert" className="text-sm text-refutes">
          {(start.error as Error).message}
        </p>
      )}
    </section>
  )
}
