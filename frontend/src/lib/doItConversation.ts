/**
 * The Do it transcript carried into the role a switch just opened. It lives outside React so it
 * survives the old role unmounting, including React's strict-mode remount, until the person
 * leaves by the role menu or signs out.
 */

export type DoItLine = { kind: string; text?: string; name?: string; task?: string; state?: string }

/** `resume` is set by a role switch: the new role's agent goes on with the request unasked. */
export type DoItConversation = { lines: DoItLine[]; sessionId: string | null; resume?: boolean }

let carried: DoItConversation | null = null

export function peekDoItConversation(): DoItConversation | null {
  return carried
}

export function leaveDoItConversation(next: DoItConversation) {
  carried = next
}

export function clearDoItConversation() {
  carried = null
}
