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
/** Old attributes that still load an image: <table background>, <img lowsrc>, <img dynsrc>. */
const LEGACY_LOADS = new Set(['background', 'lowsrc', 'dynsrc'])
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
/** CSS that can load something in a form CSS_URL cannot read: a backslash can spell any of it as
 * an escape, @import needs no url(), and image-set() takes a bare string. */
const CSS_REFUSED = /\\|@import|image-set/i

/** URL properties that start a request as soon as they are set, on an element not in any page
 * too: an <img> fetches its src while LaTeX.js is still building, before sanitizePreview runs. */
const LOADING_PROPERTIES: [string, string][] = [
  ['HTMLImageElement', 'src'],
  ['HTMLImageElement', 'srcset'],
  ['HTMLSourceElement', 'src'],
  ['HTMLSourceElement', 'srcset'],
  ['HTMLMediaElement', 'src'],
  ['HTMLVideoElement', 'poster'],
  ['HTMLTrackElement', 'src'],
  ['HTMLInputElement', 'src'],
  ['HTMLLinkElement', 'href'],
  ['HTMLScriptElement', 'src'],
  ['HTMLIFrameElement', 'src'],
  ['HTMLEmbedElement', 'src'],
  ['HTMLObjectElement', 'data'],
]
const LOADING_TAGS = new Set(['img', 'source', 'video', 'audio', 'track', 'input', 'link', 'script', 'iframe', 'embed', 'object', 'image', 'feimage', 'use'])
const LOADING_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'href', 'data'])

/** Whether `name` on `element` is a URL the browser would fetch. */
function isLoad(element: Element, name: string): boolean {
  return LOADING_TAGS.has(element.localName.toLowerCase()) && LOADING_ATTRIBUTES.has(name.toLowerCase().replace(/^.*:/, ''))
}

/** Whether a URL may be set on `element` as `name`, while the preview renders and in what it
 * shows: only an app-supplied image as an <img src>, or a #fragment within the document (an SVG
 * <use href="#glyph">). Any other load is refused, https too: a third-party draft must not make
 * a request the author never asked for when they open it. */
function mayLoad(element: Element, name: string, value: unknown, trustedImages: ReadonlySet<string>): boolean {
  if (!isLoad(element, name)) return true
  const url = String(value)
  if (url.startsWith('#') && name.toLowerCase().replace(/^.*:/, '') === 'href') return true
  return element.localName.toLowerCase() === 'img' && name.toLowerCase() === 'src' && trustedImages.has(url)
}

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

/** CSS that can load from a URL: any url() but a #fragment (an unclosed `url(` too, which CSS
 * still reads to the end of the input), or anything CSS_REFUSED names. */
function isUnsafeCss(css: string): boolean {
  if (CSS_REFUSED.test(css)) return true
  const fragments = [...css.matchAll(CSS_URL)].filter((match) => match[2].trim().startsWith('#')).length
  return (css.match(/url\(/gi)?.length ?? 0) !== fragments
}

function cleanAttributes(element: Element, trustedImages: ReadonlySet<string>): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on') || LEGACY_LOADS.has(name)) {
      element.removeAttributeNode(attribute)
    } else if (name === 'style') {
      if (isUnsafeCss(attribute.value)) element.removeAttributeNode(attribute)
    } else if (isLoad(element, name)) {
      if (!mayLoad(element, name, attribute.value, trustedImages)) element.removeAttributeNode(attribute)
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
 * Runs `render` with the setters LaTeX.js, KaTeX and svg.js use to put a URL on an element
 * refused unless mayLoad allows it: the URL properties above, setAttribute, setAttributeNS,
 * setAttributeNode(NS) and Attr's value. A refused URL is never set, so nothing is fetched even
 * before sanitizePreview sees the result. `render` must be synchronous (LaTeX.js's parse and
 * domFragment are): no other code runs while the guards are in, and `finally` takes them out.
 *
 * Not covered: markup parsed into the live document (innerHTML, insertAdjacentHTML,
 * createContextualFragment). Of the three libraries only svg.js does that, with markup it writes
 * itself, never draft text.
 *
 * LaTeX.js builds with the global `document` (createElement, createTextNode,
 * createDocumentFragment), and `window.document` cannot be replaced, so the page cannot be built
 * in an inert document instead.
 */
export function withoutUntrustedLoads<T>(trustedImages: ReadonlySet<string>, render: () => T): T {
  const restores: (() => void)[] = []
  const guard = (proto: object, property: string, wrap: (set: (this: unknown, value: unknown) => void) => (this: unknown, value: unknown) => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property)
    if (!descriptor?.set || !descriptor.configurable) return
    Object.defineProperty(proto, property, { ...descriptor, set: wrap(descriptor.set) })
    restores.push(() => Object.defineProperty(proto, property, descriptor))
  }
  const element = Element.prototype
  const methods = { setAttribute: element.setAttribute, setAttributeNS: element.setAttributeNS, setAttributeNode: element.setAttributeNode, setAttributeNodeNS: element.setAttributeNodeNS }
  try {
    for (const [type, property] of LOADING_PROPERTIES) {
      const proto = (globalThis as unknown as Record<string, { prototype?: object } | undefined>)[type]?.prototype
      if (!proto) continue
      guard(proto, property, (set) =>
        function (this: unknown, value: unknown) {
          if (mayLoad(this as Element, property, value, trustedImages)) set.call(this, value)
        },
      )
    }
    guard(Attr.prototype, 'value', (set) =>
      function (this: unknown, value: unknown) {
        const attr = this as Attr
        if (!attr.ownerElement || mayLoad(attr.ownerElement, attr.name, value, trustedImages)) set.call(this, value)
      },
    )
    restores.push(() => Object.assign(element, methods))
    element.setAttribute = function (this: Element, name: string, value: string) {
      if (mayLoad(this, name, value, trustedImages)) methods.setAttribute.call(this, name, value)
    }
    element.setAttributeNS = function (this: Element, ns: string | null, name: string, value: string) {
      if (mayLoad(this, name, value, trustedImages)) methods.setAttributeNS.call(this, ns, name, value)
    }
    element.setAttributeNode = function (this: Element, attr: Attr) {
      return mayLoad(this, attr.name, attr.value, trustedImages) ? methods.setAttributeNode.call(this, attr) : null
    }
    element.setAttributeNodeNS = function (this: Element, attr: Attr) {
      return mayLoad(this, attr.name, attr.value, trustedImages) ? methods.setAttributeNodeNS.call(this, attr) : null
    }
    return render()
  } finally {
    for (const restore of restores.reverse()) restore()
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
