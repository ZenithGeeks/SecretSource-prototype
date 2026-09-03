export interface QuoteProps {
  text: string
  source: string
  sourceAsLink?: boolean
  linkModifier?: boolean
  muted?: boolean
}

export function Quote({ text, source, sourceAsLink = false, linkModifier = false, muted = false }: QuoteProps) {
  const quoteClassName = `quote${muted ? ' quote--muted' : ''}`
  const sourceClassName = `quote__source${linkModifier ? ' quote__source--link' : ''}`

  return (
    <blockquote className={quoteClassName}>
      <p className="quote__text">{text}</p>
      {sourceAsLink ? (
        <a className={sourceClassName} href="#" onClick={(event) => event.preventDefault()}>
          {source}
        </a>
      ) : (
        <p className={sourceClassName}>{source}</p>
      )}
    </blockquote>
  )
}
