/** latex.js ships no typings. Only what src/lib/latexPreview.ts uses is declared. */
declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean; documentClass?: string })
  }
  export function parse(source: string, options: { generator: HtmlGenerator }): { domFragment(): DocumentFragment }
  export class SyntaxError extends Error {
    location?: { start: { offset: number; line: number; column: number } }
  }
}
