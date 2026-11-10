/**
 * Rendering a draft must not ask the browser for an outside image, not even for a moment
 * (SCRUM-471). An <img> starts its request when its src is set, while LaTeX.js is still
 * building the page and before sanitizePreview sees it, so these tests watch every URL set on an
 * element that loads one during renderLatex, not only what is left in the final DOM.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { forgetUnknowns, preparePreview, renderLatex, type ImageMap } from '../src/lib/latexPreview'
import { withoutUntrustedLoads } from '../src/lib/previewSanitize'

/** Elements that fetch a URL set on them, and the attributes that name it. */
const LOADING_TAGS = new Set(['img', 'source', 'link', 'image', 'video', 'audio', 'input', 'script', 'iframe', 'embed', 'object', 'track'])
const URL_NAMES = new Set(['src', 'srcset', 'href', 'data', 'poster'])

type Seen = { tag: string; name: string; value: string }

/** Records every URL set on a loading element, by property or by attribute, until restored. */
function watchUrls(): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = []
  const restores: (() => void)[] = []
  const record = (element: Element, name: string, value: unknown) => {
    const tag = element.localName.toLowerCase()
    const local = name.toLowerCase().replace(/^.*:/, '')
    if (LOADING_TAGS.has(tag) && URL_NAMES.has(local)) seen.push({ tag, name: local, value: String(value) })
  }
  const watchProperty = (proto: object, name: string) => {
    const original = Object.getOwnPropertyDescriptor(proto, name)
    if (!original?.set) return
    Object.defineProperty(proto, name, {
      ...original,
      set(this: Element, value: unknown) {
        record(this, name, value)
        original.set!.call(this, value)
      },
    })
    restores.push(() => Object.defineProperty(proto, name, original))
  }
  watchProperty(HTMLImageElement.prototype, 'src')
  watchProperty(HTMLImageElement.prototype, 'srcset')
  watchProperty(HTMLSourceElement.prototype, 'src')
  watchProperty(HTMLSourceElement.prototype, 'srcset')
  watchProperty(HTMLMediaElement.prototype, 'src')
  watchProperty(HTMLLinkElement.prototype, 'href')
  const { setAttribute, setAttributeNS } = Element.prototype
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    record(this, name, value)
    setAttribute.call(this, name, value)
  }
  Element.prototype.setAttributeNS = function (this: Element, ns: string | null, name: string, value: string) {
    record(this, name, value)
    setAttributeNS.call(this, ns, name, value)
  }
  restores.push(() => {
    Element.prototype.setAttribute = setAttribute
    Element.prototype.setAttributeNS = setAttributeNS
  })
  return { seen, restore: () => restores.reverse().forEach((r) => r()) }
}

const doc = (body: string) => `\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n${body}\n\\end{document}\n`
const OUTSIDE_HOST = 'evil.example'
const FIG_URL = 'blob:http://localhost:3000/5d3c1f0e-uploaded'
const IMAGES: ImageMap = new Map([['figures/fig.png', FIG_URL]])
const fetchedOutside = (seen: Seen[]) => seen.filter((s) => s.value.toLowerCase().includes(OUTSIDE_HOST))

describe('no outside URL is set on an element that loads one, even during the render', () => {
  let watch: ReturnType<typeof watchUrls>
  beforeEach(() => {
    forgetUnknowns()
    watch = watchUrls()
  })
  afterEach(() => watch.restore())

  const render = async (body: string, images?: ImageMap) => (await renderLatex(preparePreview(doc(body)).source, { images })).root

  test.each([
    ['two optional arguments', `\\includegraphics[a][b]{https://${OUTSIDE_HOST}/p.png}`],
    ['two optional arguments with keys', `\\includegraphics[width=1cm][height=1cm]{https://${OUTSIDE_HOST}/p.png}`],
    ['three optional arguments', `\\includegraphics[a][b][c]{https://${OUTSIDE_HOST}/p.png}`],
    ['the starred form', `\\includegraphics*{https://${OUTSIDE_HOST}/p.png}`],
    ['the starred form with two optional arguments', `\\includegraphics*[a][b]{https://${OUTSIDE_HOST}/p.png}`],
    ['spaces and newlines between the parts', `\\includegraphics \n [a] \n\t[b]\n {https://${OUTSIDE_HOST}/p.png}`],
    ['a comment between the parts', `\\includegraphics[a]% a note\n[b]% another\n{https://${OUTSIDE_HOST}/p.png}`],
    ['a comment inside an optional argument', `\\includegraphics[width=1cm,% a note\n height=1cm][b]{https://${OUTSIDE_HOST}/p.png}`],
    ['a brace group inside an option', `\\includegraphics[trim={0 0 0 0},clip][b]{https://${OUTSIDE_HOST}/p.png}`],
    ['an uppercase scheme', `\\includegraphics[a][b]{HTTPS://${OUTSIDE_HOST.toUpperCase()}/P.PNG}`],
    ['a scheme-relative URL', `\\includegraphics[a][b]{//${OUTSIDE_HOST}/p.png}`],
    ['an entity-encoded scheme', `\\includegraphics[a][b]{\\&\\#104;ttps://${OUTSIDE_HOST}/p.png}`],
    ['\\includegraphics inside \\href', `\\href{https://ok.example/}{\\includegraphics[a][b]{https://${OUTSIDE_HOST}/p.png}}`],
  ])('%s: the named box, no request', async (_name, body) => {
    const root = await render(body, IMAGES)
    expect(fetchedOutside(watch.seen)).toEqual([])
    expect(watch.seen).toEqual([])
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.ss-graphic')?.textContent?.toLowerCase()).toContain(`image not uploaded: `)
    expect(root.querySelector('.ss-graphic')?.textContent?.toLowerCase()).toContain(OUTSIDE_HOST)
  })

  test.each([
    ['\\includesvg', `\\includesvg[width=1cm]{https://${OUTSIDE_HOST}/p.svg}`],
    ['\\pgfimage', `\\pgfimage[width=1cm][b]{https://${OUTSIDE_HOST}/p.png}`],
    ['\\epsfig', `\\epsfig{file=https://${OUTSIDE_HOST}/p.eps,width=1cm}`],
    ['\\psfig', `\\psfig{figure=https://${OUTSIDE_HOST}/p.eps}`],
    ['\\epsfig with figure=', `\\epsfig{figure=https://${OUTSIDE_HOST}/p.eps,width=1cm}`],
    ['\\psfig with file=', `\\psfig{file={https://${OUTSIDE_HOST}/p.eps}}`],
    ['an overpic environment, its \\put labels left out', `\\begin{overpic}[width=1cm]{https://${OUTSIDE_HOST}/p.png}\n\\put(10,20){A}\n\\end{overpic}`],
    ['\\epsfbox', `\\epsfbox[0 0 1 1]{https://${OUTSIDE_HOST}/p.eps}`],
    ['\\includepdf', `\\includepdf[pages=1]{https://${OUTSIDE_HOST}/p.pdf}`],
    ['\\includestandalone', `\\includestandalone[width=1cm]{https://${OUTSIDE_HOST}/p}`],
  ])('%s is the named box too', async (_name, body) => {
    const root = await render(body)
    expect(fetchedOutside(watch.seen)).toEqual([])
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.ss-graphic')?.textContent).toMatch(new RegExp(`^Image not uploaded: https://${OUTSIDE_HOST}/p(\\.\\w+)?$`))
  })

  test('an image the app supplied still loads, with two optional arguments', async () => {
    const root = await render('\\includegraphics[a][b]{figures/fig.png}', IMAGES)
    expect(watch.seen).toEqual([{ tag: 'img', name: 'src', value: FIG_URL }])
    expect(root.querySelector('img')?.getAttribute('src')).toBe(FIG_URL)
  })

  test('\\epsfig{figure=…} finds the draft\'s own image', async () => {
    const root = await render('\\epsfig{figure=figures/fig.png,width=1cm}', IMAGES)
    expect(root.querySelector('img')?.getAttribute('src')).toBe(FIG_URL)
  })

  test('a commented-out overpic is left alone', async () => {
    const root = await render(`% \\begin{overpic}{https://${OUTSIDE_HOST}/p.png}\nafter`)
    expect(root.querySelector('.ss-graphic')).toBeNull()
    expect(root.textContent).toContain('after')
  })

  test('a file the draft does not have is the named box, and nothing is fetched', async () => {
    const root = await render('\\includegraphics[a][b]{figures/missing.png}', IMAGES)
    expect(watch.seen).toEqual([])
    expect(root.querySelector('.ss-graphic')?.textContent).toBe('Image not uploaded: figures/missing.png')
  })

  // Without preparePreview nothing rewrites \includegraphics, so these reach LaTeX.js's graphicx:
  // what the render itself does when the rewrite misses a form.
  test.each([
    ['an outside URL', `\\includegraphics[a][b]{https://${OUTSIDE_HOST}/p.png}`, 'Image not uploaded: https://evil.example/p.png'],
    ['a file the draft does not have', '\\includegraphics[a][b]{figures/missing.png}', 'Image not uploaded: figures/missing.png'],
  ])('graphicx reached directly with %s draws the named box and sets no URL', async (_name, body, box) => {
    const { root } = await renderLatex(doc(body), { images: IMAGES })
    expect(watch.seen).toEqual([])
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.ss-graphic')?.textContent).toBe(box)
  })

  test('graphicx reached directly still draws an image the app supplied', async () => {
    const { root } = await renderLatex(doc('\\includegraphics[a][b]{figures/fig.png}'), { images: IMAGES })
    expect(watch.seen).toEqual([{ tag: 'img', name: 'src', value: FIG_URL }])
    expect(root.querySelector('img')?.getAttribute('src')).toBe(FIG_URL)
  })
})

describe('withoutUntrustedLoads', () => {
  let watch: ReturnType<typeof watchUrls>
  beforeEach(() => (watch = watchUrls()))
  afterEach(() => watch.restore())
  const OUT = `https://${OUTSIDE_HOST}/p.png`
  const XLINK = 'http://www.w3.org/1999/xlink'
  const SVG = 'http://www.w3.org/2000/svg'

  test('refuses every way of setting an outside URL on a loading element while it runs', () => {
    const made = withoutUntrustedLoads(new Set([FIG_URL]), () => {
      const img = document.createElement('img')
      img.src = OUT
      img.srcset = `${OUT} 1x`
      img.setAttribute('SRC', OUT)
      img.setAttributeNS(null, 'srcset', OUT)
      const attr = document.createAttribute('src')
      attr.value = OUT
      img.setAttributeNode(attr)
      const source = document.createElement('source')
      source.srcset = OUT
      const link = document.createElement('link')
      link.href = OUT
      const video = document.createElement('video')
      video.src = OUT
      video.setAttribute('poster', OUT)
      const image = document.createElementNS(SVG, 'image')
      image.setAttributeNS(XLINK, 'xlink:href', OUT)
      image.setAttribute('href', OUT)
      const trusted = document.createElement('img')
      trusted.src = FIG_URL
      const anchor = document.createElement('a')
      anchor.setAttribute('href', 'https://ok.example/')
      return { img, trusted, anchor }
    })
    expect(fetchedOutside(watch.seen)).toEqual([])
    expect(made.img.getAttributeNames()).toEqual([])
    expect(made.trusted.getAttribute('src')).toBe(FIG_URL)
    expect(made.anchor.getAttribute('href')).toBe('https://ok.example/')
  })

  test('puts the setters back afterwards, also when the render throws', () => {
    expect(() =>
      withoutUntrustedLoads(new Set(), () => {
        throw new Error('parse failed')
      }),
    ).toThrow('parse failed')
    const img = document.createElement('img')
    img.src = OUT
    img.setAttribute('srcset', OUT)
    expect(fetchedOutside(watch.seen).map((s) => s.name)).toEqual(['src', 'srcset'])
  })
})
