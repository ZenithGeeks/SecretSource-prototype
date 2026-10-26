/** Tell an open tab when a newer build is deployed, so nobody keeps working on old code.
 * Vite names the entry script after its content hash, so a different name in a fresh
 * index.html means a new deploy. Started once from main.tsx, production builds only. */

import { toast } from 'sonner'

const CHECK_EVERY_MS = 5 * 60 * 1000
const ENTRY_SCRIPT = 'script[type="module"][src]'

/** Check every few minutes and when the tab is shown again; toast once when the build changed. */
export function watchForNewVersion() {
  const running = document.querySelector(ENTRY_SCRIPT)?.getAttribute('src')
  if (!running) return

  const timer = window.setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', onVisible)

  function onVisible() {
    if (document.visibilityState === 'visible') void check()
  }

  async function check() {
    let html: string
    try {
      html = await (await fetch(import.meta.env.BASE_URL, { cache: 'no-store' })).text()
    } catch {
      return // offline or mid-deploy: the next check tries again
    }
    // An error page has no entry script, so it never counts as a new version.
    const deployed = new DOMParser().parseFromString(html, 'text/html').querySelector(ENTRY_SCRIPT)?.getAttribute('src')
    if (!deployed || deployed === running) return

    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    toast('A new version of SecretSource is ready.', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => window.location.reload() },
    })
  }
}
