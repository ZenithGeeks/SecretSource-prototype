export type NormalizedRect = { x0: number; y0: number; x1: number; y1: number }
export type NormalizedPoint = { x: number; y: number }

function rounded(value: number) {
  return Math.round(value * 100_000) / 100_000
}

/** Convert selected text rectangles into page-relative coordinates and clip to the page. */
export function normalizedRects(rects: Iterable<DOMRect>, pageRect: DOMRect): NormalizedRect[] {
  if (pageRect.width <= 0 || pageRect.height <= 0) return []
  const output: NormalizedRect[] = []
  for (const rect of rects) {
    const x0 = Math.max(0, Math.min(1, (rect.left - pageRect.left) / pageRect.width))
    const y0 = Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height))
    const x1 = Math.max(0, Math.min(1, (rect.right - pageRect.left) / pageRect.width))
    const y1 = Math.max(0, Math.min(1, (rect.bottom - pageRect.top) / pageRect.height))
    if (x1 <= x0 || y1 <= y0) continue
    output.push({ x0: rounded(x0), y0: rounded(y0), x1: rounded(x1), y1: rounded(y1) })
  }
  return output
}

/** Convert a pointer position to page-relative coordinates. */
export function normalizedPoint(clientX: number, clientY: number, pageRect: DOMRect): NormalizedPoint | null {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null
  return {
    x: rounded(Math.max(0, Math.min(1, (clientX - pageRect.left) / pageRect.width))),
    y: rounded(Math.max(0, Math.min(1, (clientY - pageRect.top) / pageRect.height))),
  }
}
