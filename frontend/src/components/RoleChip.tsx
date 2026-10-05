/** The Figma "RoleChip": the signed-in role as a soft pill. Shown at the bottom of the
 * AppShell sidebar and in the editor's top bar. */

import type { ComponentType } from 'react'

export function RoleChip({ role, icon: Icon }: { role: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
      <Icon className="size-4" aria-hidden="true" />
      {role}
    </span>
  )
}
