/**
 * A draft's figures as the preview's ImageMap (lib/latexPreview): path → a blob: URL the page
 * can load (SCRUM-463). The gateway serves each figure to the draft's owner only, so an
 * <img src> to it would go without the token; each one is fetched with it instead and handed
 * to the preview as a blob: URL, which the preview trusts because the app supplied it.
 *
 * A PDF figure cannot be an <img>: its first page is drawn to a PNG with pdf.js, loaded only
 * when a draft has one. An SVG is drawn to a PNG too (svgToPng says why). A figure that fails to load is left out, so the preview names it.
 * URLs are kept per name and content hash: a figure replaced under its name loads again, one
 * taken away is revoked, and the map keeps its identity while nothing changed, so the preview
 * does not render again for nothing.
 */

import { useEffect, useRef, useState } from 'react'

import { authorApi } from '../../lib/author'
import type { ImageMap } from '../../lib/latexPreview'
import type { DraftImage } from '../../types/draftCheck'

/** A PDF point is 1/72 in, a CSS pixel 1/96 in: the page keeps its printed size, so
 * \includegraphics[scale=0.5] halves it as LaTeX would. */
const PDF_SCALE = 96 / 72

/** The most pixels a drawn PDF page or SVG gets (16 MP, a 4096 px square). */
const MAX_PIXELS = 16 * 1024 * 1024

const EMPTY: ImageMap = new Map()

/** The first page of a PDF figure as a PNG. */
async function pdfFirstPage(blob: Blob): Promise<Blob> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  if (!GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    GlobalWorkerOptions.workerSrc = worker.default
  }
  const pdf = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  try {
    const page = await pdf.getPage(1)
    const size = page.getViewport({ scale: PDF_SCALE })
    // A poster-sized page would make a canvas of hundreds of MB: kept to MAX_PIXELS.
    const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (size.width * size.height)))
    const viewport = page.getViewport({ scale: PDF_SCALE * shrink })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    return await png(canvas)
  } finally {
    void pdf.destroy()
  }
}

function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('no PNG'))), 'image/png'))
}

/** An SVG figure drawn to a PNG. The SVG itself never gets a URL the page shows: a blob: URL
 * has the app's origin, and "Open image in new tab" on an SVG one would run its script there.
 * Drawn through an <img>, it runs no script and loads nothing. */
async function svgToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = img.naturalWidth || 300 // an SVG without a size: the default replaced-element size
    const height = img.naturalHeight || 150
    const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * shrink)
    canvas.height = Math.ceil(height * shrink)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await png(canvas) // throws on a canvas an SVG tainted (a <foreignObject>): left out
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function load(draftId: string, image: DraftImage, signal: AbortSignal): Promise<string> {
  const blob = await authorApi.imageBlob(draftId, image.name, signal)
  signal.throwIfAborted()
  const name = image.name.toLowerCase()
  const shown = name.endsWith('.pdf') ? await pdfFirstPage(blob) : name.endsWith('.svg') ? await svgToPng(blob) : blob
  return URL.createObjectURL(shown)
}

/** How many figures load (and convert) at once: each PDF or SVG drawn takes up to
 * MAX_PIXELS × 4 bytes of canvas, so a draft of many figures must not draw them all at once. */
const PARALLEL_LOADS = 3

// A cancelled effect cannot abort canvas work already in progress. Share slots across
// effect runs (including editor remounts) and release them only when the load settles.
const pendingLoads = new Set<() => Promise<void>>()
let activeLoads = 0

function drainLoads() {
  for (const run of pendingLoads) {
    if (activeLoads >= PARALLEL_LOADS) break
    pendingLoads.delete(run)
    activeLoads++
    void run().finally(() => {
      activeLoads--
      drainLoads()
    })
  }
}

/** The pauses before a failed figure is fetched again: a request that failed for a moment
 * (the gateway restarting, a dropped connection) still loads, and one that keeps failing
 * stops after three tries. The next change to the draft's figures tries it again. */
const RETRY_DELAYS_MS = [1000, 3000]

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (window.clearTimeout(timer), reject(signal.reason)), { once: true })
  })
}

async function loadWithRetries(draftId: string, image: DraftImage, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load(draftId, image, signal)
    } catch (error) {
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length) throw error
      await pause(RETRY_DELAYS_MS[attempt], signal)
    }
  }
}

export function useDraftImages(draftId: string, images: DraftImage[] | undefined): ImageMap {
  // Kept with the draft it belongs to: right after a switch, the last draft's map is not shown.
  const [state, setState] = useState<{ draftId: string; map: ImageMap }>({ draftId, map: EMPTY })
  const setMap = (map: ImageMap) => setState({ draftId, map })
  // name → the hash it was loaded at and its URL. A figure that failed is not here, so the next
  // run of the effect below tries it again.
  const loaded = useRef(new Map<string, { hash: string; url: string }>())
  // Stands for `images` in the effect below: a new array with the same figures is no change.
  const wanted = (images ?? []).map((i) => `${i.name}\u0000${i.hash}`).join('\u0001')

  useEffect(() => {
    const current = loaded.current
    const list = images ?? []
    const controller = new AbortController()
    const publish = () => setMap(new Map([...current].map(([name, entry]) => [name, entry.url] as const)))
    let changed = false
    for (const [name, entry] of current) {
      if (list.some((i) => i.name === name && i.hash === entry.hash)) continue
      URL.revokeObjectURL(entry.url)
      current.delete(name)
      changed = true
    }
    if (changed) publish()
    const jobs = list.filter((image) => !current.has(image.name)).map((image) => async () => {
      try {
        const url = await loadWithRetries(draftId, image, controller.signal)
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url)
          return
        }
        current.set(image.name, { hash: image.hash, url })
        publish()
      } catch {
        // Left out: the preview names it, and the next change to the figures tries again.
      }
    })
    for (const job of jobs) pendingLoads.add(job)
    drainLoads()
    return () => {
      controller.abort()
      for (const job of jobs) pendingLoads.delete(job)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, wanted])

  // Another draft, or the editor closing: every URL of this one goes.
  useEffect(() => {
    const current = loaded.current
    return () => {
      for (const entry of current.values()) URL.revokeObjectURL(entry.url)
      current.clear()
    }
  }, [draftId])

  return state.draftId === draftId ? state.map : EMPTY
}
