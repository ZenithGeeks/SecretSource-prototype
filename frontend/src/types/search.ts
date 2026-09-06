import type { Citation } from './citation'
import type { Source } from './source'

/** Result of searching the library (and open access) for a source that backs a sentence. */
export interface SearchResponse {
  libraryCount: number
  currentCitation: Citation
  currentCitationVerdict: 'refutes' | 'insufficient'
  results: Source[]
}
