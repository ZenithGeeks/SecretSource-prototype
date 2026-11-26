/**
 * Analyses (Researcher) — the Figma "New analysis", "Running" and "Results" screens inside the
 * researcher shell. With nothing open it is every past analysis with a search box, under a
 * "New analysis" button that opens the form (a DOI, arXiv ID, URL or an uploaded PDF); with one open it
 * follows the stages while it runs and lists the claims. Recent analyses are also listed under
 * the nav, and "+ New" returns to the form, both handled by the shell, which owns which
 * analysis is open.
 */

import type { SectionJump } from '../../../components/AnalysisView'
import { AnalysisView } from '../../../components/AnalysisView'
import { NewAnalysis } from '../../../components/NewAnalysis'
import type { Standing } from '../../../lib/claims'
import { useAnalyses } from '../../../lib/useAnalysis'
import { AnalysisList } from '../components/AnalysisList'

export function History({
  selected,
  formOpen = false,
  onSelect,
  onTargetChange,
  section,
  onClearSection,
  filter,
  onFilter,
  jump,
  onCurrentSection,
}: {
  selected: string | null
  /** Show the form above the list of past analyses, as the sidebar's "+ New" asks. */
  formOpen?: boolean
  onSelect: (id: string | null) => void
  onTargetChange?: (open: boolean) => void
  /** The section picked in the table of contents: only its claims are listed. */
  section?: string | null
  onClearSection?: () => void
  /** The standing picked on a count tile: only those claims are listed and counted. */
  filter?: Standing | null
  onFilter?: (standing: Standing | null) => void
  /** The page of the section picked last, to open in the page viewer. */
  jump?: SectionJump | null
  onCurrentSection?: (section: string | null) => void
}) {
  const analyses = useAnalyses()
  if (!selected) {
    // Nothing until the list arrives: the first-visit form would be swapped out under the reader's typing.
    if (analyses.isPending) return null
    return (
      // Keyed so a "+ New" while the list shows opens the form.
      <NewAnalysis key={String(formOpen)} formOpen={formOpen} onStarted={onSelect}>
        {analyses.data?.length ? <AnalysisList analyses={analyses.data} onOpen={onSelect} /> : undefined}
      </NewAnalysis>
    )
  }
  return (
    <AnalysisView
      key={selected}
      id={selected}
      onRetried={onSelect}
      onTargetChange={onTargetChange}
      section={section}
      onClearSection={onClearSection}
      filter={filter}
      onFilter={onFilter}
      jump={jump}
      onCurrentSection={onCurrentSection}
      actionsInToolbar
    />
  )
}
