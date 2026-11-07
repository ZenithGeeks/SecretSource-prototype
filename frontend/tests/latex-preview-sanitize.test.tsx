/**
 * What LaTeX.js builds is cleaned before the preview shows it (SCRUM-471): only http, https,
 * mailto and #fragment links stay links, handlers and active elements go, and the text stays.
 * The last block renders with the real library.
 */

import { beforeEach, describe, expect, test } from 'vitest'

import { forgetUnknowns, preparePreview, renderIsolated, renderLatex } from '../src/lib/latexPreview'
import { safeUrl, sanitizePreview } from '../src/lib/previewSanitize'

const TAB = String.fromCharCode(9)
const NEWLINE = String.fromCharCode(10)
const NUL = String.fromCharCode(0)
// Assembled so no script URL sits in the file as one string.
const SCRIPT = ['java', 'script:'].join('')
const REFUSED = [
  `${SCRIPT}void(0)`,
  `JaVaScRiPt:void(0)`,
  `java${TAB}script:void(0)`,
  `java${NEWLINE}script:void(0)`,
  `java script:void(0)`,
  `${NUL}${SCRIPT}void(0)`,
  `  ${SCRIPT}void(0)`,
  `&#106;avascript:void(0)`,
  `&#x6A;avascript:void(0)`,
  `javascript&colon;void(0)`,
  `&amp;#106;avascript:void(0)`,
  `data:text/html,hello`,
  `vbscript:void(0)`,
  `file:///etc/hosts`,
  `blob:https://example.com/1`,
  `//example.com/page`,
  `page.html`,
  ``,
]

function cleaned(html: string, trusted?: ReadonlySet<string>): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  sanitizePreview(root, trusted)
  return root
}

describe('safeUrl', () => {
  test.each(REFUSED)('refuses %j', (url) => {
    expect(safeUrl(url)).toBeNull()
  })

  test.each([
    ['http://example.com/', 'http://example.com/'],
    ['https://example.com/a?b=1&copy=2', 'https://example.com/a?b=1&copy=2'],
    ['HTTPS://Example.com/Path', 'https://Example.com/Path'],
    [`ht${TAB}tps://example.com/`, 'https://example.com/'],
    ['  mailto:someone@example.com ', 'mailto:someone@example.com'],
    ['#ref-khattab2020', '#ref-khattab2020'],
    ['#Sec:One', '#Sec:One'],
    ['#my sec:One', '#my sec:One'],
  ])('keeps %j as %j', (url, kept) => {
    expect(safeUrl(url)).toBe(kept)
  })
})

describe('sanitizePreview', () => {
  test.each(REFUSED.filter((url) => url !== ''))('a link to %j becomes its own text', (url) => {
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.textContent = 'read this'
    const root = document.createElement('div')
    root.append('see ', link, '.')
    sanitizePreview(root)
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toBe('see read this.')
  })

  test('a link keeps its formatting when it becomes text', () => {
    const root = cleaned(`<a href="vbscript:void(0)"><b>bold</b> text</a>`)
    expect(root.innerHTML).toBe('<b>bold</b> text')
  })

  test.each(['http://example.com/', 'https://example.com/', 'mailto:someone@example.com'])('%s is an outside link', (url) => {
    const link = cleaned(`<a href="${url}" target="_self" rel="opener">x</a>`).querySelector('a')!
    expect(link.getAttribute('href')).toBe(url)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  test('a #fragment stays in the document', () => {
    const link = cleaned(`<a href="#sec-1" target="_blank" rel="noreferrer">x</a>`).querySelector('a')!
    expect(link.getAttribute('href')).toBe('#sec-1')
    expect(link.hasAttribute('target')).toBe(false)
    expect(link.hasAttribute('rel')).toBe(false)
  })

  test('an anchor that never had a URL is left alone', () => {
    expect(cleaned('<a id="sec-1">x</a>').innerHTML).toBe('<a id="sec-1">x</a>')
  })

  test('every on* attribute goes, on any element, in any case', () => {
    const root = cleaned(`<p onclick="x()" ONMOUSEOVER="x()" onfoo="x()" class="kept" data-on="kept">x</p><svg onload="x()"></svg>`)
    expect(root.querySelector('p')!.getAttributeNames().sort()).toEqual(['class', 'data-on'])
    expect(root.querySelector('svg')!.getAttributeNames()).toEqual([])
  })

  test.each([
    ['src', 'video'],
    ['poster', 'video'],
    ['src', 'audio'],
    ['src', 'source'],
    ['srcset', 'source'],
    ['src', 'input'],
    ['src', 'track'],
  ])('any %s on <%s> goes, https too: it would load on open', (attribute, tag) => {
    for (const url of [`${SCRIPT}void(0)`, 'https://example.com/x']) {
      const element = document.createElement(tag)
      element.setAttribute(attribute, url)
      const root = document.createElement('div')
      root.append(element)
      sanitizePreview(root)
      expect(element.hasAttribute(attribute)).toBe(false)
    }
  })

  test.each([
    ['image', 'href'],
    ['image', 'xlink:href'],
    ['use', 'href'],
    ['feImage', 'href'],
  ])('an SVG <%s %s> keeps only a #fragment', (tag, attribute) => {
    const svg = 'http://www.w3.org/2000/svg'
    const ns = attribute === 'xlink:href' ? 'http://www.w3.org/1999/xlink' : null
    const outside = document.createElementNS(svg, tag)
    outside.setAttributeNS(ns, attribute, 'https://example.com/x.svg#a')
    const inside = document.createElementNS(svg, tag)
    inside.setAttributeNS(ns, attribute, '#glyph')
    const root = document.createElement('div')
    root.append(outside, inside)
    sanitizePreview(root)
    expect(outside.hasAttribute(attribute)).toBe(false)
    expect(inside.getAttribute(attribute)).toBe('#glyph')
  })

  test.each(['background', 'lowsrc', 'dynsrc'])('the old %s attribute goes', (attribute) => {
    const root = cleaned(`<table ${attribute}="https://example.com/x.png"></table>`)
    expect(root.querySelector('table')!.hasAttribute(attribute)).toBe(false)
  })

  test.each([
    ['action', 'div'],
    ['formaction', 'button'],
    ['data', 'div'],
    ['xlink:href', 'div'],
  ])('an unsafe %s on <%s> goes, and a safe one stays', (attribute, tag) => {
    const bad = document.createElement(tag)
    bad.setAttribute(attribute, `${SCRIPT}void(0)`)
    const good = document.createElement(tag)
    good.setAttribute(attribute, 'https://example.com/x')
    const root = document.createElement('div')
    root.append(bad, good)
    sanitizePreview(root)
    expect(bad.hasAttribute(attribute)).toBe(false)
    expect(good.getAttribute(attribute)).toBe('https://example.com/x')
  })

  test('an SVG link that lost its xlink:href becomes its text', () => {
    const root = cleaned(`<svg><a xlink:href="${SCRIPT}void(0)"><text>x</text></a></svg>`)
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('text')?.textContent).toBe('x')
  })

  test('a <source srcset> goes, https candidates too', () => {
    const root = cleaned(`<source class="bad" srcset="https://example.com/a.png 1x, data:image/png;base64,AA 2x"><source class="https" srcset="https://example.com/a.png 1x, https://example.com/b.png 2x">`)
    expect(root.querySelector('.bad')!.hasAttribute('srcset')).toBe(false)
    expect(root.querySelector('.https')!.hasAttribute('srcset')).toBe(false)
  })

  test('an <img srcset> goes like any other image URL the app did not supply', () => {
    expect(cleaned(`<img srcset="https://example.com/a.png 1x">`).querySelector('img')!.hasAttribute('srcset')).toBe(false)
  })

  test.each(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form'])('<%s> is removed', (tag) => {
    const root = document.createElement('div')
    root.append(document.createElement(tag), 'kept')
    sanitizePreview(root)
    expect(root.querySelector(tag)).toBeNull()
    expect(root.textContent).toBe('kept')
  })

  test('SVG animation that could rewrite an href is removed', () => {
    const root = cleaned(`<svg><a href="https://example.com/"><set attributeName="href"></set><animate attributeName="href"></animate></a></svg>`)
    expect(root.querySelector('set, animate')).toBeNull()
  })

  test('a style with any url() but a #fragment goes, https and an unclosed url( too', () => {
    const root = cleaned(
      `<p id="https" style="background:url(https://example.com/x.png)"></p>` +
        `<p id="quoted" style="background:url( 'https://example.com/x.png' )"></p>` +
        `<p id="unclosed" style="background:url(https://example.com/x.png"></p>` +
        `<p id="mixed" style="fill:url(#g); background:url(https://example.com/x.png)"></p>` +
        `<p id="fragment" style="fill:url(#g)"></p>` +
        `<style id="sheet">p { background: url(https://example.com/x.png) }</style>`,
    )
    for (const id of ['https', 'quoted', 'unclosed', 'mixed']) expect(root.querySelector(`#${id}`)!.hasAttribute('style')).toBe(false)
    expect(root.querySelector('#fragment')!.getAttribute('style')).toBe('fill:url(#g)')
    expect(root.querySelector('#sheet')).toBeNull()
  })

  test('a <style> or style attribute goes only for an unsafe url(), @import or CSS escape', () => {
    const root = cleaned(
      `<style id="s1">a { color: red; background: url(#g) }</style>` +
        `<style id="s2">a { background: url("${SCRIPT}void(0)") }</style>` +
        `<style id="s3">@import "data:text/css,x";</style>` +
        `<style id="s4">a { background: \\75rl(x) }</style>` +
        `<style id="s5">@import"data:text/css,x";</style>` +
        `<style id="s6">@import/**/"https://example.com/x.css";</style>` +
        `<p id="p1" style="color: red"></p>` +
        `<p id="p2" style="background: url(data:image/png;base64,AA)"></p>` +
        `<p id="p3" style="background: image-set('data:image/png;base64,AA' 1x)"></p>`,
    )
    expect(root.querySelector('#s1')).not.toBeNull()
    expect(root.querySelectorAll('#s2, #s3, #s4, #s5, #s6')).toHaveLength(0)
    expect(root.querySelector('#p1')!.hasAttribute('style')).toBe(true)
    expect(root.querySelector('#p2')!.hasAttribute('style')).toBe(false)
    expect(root.querySelector('#p3')!.hasAttribute('style')).toBe(false)
  })

  test('an app-supplied image URL is kept only as an <img src>, and only when it matches exactly', () => {
    const trusted = new Set(['blob:gemm'])
    const root = cleaned(`<img id="a" src="blob:gemm"><img id="b" src="blob:other"><a id="c" href="blob:gemm">x</a>`, trusted)
    expect(root.querySelector('#a')!.getAttribute('src')).toBe('blob:gemm')
    expect(root.querySelector('#b')!.hasAttribute('src')).toBe(false)
    expect(root.querySelector('#c')).toBeNull()
  })

  test('any other <img src> goes, https too: a third-party draft must not make a request on open', () => {
    expect(cleaned(`<img src="https://example.com/p.png">`).querySelector('img')!.hasAttribute('src')).toBe(false)
  })
})

describe('with the real LaTeX.js render', () => {
  beforeEach(() => forgetUnknowns())

  const HYPERREF = '\\usepackage{hyperref}'
  const doc = (body: string, preamble = '') => `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`
  const render = async (source: string) => (await renderLatex(preparePreview(source).source)).root
  const links = (root: Element) => [...root.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])
  const OUTSIDE = ['_blank', 'noopener noreferrer']
  const BAD_SCHEMES = [`${SCRIPT}x`, 'JaVaScRiPt:x', 'data:text/plain,x', 'vbscript:x']
  const TABBED = `java${TAB}script:x`

  test.each([...BAD_SCHEMES, TABBED])('\\url{%s} without hyperref is text, not a link', async (url) => {
    const root = await render(doc(`before \\url{${url}} after`))
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toContain('before')
    expect(root.textContent).toContain('after')
    expect(root.textContent).toMatch(/script|data:/i)
  })

  test.each(BAD_SCHEMES)('\\url{%s} with hyperref is text, not a link', async (url) => {
    const root = await render(doc(`before \\url{${url}} after`, HYPERREF))
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toMatch(/script|data:/i)
  })

  test.each(BAD_SCHEMES)('\\href{%s}{words} with hyperref keeps its words, not a link', async (url) => {
    const root = await render(doc(`\\href{${url}}{words}`, HYPERREF))
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toContain('words')
  })

  test.each([`\\url{${TABBED}}`, `\\href{${TABBED}}{words}`])('hyperref refuses a tab in a URL, so %s renders nothing at all', async (body) => {
    await expect(render(doc(body, HYPERREF))).rejects.toMatchObject({ message: expect.stringContaining('illegal char in url') })
  })

  test('\\href without hyperref is a placeholder and no link', async () => {
    const root = await render(doc(`\\href{${SCRIPT}x}{words}`))
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('.ss-unknown')?.textContent).toBe('\\href')
    expect(root.textContent).toContain('words')
  })

  test('an entity-encoded scheme written in LaTeX is no link either', async () => {
    const root = await render(doc('\\url{\\&\\#106;avascript:x}'))
    expect(root.querySelector('a')).toBeNull()
  })

  test.each([
    ['without hyperref', ''],
    ['with hyperref', HYPERREF],
  ])('\\url to http, https and mailto works %s', async (_name, preamble) => {
    const root = await render(doc('\\url{http://example.com/}\n\n\\url{https://example.com/}\n\n\\url{mailto:someone@example.com}', preamble))
    expect(links(root)).toEqual([
      ['http://example.com/', ...OUTSIDE],
      ['https://example.com/', ...OUTSIDE],
      ['mailto:someone@example.com', ...OUTSIDE],
    ])
  })

  test('\\href to http, https, mailto and a #fragment works with hyperref', async () => {
    const root = await render(doc('\\href{http://example.com/}{a}\n\n\\href{https://example.com/}{b}\n\n\\href{mailto:someone@example.com}{c}\n\n\\href{#sec}{d}', HYPERREF))
    expect(links(root)).toEqual([
      ['http://example.com/', ...OUTSIDE],
      ['https://example.com/', ...OUTSIDE],
      ['mailto:someone@example.com', ...OUTSIDE],
      ['#sec', null, null],
    ])
  })

  test('a #fragment keeps its case and colon with hyperref', async () => {
    const root = await render(doc('\\href{#Sec:One}{d}', HYPERREF))
    expect(links(root)).toEqual([['#Sec:One', null, null]])
  })

  test.each(['\\includegraphics[width=1cm] {https://example.com/p.png}', '\\includegraphics {https://example.com/p.png}'])('%s loads nothing: it is the named box', async (body) => {
    const root = await render(doc(body, '\\usepackage{graphicx}'))
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.ss-graphic')?.textContent).toContain('Image not uploaded')
  })

  test('renderIsolated cleans each block when the whole file will not compile', async () => {
    const source = doc(`\\section{One}\n\\url{${SCRIPT}x}\n\\section{Two}\n\\begin{tabular}\n\\section{Three}\n\\url{https://example.com/}`)
    const { root } = await renderIsolated(preparePreview(source).source)
    expect(links(root)).toEqual([['https://example.com/', ...OUTSIDE]])
    expect(root.textContent).toContain('script')
  })

  test('nothing in a real render carries a handler or a refused URL', async () => {
    const root = await render(doc(`\\section{One}\\label{a}\nSee \\ref{a}. \\url{${SCRIPT}x} $x^2$ \\footnote{note}`, HYPERREF))
    for (const element of root.querySelectorAll('*')) {
      expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([])
      for (const name of ['href', 'xlink:href', 'src']) {
        const value = element.getAttribute(name)
        if (value !== null) expect(safeUrl(value)).toBe(value)
      }
    }
    expect(root.textContent).toContain('One')
  })
})
