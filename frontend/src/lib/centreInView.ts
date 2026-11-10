/**
 * Scrolls `element` to the middle of the viewport, whether it is out of view or already partly
 * in it (`block: 'nearest'` leaves a partly visible one where it is). One taller than the room
 * under the sticky header goes to the top instead, so its start is not cut off. The element's
 * own scroll-margin keeps it clear of that header. Smooth, unless the person asked for reduced
 * motion. Near the end of the page the browser scrolls as far as the page goes.
 */
export function centreInView(element: HTMLElement | null) {
  if (!element?.scrollIntoView) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
  const fits = element.getBoundingClientRect().height <= window.innerHeight - margin
  element.scrollIntoView({ block: fits ? 'center' : 'start', behavior: reduce ? 'auto' : 'smooth' })
}
