/** The Figma "Brand" component: logo mark + two-tone wordmark, with the tagline in the
 * sidebar, a larger lockup on hero screens like onboarding, and no tagline in the phone top bar. */

/** The logo mark, inline so its strokes follow the accent and ink tokens in dark mode. */
function LogoMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="28" strokeWidth="3" className="stroke-accent" />
      <path d="M20 38C20 31 23 26 29 23M36 38C36 31 39 26 45 23" strokeWidth="3" strokeLinecap="round" className="stroke-ink" />
      <circle cx="23" cy="38" r="5" className="fill-ink" />
      <circle cx="39" cy="38" r="5" className="fill-ink" />
      <path d="M40 50L44 54L52 45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent" />
    </svg>
  )
}

export function Brand({ hero = false, compact = false }: { hero?: boolean; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={hero ? 'flex items-center gap-3' : 'flex items-center gap-2.5'}>
        <LogoMark className={hero ? 'size-10' : 'size-7'} />
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
