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
import { analysisLabel, standingsIn } from '../lib/claims'
import type { Standing } from '../lib/claims'
import type { ContentsRow } from '../lib/outline'
import { useAnalyses, useAnalysisNotices } from '../lib/useAnalysis'
import { History } from '../roles/researcher/screens/History'

export function initialAnalysis(): string | null {
  return new URLSearchParams(window.location.search).get('analysis')
}

/** The tile filter a reload or a link names with `?standing=`, on an open analysis only. */
function initialFilter(): Standing | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('analysis') ? (standingsIn(params.get('standing'))[0] ?? null) : null
}

export function useHistoryWorkspace({ onPicked }: { onPicked?: () => void } = {}): {
  selected: string | null
  /** File name of the open analysis, for a breadcrumb; null until its row has loaded. */
  selectedName: string | null
  /** Open an analysis, or the list with null; `filter` narrows its claims, as Back restores it. */
  select: (id: string | null, filter?: Standing | null) => void
  /** The standing the open analysis's claims are narrowed to. */
  filter: Standing | null
  /** Open one analysis, from anywhere a paper or claim is listed. */
  open: (id: string) => void
  /** A page is open beside the claims: the shell should widen. */
  wide: boolean
  closePage: () => void
  sidebar: ReactNode
  main: ReactNode
} {
  const [selected, setSelected] = useState<string | null>(initialAnalysis)
  const [wide, setWide] = useState(false)
  const [section, setSection] = useState<string | null>(null) // claims narrowed to one section
  const [filter, setFilter] = useState<Standing | null>(initialFilter) // claims narrowed to one standing
  const [current, setCurrent] = useState<string | null>(null) // section open in the page viewer
  const [jump, setJump] = useState<SectionJump | null>(null) // section page to open
  const [formOpen, setFormOpen] = useState(false) // "+ New" asked for the form over the list
  const analyses = useAnalyses()

  const select = (id: string | null, standing: Standing | null = null) => {
    setSelected(id)
    setWide(false)
    setSection(null)
    setFilter(standing)
    setCurrent(null)
    setJump(null)
    setFormOpen(false)
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
        setFormOpen(true)
        onPicked?.()
      }}
      contents={selected ? <AnalysisContents id={selected} current={current} filter={filter} onPick={pickSection} /> : undefined}
    />
  )
  const main = (
    <History
      selected={selected}
      formOpen={formOpen}
      onSelect={select}
      onTargetChange={setWide}
      section={section}
      filter={filter}
      onFilter={setFilter}
      // The contents highlight goes with the filter, or it would point at a section no longer picked.
      onClearSection={() => {
        setSection(null)
        setCurrent(null)
      }}
      jump={jump}
      onCurrentSection={setCurrent}
    />
  )

  return {
    selected,
    selectedName: selectedAnalysis ? analysisLabel(selectedAnalysis, analyses.data) : null,
    select,
    filter,
    open: (id) => select(id),
    wide,
    closePage: () => setWide(false),
    sidebar,
    main,
  }
}
