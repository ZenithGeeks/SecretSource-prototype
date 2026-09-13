/**
 * History (Researcher) — the Figma "Analyze a paper" row (01 Empty, 02 Running, 03 Results,
 * 04 Page viewer) inside the researcher shell. Start an analysis from a DOI, arXiv ID, URL
 * or an uploaded PDF, follow the stages while it runs, read the claims. Past analyses are
 * listed under the nav by ResearcherApp, which owns which one is open.
 */

import type { SectionJump } from '../../../components/AnalysisView'
import { AnalysisView } from '../../../components/AnalysisView'
import { SubmitForm } from '../../../components/SubmitForm'

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
  return (
    <>
      <SubmitForm onStarted={onSelect} />
      <AnalysisView
        key={selected ?? 'none'}
        id={selected}
        onTargetChange={onTargetChange}
        section={section}
        onClearSection={onClearSection}
        jump={jump}
        onCurrentSection={onCurrentSection}
      />
    </>
  )
}
