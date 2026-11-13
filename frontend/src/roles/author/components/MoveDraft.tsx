/**
 * Moving drafts between projects (#721), with the gateway's own move: PATCH /drafts/{id} with
 * the project's id, or "" for Unsorted. Two ways in:
 *  - "+ New project" can take existing drafts along (ExistingDraftsPicker in the dialog), moved
 *    in once the project exists;
 *  - "Move to…" on a draft's row in Unsorted or a project lists the other projects, Unsorted,
 *    and "New project…", then asks to confirm.
 * Either way a draft that cites keys only its old project's .bib defines is warned about first
 * (MoveWarning): after the move those keys are missing, as when a project is deleted. A .bib
 * that cannot be read blocks the move until a retry reads it, rather than passing as "none". Lists,
 * counts, Recent projects and the projects' .bib use refresh after a move (useAuthorActions
 * updateDraft invalidates them). Nothing is sent twice: the dialog and the confirm are disabled
 * while a move is on its way.
 */

import { useQueries } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { FolderInput } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button, IconButton, MenuItem, TextButton } from '../../../components/ui'
import { askTarget } from '../../../lib/askCursor'
import { authorApi, errorMessage } from '../../../lib/author'
import { keysLostByMove } from '../../../lib/latexProject'
import { AUTHOR_KEYS, useAuthorActions, useAuthorDrafts, useAuthorProjects } from '../../../lib/useAuthor'
import type { Draft } from '../../../types/draftCheck'
import { NewProjectDialog } from './ProjectActions'

type Actions = ReturnType<typeof useAuthorActions>

/** Moves the drafts, all at once; resolves to the ones that could not be moved, with why. */
async function moveDrafts(actions: Actions, drafts: Pick<Draft, 'id' | 'title'>[], to: string | null): Promise<string[]> {
  // "" is the gateway's Unsorted; null would leave the draft where it is.
  const results = await Promise.allSettled(drafts.map((d) => actions.updateDraft(d.id, { projectId: to ?? '' })))
  return results.flatMap((r, i) => (r.status === 'rejected' ? [`${drafts[i].title} (${errorMessage(r.reason)})`] : []))
}

/** The drafts among `drafts` that would lose keys by moving to `to` (a project's id; null for
 * Unsorted or a project that does not exist yet), each with those keys and where they were. */
function useLostKeys(drafts: Draft[], to: string | null): LostKeysCheck {
  const ids = [...new Set([...drafts.map((d) => d.projectId).filter((id): id is string => Boolean(id)), ...(to ? [to] : [])])]
  const projects = useQueries({
    queries: ids.map((id) => ({ queryKey: AUTHOR_KEYS.project(id), queryFn: () => authorApi.getProject(id) })),
  })
  const projectOf = (id: string | null) => (id ? projects[ids.indexOf(id)]?.data : undefined)
  // Until both .bib files are in, the answer would be "nothing lost" whatever the truth is.
  // A retry counts as checking again, not as failed.
  const pending = projects.some((q) => q.isPending || (q.isError && q.isFetching))
  // A .bib that could not be read would say "nothing lost" too: the move waits for a retry.
  const failed = !pending && projects.some((q) => q.isError)
  const retry = () => {
    for (const q of projects) if (q.isError) void q.refetch()
  }
  const lost = drafts.flatMap((d) => {
    const from = d.projectId !== to ? projectOf(d.projectId) : undefined
    const keys = keysLostByMove(d.files, from?.bib, projectOf(to)?.bib)
    // Keys are only lost from a project that has a .bib.
    return from?.bib && keys.length > 0 ? [{ draft: d, project: from.name, bib: from.bib.name, keys }] : []
  })
  return { lost, pending, failed, retry }
}

/** A draft, the keys it would lose, and the project and .bib that define them. */
type Lost = { draft: Draft; project: string; bib: string; keys: string[] }
type LostKeysCheck = { lost: Lost[]; pending: boolean; failed: boolean; retry: () => void }

/** Says which cited keys a move leaves behind in the old project's .bib; nothing when none.
 * When the .bib files could not be read it says so, with Retry, instead of saying nothing. */
function MoveWarning({ check: { lost, pending, failed, retry } }: { check: LostKeysCheck }) {
  if (pending) return <p className="mt-3 text-xs text-ink-muted">Checking which \cite keys the move leaves behind…</p>
  if (failed) {
    return (
      <p role="alert" className="mt-3 text-xs text-refutes">
        Couldn’t check which \cite keys the move leaves behind.{' '}
        <TextButton onClick={retry} className="text-xs">
          Retry
        </TextButton>
      </p>
    )
  }
  if (lost.length === 0) return null
  return (
    <div role="status" className="mt-3 rounded-lg border border-insufficient bg-insufficient-soft px-3 py-2 text-xs text-insufficient">
      {lost.map(({ draft, project, bib, keys }) => (
        <p key={draft.id}>
          {draft.title} cites {keys.map((k) => `\\cite{${k}}`).join(', ')}, defined only in {project}’s {bib}.
        </p>
      ))}
      <p className="mt-1">After the move these keys show as missing until their entries are in the new project’s .bib or the draft’s own.</p>
    </div>
  )
}

/** "Add existing drafts": every draft, Unsorted first, then each project's under its name. */
function ExistingDraftsPicker({
  selected,
  onChange,
  check,
  disabled,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  check: LostKeysCheck
  disabled?: boolean
}) {
  const drafts = useAuthorDrafts().data ?? []
  const projects = useAuthorProjects().data ?? []
  if (drafts.length === 0) return null
  const groups = [
    { id: 'unsorted', name: 'Unsorted', drafts: drafts.filter((d) => !d.projectId) },
    ...projects.map((p) => ({ id: p.id, name: p.name, drafts: drafts.filter((d) => d.projectId === p.id) })),
  ].filter((g) => g.drafts.length > 0)
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  return (
    // min-w-0: a fieldset is as wide as its longest line otherwise, and a long title would widen the dialog.
    <fieldset className="mt-4 min-w-0" disabled={disabled}>
      <legend className="text-[13px] font-medium text-ink">Add existing drafts (optional)</legend>
      <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border-subtle px-3 py-1">
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.name} className="py-1">
            <p className="truncate text-[11px] font-medium tracking-wide text-ink-muted uppercase">{group.name}</p>
            {group.drafts.map((draft) => (
              <label key={draft.id} className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-ink">
                <input type="checkbox" checked={selected.includes(draft.id)} onChange={() => toggle(draft.id)} className="accent-accent" />
                <span className="truncate">{draft.title}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <MoveWarning check={check} />
    </fieldset>
  )
}

/**
 * NewProjectDialog with "Add existing drafts": creates the project, then moves the chosen drafts
 * into it. `initial` is ticked from the start ("New project…" in a draft's Move to…).
 */
export function NewProjectWithDrafts({
  initial = [],
  onCancel,
  onCreated,
  onImport,
}: {
  /** The draft "New project…" was chosen on, which may not be in the drafts list yet. */
  initial?: Draft[]
  onCancel: () => void
  /** The project exists; a toast has said how the moves went. */
  onCreated: (projectId: string) => void
  onImport?: () => void
}) {
  const actions = useAuthorActions()
  const drafts = useAuthorDrafts().data ?? []
  const [selected, setSelected] = useState(initial.map((d) => d.id))
  const [busy, setBusy] = useState(false)
  // Each ticked draft as the list has it, or as it was handed in.
  const chosen = selected.flatMap((id) => drafts.find((d) => d.id === id) ?? initial.find((d) => d.id === id) ?? [])
  const check = useLostKeys(chosen, null)
  return (
    <NewProjectDialog
      onCancel={onCancel}
      onImport={onImport}
      onCreate={async (name) => {
        if (check.pending) return 'Still checking the chosen drafts’ .bib files. Try again in a moment.'
        if (check.failed) return 'Couldn’t check the chosen drafts’ .bib files. Retry the check, or untick those drafts.'
        setBusy(true)
        try {
          const project = await actions.createProject(name ? { name } : {})
          const failed = await moveDrafts(actions, chosen, project.id)
          const moved = chosen.length - failed.length
          if (failed.length) toast.warning(`${project.name} created; could not move ${failed.join(', ')}`)
          else toast.success(moved ? `${project.name} created with ${moved} draft${moved === 1 ? '' : 's'}` : `${project.name} created`)
          onCreated(project.id)
          return null
        } catch (error) {
          return errorMessage(error)
        } finally {
          setBusy(false)
        }
      }}
    >
      <ExistingDraftsPicker selected={selected} onChange={setSelected} check={check} disabled={busy} />
    </NewProjectDialog>
  )
}

/** "Move to…" on a draft's row: the other projects, Unsorted when it is in one, and "New
 * project…". Picking one asks to confirm, with what the move costs. */
export function MoveDraftMenu({ draft, onCreated }: { draft: Draft; onCreated?: (projectId: string) => void }) {
  const actions = useAuthorActions()
  const projects = (useAuthorProjects().data ?? []).filter((p) => p.id !== draft.projectId)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<{ id: string | null; name: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [creating, setCreating] = useState(false)
  const check = useLostKeys(target ? [draft] : [], target?.id ?? null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open && !target) return
    const close = () => {
      if (moving) return
      setOpen(false)
      setTarget(null)
    }
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open, target, moving])

  const pick = (id: string | null, name: string) => {
    setOpen(false)
    setTarget({ id, name })
  }
  // Set at once, not on the next render as `moving` is: a double click sends one move.
  const inFlight = useRef(false)
  const move = async () => {
    if (!target || inFlight.current) return
    inFlight.current = true
    setMoving(true)
    const failed = await moveDrafts(actions, [draft], target.id)
    inFlight.current = false
    setMoving(false)
    setTarget(null)
    if (failed.length) toast.error(`Could not move ${failed[0]}`)
    else toast.success(`${draft.title} moved to ${target.name}`)
  }

  let panel: ReactNode = null
  if (target) {
    panel = (
      <div role="dialog" aria-label={`Move ${draft.title}`} className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-border-subtle bg-surface p-3 text-[13px] shadow-card">
        <p className="text-ink">
          Move “{draft.title}” to {target.name}?
        </p>
        <MoveWarning check={check} />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="px-3 py-1.5 text-[13px]" onClick={() => setTarget(null)} disabled={moving}>
            Cancel
          </Button>
          <Button type="button" className="px-3 py-1.5 text-[13px]" onClick={() => void move()} disabled={moving || check.pending || check.failed} aria-busy={moving} autoFocus>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </div>
    )
  } else if (open) {
    panel = (
      <div role="menu" aria-label={`Move ${draft.title} to`} className="absolute right-0 z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1 shadow-card">
        {projects.map((p) => (
          <MenuItem key={p.id} role="menuitem" className="px-3 font-normal" onClick={() => pick(p.id, p.name)}>
            <span className="truncate">{p.name}</span>
          </MenuItem>
        ))}
        {draft.projectId && (
          <MenuItem role="menuitem" className="px-3 font-normal" onClick={() => pick(null, 'Unsorted')}>
            Unsorted
          </MenuItem>
        )}
        <MenuItem
          role="menuitem"
          className="px-3 text-accent"
          onClick={() => {
            setOpen(false)
            setCreating(true)
          }}
        >
          New project…
        </MenuItem>
      </div>
    )
  }

  return (
    <div ref={root} className="relative">
      <IconButton
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${draft.title} to…`}
        title="Move to…"
        disabled={moving}
        data-ask-target={askTarget({ kind: 'action', id: `move-draft-${draft.id}` })}
        className="size-7 lg:size-7"
      >
        <FolderInput className="size-4" aria-hidden="true" />
      </IconButton>
      {panel}
      <AnimatePresence>
        {creating && (
          <NewProjectWithDrafts
            initial={[draft]}
            onCancel={() => setCreating(false)}
            onCreated={(projectId) => {
              setCreating(false)
              onCreated?.(projectId)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
