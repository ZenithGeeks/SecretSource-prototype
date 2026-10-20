/**
 * Browser notifications for work that finished while this tab was in the background, behind
 * the Settings toggle "When a paper finishes". A visible tab already shows the change on screen.
 */

import { getSettings } from './settings'

/** Browsers only offer notifications on https and localhost, not on a plain-http LAN address. */
export function canNotify(): boolean {
  return typeof Notification !== 'undefined' && window.isSecureContext
}

/** Whether the browser was asked and said no; the toggle then shows off and says how to allow it. */
export function noticesBlocked(): boolean {
  return canNotify() && Notification.permission === 'denied'
}

/** Ask for permission when the toggle is turned on. Returns whether notices can show now. */
export async function askNoticePermission(): Promise<boolean> {
  if (!canNotify() || Notification.permission === 'denied') return false
  if (Notification.permission === 'granted') return true
  return (await Notification.requestPermission()) === 'granted'
}

/** Show one notice if the setting is on, permission is granted and the tab is hidden.
 *
 * Args:
 *   title: The notice's first line.
 *   body: The paper's title or what went wrong.
 *   tag: The analysis id, so a second notice about the same paper replaces the first.
 *   onOpen: Runs when the notice is clicked, after the tab is focused.
 */
export function showDoneNotice(title: string, body: string, tag: string, onOpen?: () => void): void {
  if (!getSettings().notifyDone || !canNotify() || Notification.permission !== 'granted' || !document.hidden) return
  let notice: Notification
  try {
    notice = new Notification(title, { body, tag })
  } catch (error) {
    // Chrome on Android has no `new Notification` (only a service worker can show one) and
    // throws TypeError. The in-app notice still shows; the caller's loop must go on.
    if (error instanceof TypeError) return
    throw error
  }
  notice.onclick = () => {
    window.focus()
    onOpen?.()
    notice.close()
  }
}
