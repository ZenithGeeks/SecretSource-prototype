/** An image from the gateway, which needs the signed-in user's token (useAuthorizedUrl). */

import type { ImgHTMLAttributes } from 'react'

import { useAuthorizedUrl } from '../lib/useAuthorizedUrl'
import { cn } from '../lib/utils'

export function AuthorizedImage({ src, alt, className, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const image = useAuthorizedUrl(src)
  if (image.failed) {
    return <span className={cn('block p-2 text-xs text-ink-muted', className)}>{alt}</span>
  }
  if (!image.url) {
    return <span className={cn('block h-24 w-40 animate-pulse', className)} aria-hidden />
  }
  return <img src={image.url} alt={alt} className={className} {...props} />
}
