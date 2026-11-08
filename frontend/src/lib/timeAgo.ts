import { useEffect, useState } from 'react'

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function timeAgo(seconds: number) {
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** "Checked 2 min ago" from the last finished check (ISO); "Not checked yet" without one. */
export function checkedLabel(lastCheckedAt: string | null, now: number) {
  const at = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN
  return Number.isNaN(at) ? 'Not checked yet' : `Checked ${timeAgo(Math.max(0, (now - at) / 1000))}`
}

/** The time in ms, moving every `everyMs` while `live`, so an elapsed time or a "2 min ago"
 * keeps up; still while not live. */
export function useNow(everyMs: number, live = true) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs, live])
  return now
}
