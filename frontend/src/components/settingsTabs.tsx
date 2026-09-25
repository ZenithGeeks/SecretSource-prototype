/** Config for the Settings modal's tabs: the 6 shared ones (Figma 22a–22f) plus each role's
 * one extra tab. `getSettingsTabs` is the single place a role's tab set is assembled, so
 * SettingsModal itself never needs to know which role it's showing. */

import { Bell, CircleCheck, Download, GraduationCap, Microscope, Pen, Sparkles, UserCog, UserRound, Users2, Waypoints } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

import type { Role } from '../screens/Onboarding'
import {
  AccountSection,
  AppearanceSection,
  CheckingSection,
  ClassMarkingSection,
  FieldMapSection,
  NotificationsSection,
  RoleSection,
  YourDataSection,
} from './settingsSections'

type Icon = ComponentType<{ className?: string }>

export type SettingsTabDef = { id: string; label: string; icon: Icon; content: ReactNode }

export const ROLE_NAV: { id: Role; label: string; icon: Icon }[] = [
  { id: 'writer', label: 'Author', icon: Pen },
  { id: 'researcher', label: 'Researcher', icon: Microscope },
  { id: 'teacher', label: 'Teacher', icon: GraduationCap },
]

export function getSettingsTabs(viewingRole: Role, currentRole: Role, onSwitchRole: () => void): SettingsTabDef[] {
  const current = ROLE_NAV.find((r) => r.id === currentRole) ?? ROLE_NAV[0]
  // Previewing another role's tabs must never write that role's settings as the signed-in
  // user: every section whose controls save for real gets this and disables itself.
  const isPreview = viewingRole !== currentRole

  const tabs: SettingsTabDef[] = [
    { id: 'account', label: 'Account', icon: UserRound, content: <AccountSection /> },
    {
      id: 'role',
      label: 'Role and home',
      icon: UserCog,
      content: <RoleSection roleLabel={current.label} roleIcon={current.icon} onSwitchRole={onSwitchRole} />,
    },
    { id: 'checking', label: 'Checking', icon: CircleCheck, content: <CheckingSection /> },
    { id: 'notifications', label: 'Notifications', icon: Bell, content: <NotificationsSection /> },
    { id: 'appearance', label: 'Appearance', icon: Sparkles, content: <AppearanceSection /> },
    {
      id: 'data',
      label: 'Your data',
      icon: Download,
      content: <YourDataSection role={viewingRole} isPreview={isPreview} />,
    },
  ]

  if (viewingRole === 'researcher') {
    tabs.push({
      id: 'field-map',
      label: 'Field map',
      icon: Waypoints,
      content: <FieldMapSection isPreview={isPreview} />,
    })
  }
  if (viewingRole === 'teacher') {
    tabs.push({
      id: 'class-marking',
      label: 'Class and marking',
      icon: Users2,
      content: <ClassMarkingSection isPreview={isPreview} />,
    })
  }

  return tabs
}
