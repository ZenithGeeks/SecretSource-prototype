/** The Figma "Brand" component: logo mark + two-tone wordmark, with the tagline in the
 * sidebar, a larger lockup on hero screens like onboarding, and no tagline in the phone top bar. */

import { Microscope } from 'lucide-react'

export function Brand({ hero = false, compact = false }: { hero?: boolean; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={hero ? 'flex items-center gap-3' : 'flex items-center gap-2.5'}>
        <Microscope className={hero ? 'size-10 text-accent' : 'size-7 text-accent'} />
        <span className={`font-serif tracking-tight ${hero ? 'text-[32px]' : 'text-xl'}`}>
          <span className="font-semibold text-ink">Secret</span>
          <span className="font-normal italic text-accent">Source</span>
        </span>
      </div>
      {!hero && !compact && (
        <p className="text-sm text-ink-muted">
          Checks whether the sources a paper cites actually support what it claims.
        </p>
      )}
    </div>
  )
}
