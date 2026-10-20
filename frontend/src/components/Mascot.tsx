/**
 * Quip, the SecretSource mascot: the logo's quotation mark with a face, holding one prop per
 * role. Inline SVG, so it costs no request. Colours are the theme's CSS variables, so it
 * follows dark mode without extra classes.
 *
 * Static by default. `animated` adds a slow idle bob and a blink; hovering wiggles the prop.
 * Both stop when the visitor asks the OS for reduced motion.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'

import type { Role } from '../lib/roles'

const C = {
  body: 'var(--color-accent)',
  soft: 'var(--color-accent-soft)',
  face: 'var(--color-canvas)',
  ink: 'var(--color-ink)',
  paper: 'var(--color-surface)',
  check: 'var(--color-supports)',
  tassel: 'var(--color-insufficient)',
}

const EASE_IN_OUT = [0.45, 0, 0.55, 1] as const

export function Mascot({
  role,
  size = 64,
  animated = false,
  className,
}: {
  role: Role
  size?: number
  /** Loop the idle bob and blink. Keep it off where the mascot sits on a busy screen. */
  animated?: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const loop = animated && !reduceMotion
  const [isHovered, setIsHovered] = useState(false)

  return (
    <motion.svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
    >
      <ellipse cx="46" cy="90" rx="20" ry="3" fill={C.ink} opacity="0.12" />
      <motion.g
        animate={loop ? { y: [0, -3, 0] } : undefined}
        transition={loop ? { duration: 3.2, ease: EASE_IN_OUT, repeat: Infinity } : undefined}
      >
        <path d="M24 54C20 39 26 28 39 21" stroke={C.body} strokeWidth="11" strokeLinecap="round" fill="none" />
        <circle cx="44" cy="60" r="24" fill={C.body} />
        <motion.g
          style={{ transformOrigin: '44px 57px' }}
          animate={loop ? { scaleY: [1, 1, 0.1, 1] } : undefined}
          transition={loop ? { duration: 4, times: [0, 0.92, 0.96, 1], repeat: Infinity } : undefined}
        >
          <circle cx="37" cy="57" r="3.2" fill={C.face} />
          <circle cx="51" cy="57" r="3.2" fill={C.face} />
        </motion.g>
        <circle cx="31" cy="64" r="3" fill={C.soft} opacity="0.7" />
        <circle cx="57" cy="64" r="3" fill={C.soft} opacity="0.7" />
        <path d="M39 65Q44 69.5 49 65" stroke={C.face} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <motion.g
          style={{ transformOrigin: PROP_PIVOT[role] }}
          animate={isHovered && !reduceMotion ? { rotate: [0, -10, 7, 0] } : { rotate: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <Prop role={role} />
        </motion.g>
      </motion.g>
    </motion.svg>
  )
}

/** Where each prop turns when it wiggles: the point where Quip holds it. */
const PROP_PIVOT: Record<Role, string> = {
  researcher: '66px 62px',
  writer: '64px 70px',
  teacher: '60px 38px',
  labeler: '66px 66px',
}

function Prop({ role }: { role: Role }) {
  switch (role) {
    case 'researcher':
      return (
        <g>
          <path d="M70 56L63 63" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
          <circle cx="77" cy="48" r="10" fill={C.soft} stroke={C.ink} strokeWidth="3" />
          <path d="M72 44.5A6 6 0 0 1 77 42" stroke={C.face} strokeWidth="2" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'writer':
      return (
        <g>
          <path d="M64 72C68 55 76 43 88 32C86 47 78 60 64 72Z" fill={C.paper} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
          <path d="M64 72L80 44" stroke={C.ink} strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )
    case 'teacher':
      return (
        <g>
          <path d="M48 34V40Q60 46 72 40V34" fill={C.ink} />
          <path d="M40 30L60 22L80 30L60 38Z" fill={C.ink} />
          <path d="M60 30L77 35V44" stroke={C.tassel} strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="77" cy="46" r="2.4" fill={C.tassel} />
        </g>
      )
    case 'labeler':
      return (
        <g>
          <rect x="63" y="50" width="23" height="29" rx="3" fill={C.paper} stroke={C.ink} strokeWidth="2" />
          <rect x="69.5" y="46.5" width="10" height="6" rx="2" fill={C.ink} />
          <path d="M68.5 65L72.5 69L81 60" stroke={C.check} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      )
  }
}
