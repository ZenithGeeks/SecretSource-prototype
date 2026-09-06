import type { Claim } from '../lib/writer'
import { VERDICT_BADGE_TEXT } from '../lib/writer'
import { Badge } from './Badge'

export interface ClaimRowProps {
  claim: Claim
  onClick: () => void
}

/** A claim needing attention, as one clickable row: verdict, claim text, citation. */
export function ClaimRow({ claim, onClick }: ClaimRowProps) {
  if (!claim.verdict) return null

  return (
    <button className="row" type="button" onClick={onClick}>
      <Badge variant={claim.verdict}>{VERDICT_BADGE_TEXT[claim.verdict]}</Badge>
      <p className="row__claim">{claim.text}</p>
      <p className="row__citation">{claim.citation?.label}</p>
      <img className="row__chevron" src="/icons/icon-chevron-right.svg" alt="Chevron right icon" />
    </button>
  )
}
