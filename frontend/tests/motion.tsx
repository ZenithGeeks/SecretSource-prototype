/**
 * Renders a component the way the app does: inside the root's LazyMotion with domAnimation
 * (src/main.tsx). `m.*` elements only animate, and only report hover and tap, once those
 * features load, so a test of an animation or a gesture renders through this. A stray
 * `motion.*` is caught by the lint rule in .oxlintrc.json, not here.
 */

import { render, type RenderOptions } from '@testing-library/react'
import { domAnimation, LazyMotion } from 'framer-motion'
import type { ReactElement, ReactNode } from 'react'

export function renderWithMotion(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => <LazyMotion features={domAnimation}>{children}</LazyMotion>,
  })
}
