/**
 * Analyses (Researcher) — the Figma "New analysis", "Running" and "Results" screens inside the
 * researcher shell. With nothing open it is the form that starts an analysis from a DOI, arXiv
 * ID, URL or an uploaded PDF; with one open it follows the stages while it runs and lists the
 * claims. Past analyses are listed under the nav, and "+ New" returns to the form, both
 * handled by the shell, which owns which analysis is open.
 */

import type { SectionJump } from '../../../components/AnalysisView'
import { AnalysisView } from '../../../components/AnalysisView'
import { NewAnalysis } from '../../../components/NewAnalysis'

export function History({
  selected,
  onSelect,
  onTargetChange,
  section,
  onClearSection,
  jump,
  onCurrentSection,
}: {
  selected: string | null
  onSelect: (id: string | null) => void
  onTargetChange?: (open: boolean) => void
  /** The section picked in the table of contents: only its claims are listed. */
  section?: string | null
  onClearSection?: () => void
  /** The page of the section picked last, to open in the page viewer. */
  jump?: SectionJump | null
  onCurrentSection?: (section: string | null) => void
}) {
  if (!selected) return <NewAnalysis onStarted={onSelect} />
  return (
    <AnalysisView
      key={selected}
      id={selected}
      onTargetChange={onTargetChange}
      section={section}
      onClearSection={onClearSection}
      jump={jump}
      onCurrentSection={onCurrentSection}
      actionsInToolbar
    />
  )
}
