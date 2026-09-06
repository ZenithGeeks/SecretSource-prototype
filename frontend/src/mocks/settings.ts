import type { Role } from '../types'

/**
 * Writer preferences. Backs a future Settings screen — no route exists yet
 * (see AppRouter) — kept here so the service layer is ready when it does.
 */
export interface Settings {
  role: Role
  autoRecheckOnSave: boolean
  strictCitationMatching: boolean
  defaultLibraryOnly: boolean
}

export const mockSettings: Settings = {
  role: 'writer',
  autoRecheckOnSave: true,
  strictCitationMatching: false,
  defaultLibraryOnly: true,
}
