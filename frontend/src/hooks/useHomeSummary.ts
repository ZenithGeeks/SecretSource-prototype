import { getHomeSummary } from '../services'
import { useAsync } from './useAsync'

export function useHomeSummary() {
  return useAsync(getHomeSummary, [])
}
