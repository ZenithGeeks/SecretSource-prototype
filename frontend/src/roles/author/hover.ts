/**
 * The Author role's one hover and focus treatment: the Home "Check" button's (components/ui
 * Button, variant ghost). A soft accent highlight behind the control on hover, never an
 * underline, and the accent outline for keyboard focus. Author only: the shared components
 * in components/ui keep their own look for the other roles.
 */

/** Hover highlight and focus outline, for a control that has its own padding and shape. */
export const HIGHLIGHT = 'hover:bg-accent-soft hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A text link or a link-like button: the same, with a little room around the text for the
 * highlight that does not move it. It keeps its accent colour, so it reads as a link without
 * the underline. */
export const LINK = `-mx-1 rounded px-1 ${HIGHLIGHT}`

/** The focus outline alone, for rows and cards that already have a hover tint of this accent. */
export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-accent'
