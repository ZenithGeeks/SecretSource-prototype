/** Start an analysis from a reference (path, DOI, arXiv ID, URL) or an uploaded PDF. */

import { useMutation } from '@tanstack/react-query'
import { FileUp, Loader2, Search } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../lib/api'
import { Button, Card, Input } from './ui'

export function SubmitForm({ onStarted }: { onStarted: (id: string) => void }) {
  const [reference, setReference] = useState('')
  const [verify, setVerify] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const start = useMutation({
    mutationFn: (input: string | File) =>
      typeof input === 'string'
        ? api.startAnalysis(input, verify)
        : api.uploadAnalysis(input, verify),
    onSuccess: ({ id }) => {
      setReference('')
      onStarted(id)
    },
  })

  return (
    <Card>
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          if (reference.trim()) start.mutate(reference.trim())
        }}
      >
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="DOI, arXiv ID, URL, or a PDF path"
          aria-label="Paper to analyze"
        />
        {/* Inside the role shell main is narrower than the prototype; the labels stay on one line. */}
        <div className="flex shrink-0 gap-2 whitespace-nowrap">
          <Button type="submit" disabled={!reference.trim() || start.isPending}>
            {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Analyze
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={start.isPending}
          >
            <FileUp className="size-4" />
            Upload PDF
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) start.mutate(file)
            event.target.value = ''
          }}
        />
      </form>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={verify}
          onChange={(event) => setVerify(event.target.checked)}
          className="accent-accent"
        />
        Verify each claim against the works it cites (slower)
      </label>

      {start.isError && (
        <p className="mt-3 text-sm text-refutes">{(start.error as Error).message}</p>
      )}
    </Card>
  )
}
