/**
 * A gateway file as a blob: URL that <img src>, <a href> and react-pdf can use.
 *
 * The gateway serves a paper only to the user whose analyses it belongs to, and a plain src or
 * href cannot send the Authorization header. So the file is fetched with the token first, and
 * the page points at the copy in memory (#135). The copy is released when the component goes.
 */

import { useEffect, useState } from 'react'

import { fetchFile } from './api'

type Loaded = { from: string; url: string } | { from: string; failed: true }

export function useAuthorizedUrl(url: string | undefined): { url?: string; failed: boolean } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    let objectUrl = ''
    fetchFile(url)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ from: url, url: objectUrl })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ from: url, failed: true })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  // An answer for an earlier url is not an answer for this one.
  if (!url || loaded?.from !== url) return { failed: false }
  return 'failed' in loaded ? { failed: true } : { url: loaded.url, failed: false }
}
