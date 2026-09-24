/** Where "Fix in editor" / "+ New draft" / a warning row send the author: a draft, and
 * optionally the file and line to put the cursor on. Carried in the URL as
 * `?screen=editor&draft=…&file=…&line=…` so a refresh lands on the same spot. */
export type EditorTarget = {
  draftId: string
  file?: string
  line?: number
}
