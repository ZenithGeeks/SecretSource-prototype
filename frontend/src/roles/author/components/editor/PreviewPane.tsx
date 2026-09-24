/** The right half of the split: the preview bar ("Live preview · rendered with LaTeX.js",
 * the verdict-colours toggle) over the rendered page. The rendering itself lands in the next
 * PR; until then the pane says so instead of showing nothing. */

import { Empty } from '../../../../components/ui'

export function PreviewPane({ verdictColors, onToggleVerdictColors }: { verdictColors: boolean; onToggleVerdictColors: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-canvas px-3.5 py-2 text-xs">
        <span className="text-[12.5px] font-medium text-ink">Live preview</span>
        <span className="hidden text-ink-muted sm:inline">rendered with LaTeX.js · updates as you type</span>
        <button
          type="button"
          onClick={onToggleVerdictColors}
          aria-pressed={verdictColors}
          className="ml-auto rounded text-accent hover:underline"
        >
          verdict colors {verdictColors ? 'on' : 'off'}
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty title="Preview arrives in the next PR" hint="This pane will render the open file with LaTeX.js as you type." />
      </div>
    </div>
  )
}
