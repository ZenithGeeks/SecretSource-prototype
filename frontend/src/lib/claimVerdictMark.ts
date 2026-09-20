/** ProseMirror mark carrying a claim's verdict (and, best-effort, its claimId — see the
 * warning on guessClaimId in draftToProseMirror.ts) across edits. Read-only in Phase 0;
 * `data-claim-id` is exposed on the rendered <mark> so a future "click a highlight to jump
 * to its issue" interaction is a wiring problem, not a data-model one. */

import { Mark, mergeAttributes } from '@tiptap/core'

import { cn } from './utils'
import type { VerdictKind } from './writer'

const MARK_STYLES: Record<VerdictKind, string> = {
  supports: 'bg-supports-soft border-supports',
  refutes: 'bg-refutes-soft border-refutes',
  insufficient: 'bg-insufficient-soft border-insufficient',
}

export const ClaimVerdict = Mark.create({
  name: 'claimVerdict',

  addAttributes() {
    return {
      verdict: {
        default: 'supports' as VerdictKind,
        parseHTML: (el) => el.getAttribute('data-verdict'),
        renderHTML: (attrs) => ({ 'data-verdict': attrs.verdict }),
      },
      claimId: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-claim-id'),
        renderHTML: (attrs) => (attrs.claimId ? { 'data-claim-id': attrs.claimId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-verdict]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const verdict = mark.attrs.verdict as VerdictKind
    return [
      'mark',
      mergeAttributes(HTMLAttributes, { class: cn('rounded-none border-b-2 px-0.5 text-ink', MARK_STYLES[verdict]) }),
      0,
    ]
  },
})
