import { getUser } from '../services'
import { useAsync } from './useAsync'

export function useUser() {
  return useAsync(getUser, [])
}
