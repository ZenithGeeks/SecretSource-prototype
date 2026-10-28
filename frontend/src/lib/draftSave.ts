/**
 * What the Author editor (roles/author/screens/Editor.tsx) needs for saving that is not React:
 * the autosave pause, the copy of unsaved text kept on this device, and a draft's \title read
 * as a name.
 */

/** How long typing must pause before the file is written (the autosave). */
export const AUTOSAVE_DELAY_MS = 2_000

/** The longest title the gateway takes (MAX_TITLE in app/author/router.py). */
export const MAX_TITLE = 120

/** The default titles a new draft gets ("Untitled draft", "Untitled draft 2", …). */
export const DEFAULT_TITLE = /^Untitled draft( \d+)?$/

/** Text the gateway does not hold, kept on this device by draft id when a write is refused or
 * the tab closes with edits pending, so reopening the draft can offer it back. */
export type Backup = { at: string; files: Record<string, string> }

export const backupKey = (draftId: string) => `ss.author.unsaved.${draftId}`

export function readBackup(draftId: string): Backup | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(backupKey(draftId)) ?? 'null') as Backup | null
    return parsed && typeof parsed.files === 'object' && parsed.files !== null ? parsed : null
  } catch {
    return null
  }
}

export function writeBackup(draftId: string, files: Record<string, string>): void {
  if (Object.keys(files).length === 0) return
  try {
    window.localStorage.setItem(backupKey(draftId), JSON.stringify({ at: new Date().toISOString(), files } satisfies Backup))
  } catch {
    // Private browsing or a full storage refuses it; the leave-page warning still stands.
  }
}

export function dropBackup(draftId: string): void {
  try {
    window.localStorage.removeItem(backupKey(draftId))
  } catch {
    // nothing kept, nothing to drop
  }
}

/** A file's \title{…} as plain words: commands, braces and line breaks gone, at most
 * MAX_TITLE characters; "" when it has none. */
export function texTitle(content: string): string {
  const m = content.match(/\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/)
  if (!m) return ''
  return m[1]
    .replace(/\\(?:thanks|footnote)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE)
}
