/** The annotation guideline in a dialog, loaded only when a labeler opens it. The text is
 * src/roles/labeler/annotation-guideline.md: the labeler sections of docs/annotation-guideline.md,
 * cut by labelerGuide() and checked by a test. The production image is built from frontend/ alone. */

import { X } from 'lucide-react'
import { Fragment, useId } from 'react'

import { DialogPanel, Modal } from '../../../components/library'
import { IconButton } from '../../../components/ui'
import { parseGuide, parseInline, type Block } from '../../../lib/guideMarkdown'
import guide from '../annotation-guideline.md?raw'

const BLOCKS = parseGuide(guide)

export default function LabelingGuide({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const headings = BLOCKS.filter((block) => block.kind === 'heading')
  return (
    <Modal titleId={titleId} onClose={onClose}>
      <DialogPanel className="flex max-h-[80vh] w-full max-w-3xl flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <h2 id={titleId} className="type-title text-ink">
            Labeling guide
          </h2>
          <IconButton onClick={onClose} aria-label="Close" className="size-8">
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pt-3 text-sm leading-6 text-ink-muted">
          <nav aria-label="Sections">
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {headings.map((heading) => (
                <li key={heading.id}>
                  {/* Buttons, not #links: the hash belongs to the app's routing. */}
                  <button
                    type="button"
                    onClick={() => document.getElementById(heading.id)?.scrollIntoView()}
                    className="text-accent hover:underline"
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {BLOCKS.map((block, index) => (
            <GuideBlock key={index} block={block} />
          ))}
        </div>
      </DialogPanel>
    </Modal>
  )
}

function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return (
        <h3 id={block.id} className="mt-2 font-serif text-lg font-semibold text-ink">
          {block.text}
        </h3>
      )
    case 'paragraph':
      return <p>{inline(block.text)}</p>
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      return (
        <List className={block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
          {block.items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </List>
      )
    }
    case 'table':
      return (
        // Its own scroll box would let the column above squash it to nothing, so it may not shrink.
        <div className="shrink-0 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} className="border-b border-border-subtle py-1 pr-3 align-top font-semibold text-ink">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} className="border-b border-border-subtle py-1 pr-3 align-top">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function inline(text: string) {
  return parseInline(text).map((part, index) => {
    if (part.kind === 'strong') return <strong key={index} className="font-semibold text-ink">{part.text}</strong>
    if (part.kind === 'em') return <em key={index}>{part.text}</em>
    if (part.kind === 'code') return <code key={index} className="font-mono text-xs">{part.text}</code>
    return <Fragment key={index}>{part.text}</Fragment>
  })
}
