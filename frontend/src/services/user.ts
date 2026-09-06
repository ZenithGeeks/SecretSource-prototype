import { mockUser } from '../mocks/user'
import type { User } from '../types'
import { resolveMock, USE_MOCKS } from './_mock'

export async function getUser(): Promise<User> {
  if (USE_MOCKS) return resolveMock(mockUser, mockUser)
  // TODO: replace with a real API call once a backend endpoint exists
  throw new Error('Real API not implemented yet')
}
