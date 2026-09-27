/** An image from the gateway, which needs the signed-in user's token (useAuthorizedUrl). */

import type { ImgHTMLAttributes } from 'react'

import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'

export function AuthorizedImage({ src, alt, className, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const image = useAuthorizedUrl(src)
  if (image.failed) {
    // className carries the image's max-h/max-w for sizing a real <img> — a full caption of
    // text needs to be readable, not cropped to an image's height. An inline style always
    // wins over a class (no dependency on cn()'s merge recognising max-h-none as the same
    // utility group as the caller's max-h-*, which it does not), so the box reliably grows to
    // fit the text instead of clipping it or overflowing into whatever renders after it.
    return (
      <span
        className={cn('block p-2 text-xs text-ink-muted', className)}
        style={{ maxHeight: 'none' }}
      >
        {alt}
      </span>
    )
  }
  if (!image.url) {
    return <span className={cn('block h-24 w-40 animate-pulse', className)} aria-hidden />
  }
  return <img src={image.url} alt={alt} className={className} {...props} />
}
