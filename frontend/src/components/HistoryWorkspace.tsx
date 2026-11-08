/**
 * The History screen's state and pieces, shared by every role that analyses papers (Figma
 * row "Analyze a paper": 01 Empty, 02 Running, 03 Results, 04 Page viewer). The Researcher
 * and Author apps render the same form, results, page viewer and sidebar list; only their
 * nav differs. The hook owns which analysis is open, the wide layout while a page shows,
 * and the table-of-contents state the sidebar and the claims share (#153).
 */

import { useState, type ReactNode } from 'react'

import type { SectionJump } from './AnalysisView'
import { HistoryList } from './HistoryList'
import { AnalysisContents } from './TableOfContents'
import { analysisLabel } from '../lib/claims'
import type { ContentsRow } from '../lib/outline'
import { useAnalyses, useAnalysisNotices } from '../lib/useAnalysis'
import { History } from '../roles/researcher/screens/History'

export function initialAnalysis(): string | null {
  return new URLSearchParams(window.location.search).get('analysis')
}

export function useHistoryWorkspace({ onPicked }: { onPicked?: () => void } = {}): {
  selected: string | null
  /** File name of the open analysis, for a breadcrumb; null until its row has loaded. */
  selectedName: string | null
  select: (id: string | null) => void
  /** Open one analysis, from anywhere a paper or claim is listed. */
  open: (id: string) => void
  /** A page is open beside the claims: the shell should grow. */
  wide: boolean
  closePage: () => void
  sidebar: ReactNode
  main: ReactNode
} {
  const [selected, setSelected] = useState<string | null>(initialAnalysis)
  const [wide, setWide] = useState(false)
  const [section, setSection] = useState<string | null>(null) // claims narrowed to one section
  const [current, setCurrent] = useState<string | null>(null) // section open in the page viewer
  const [jump, setJump] = useState<SectionJump | null>(null) // section page to open
  const analyses = useAnalyses()

  const select = (id: string | null) => {
    setSelected(id)
    setWide(false)
    setSection(null)
    setCurrent(null)
    setJump(null)
  }
  // A clicked notice opens its analysis, as picking it in the sidebar list does.
  useAnalysisNotices(analyses.data, (id) => {
    select(id)
    onPicked?.()
  })
  const pickSection = (row: ContentsRow) => {
    setSection(row.n)
    setCurrent(row.n)
    setJump({ n: row.n, title: row.title, page: row.page, at: Date.now() })
    setWide(true)
  }

  const selectedAnalysis = analyses.data?.find((a) => a.id === selected)
  const sidebar = (
    <HistoryList
      analyses={analyses.data ?? []}
      loading={analyses.isPending}
      selected={selected}
      onSelect={(id) => {
        select(id)
        onPicked?.()
      }}
      onNew={() => {
        select(null)
        onPicked?.()
      }}
      contents={selected ? <AnalysisContents id={selected} current={current} onPick={pickSection} /> : undefined}
    />
  )
  const main = (
    <History
      selected={selected}
      onSelect={select}
      onTargetChange={setWide}
      section={section}
      onClearSection={() => setSection(null)}
      jump={jump}
      onCurrentSection={setCurrent}
    />
  )

  return {
    selected,
    selectedName: selectedAnalysis ? analysisLabel(selectedAnalysis) : null,
    select,
    open: select,
    wide,
    closePage: () => setWide(false),
    sidebar,
    main,
  }
}
