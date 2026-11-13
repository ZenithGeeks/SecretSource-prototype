/** Clipboard helpers the Library screens share (kept out of the component files so fast
 * refresh keeps working). */

import { toast } from 'sonner'

/** Copies to the clipboard and says whether it worked — never "Copied!" with nothing copied
 * (a denied permission, an unfocused document, or plain http on a LAN address). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Says how a copy attempt went: a success, or an error when the browser refused. */
export function toastCopied(ok: boolean, what: string): void {
  if (ok) toast.success(`Copied ${what}`)
  else toast.error('Could not copy — the browser refused clipboard access')
}
