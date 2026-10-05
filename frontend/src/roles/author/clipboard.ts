/** Clipboard helpers the Library screens share (kept out of the component files so fast
 * refresh keeps working). */

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

/** What to say after a copy attempt. */
export function copiedMessage(ok: boolean, what: string): string {
  return ok ? `Copied ${what}` : 'Could not copy — the browser refused clipboard access'
}
