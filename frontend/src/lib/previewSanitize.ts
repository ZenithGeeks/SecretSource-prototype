/**
 * Cleans the HTML LaTeX.js built before the preview shows it. The preview is a shadow root in the
 * app's own page, not a sandboxed frame, and a draft can be third-party text, so anything in it
 * that can run or load from an unsafe scheme would do so in the app's origin (SCRUM-471).
 *
 * URLs are checked against an allowlist, so a scheme nobody thought of is refused too.
 */

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'poster', 'data'])
/** Elements that run or load something whatever their attributes say. `animate` and `set` can
 * rewrite an SVG link's href after this check has passed it. */
const REMOVED_ELEMENTS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form', 'animate', 'set'])
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
/** CSS that can load something in a form CSS_URL cannot read: a backslash can spell any of it as
 * an escape, @import needs no url(), and image-set() takes a bare string. */
const CSS_REFUSED = /\\|@import|image-set/i

/** Without C0 and C1 control characters and DEL. Browsers drop tabs and newlines from a URL
 * before reading its scheme, so they must not hide one here. */
function withoutControls(text: string): string {
  return [...text].filter((c) => {
    const code = c.charCodeAt(0)
    return code > 0x1f && (code < 0x7f || code > 0x9f)
  }).join('')
}

/** A URL as a browser reads it: trimmed, no control characters, and its scheme in lower case
 * with no whitespace. A #fragment has no scheme: `#Sec:One` must keep matching its target. */
function normalized(url: string): string {
  const clean = withoutControls(url).trim()
  const colon = clean.indexOf(':')
  if (colon === -1 || clean.startsWith('#')) return clean
  return clean.slice(0, colon).replace(/\s/g, '').toLowerCase() + clean.slice(colon)
}

/** The text with its HTML entities decoded. Parsed in an inert document, which loads and runs nothing. */
function decodedEntities(text: string): string {
  if (!text.includes('&')) return text
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? ''
}

function isSafe(url: string): boolean {
  if (url.startsWith('#')) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url)?.[1]
  return scheme !== undefined && SAFE_SCHEMES.has(scheme)
}

/** The URL to keep, or null when it or its entity-decoded form is not allowed. The decoded form
 * is not what is written back: decoding would change a query like `?a=1&copy=2`. */
export function safeUrl(url: string): string | null {
  const clean = normalized(url)
  return isSafe(clean) && isSafe(normalized(decodedEntities(url))) ? clean : null
}

function isSafeSrcset(srcset: string): boolean {
  return srcset.split(',').every((candidate) => safeUrl(candidate.trim().split(/\s+/)[0]) !== null)
}

/** CSS with a url() outside the allowlist, or anything else that can load from a URL. */
function isUnsafeCss(css: string): boolean {
  if (CSS_REFUSED.test(css)) return true
  return [...css.matchAll(CSS_URL)].some((match) => safeUrl(match[2]) === null)
}

function cleanAttributes(element: Element, trustedImages: ReadonlySet<string>): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on')) {
      element.removeAttributeNode(attribute)
    } else if (name === 'style') {
      if (isUnsafeCss(attribute.value)) element.removeAttributeNode(attribute)
    } else if (name === 'src' && element.localName === 'img') {
      // Only an image the app supplied: any other, https too, would be a request the author never
      // asked for, made when they open a third-party draft.
      if (!trustedImages.has(attribute.value)) element.removeAttributeNode(attribute)
    } else if (name === 'srcset') {
      if (element.localName === 'img' || !isSafeSrcset(attribute.value)) element.removeAttributeNode(attribute)
    } else if (URL_ATTRIBUTES.has(name) || URL_ATTRIBUTES.has(attribute.localName.toLowerCase())) {
      const url = safeUrl(attribute.value)
      if (url === null) element.removeAttributeNode(attribute)
      else attribute.value = url
    }
  }
}

const linkOf = (element: Element) => element.getAttribute('href') ?? element.getAttribute('xlink:href')

/** A link that lost its URL becomes its own text. One that kept it opens outside the app, unless
 * it is a fragment within the document. */
function finishLink(link: Element, hadUrl: boolean): void {
  const url = linkOf(link)
  if (url === null) {
    if (hadUrl) link.replaceWith(...link.childNodes)
  } else if (url.startsWith('#')) {
    link.removeAttribute('target')
    link.removeAttribute('rel')
  } else {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
}

/**
 * Cleans every element under `root`, in place.
 *
 * @param trustedImages the image URLs the app itself supplied (latexPreview's ImageMap, blob: URLs
 *   of uploaded images). An `<img src>` is kept only when it equals one exactly.
 */
export function sanitizePreview(root: Element, trustedImages: ReadonlySet<string> = new Set()): void {
  for (const element of [...root.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase()
    if (REMOVED_ELEMENTS.has(tag) || (tag === 'style' && isUnsafeCss(element.textContent ?? ''))) {
      element.remove()
      continue
    }
    const hadUrl = linkOf(element) !== null
    cleanAttributes(element, trustedImages)
    if (tag === 'a') finishLink(element, hadUrl)
  }
}
