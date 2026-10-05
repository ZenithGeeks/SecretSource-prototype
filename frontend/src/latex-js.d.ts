/** latex.js ships no typings. Only what src/lib/latexPreview.ts uses is declared. */
declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { hyphenate?: boolean; documentClass?: string; CustomMacros?: unknown })
    /** Replaces the error handler, which by default logs to the console before throwing. */
    setErrorFn?(fn: (message: string) => never): void
  }
  export function parse(source: string, options: { generator: HtmlGenerator }): { domFragment(): DocumentFragment }
  export class SyntaxError extends Error {
    location?: { start: { offset: number; line: number; column: number } }
  }
}

declare module 'latex.js/dist/css/katex.css?inline' {
  const css: string
  export default css
}

declare module '*.css?inline' {
  const css: string
  export default css
}
