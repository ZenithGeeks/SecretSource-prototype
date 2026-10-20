/**
 * The four roles and how each is named and drawn. The role picker and the Settings role tabs
 * read their labels and icons from here, so a rename or a new icon happens in one place.
 */

import { ClipboardCheck, GraduationCap, Microscope, Pen } from 'lucide-react'
import type { ComponentType } from 'react'

export type Role = 'researcher' | 'writer' | 'teacher' | 'labeler'

export type RoleIcon = ComponentType<{ className?: string }>

export const ROLE_INFO: Record<Role, { label: string; icon: RoleIcon }> = {
  researcher: { label: 'Researcher', icon: Microscope },
  writer: { label: 'Author', icon: Pen },
  teacher: { label: 'Teacher', icon: GraduationCap },
  labeler: { label: 'Labeler', icon: ClipboardCheck },
}
