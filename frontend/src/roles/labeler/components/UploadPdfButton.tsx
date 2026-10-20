/** "Upload the PDF": picks one PDF from this computer for a paper the analysis cannot download.
 * A button that opens the file picker, so it looks and works like the buttons beside it. */

import { Loader2, Upload } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '../../../components/ui'
import { cn } from '../../../lib/utils'

export function UploadPdfButton({
  title,
  busy,
  disabled = false,
  onFile,
  className,
}: {
  /** The paper's title, for the button's accessible name. */
  title: string
  /** This paper's PDF is being uploaded. */
  busy: boolean
  /** Another action on the same paper, or another upload, is running. */
  disabled?: boolean
  onFile: (file: File) => void
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const label = busy ? 'Uploading' : 'Upload the PDF'
  return (
    // Relative, so the visually hidden input is placed here and does not scroll the page.
    <span className="relative z-10 inline-flex shrink-0">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so picking the same file again after a failed upload still fires onChange.
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      <Button
        variant="ghost"
        className={cn('min-h-11 px-3', className)}
        // The visible words first, so a voice command that says them finds the button.
        aria-label={`${label} of ${title}`}
        disabled={busy || disabled}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        {busy ? `${label}…` : label}
      </Button>
    </span>
  )
}
