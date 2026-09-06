export type Role = 'writer' | 'researcher' | 'teacher'

export interface User {
  id: string
  name: string
  role: Role
}
