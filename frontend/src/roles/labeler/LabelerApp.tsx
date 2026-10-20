/**
 * Labeler role: build the labeled dataset (claims, passages, 1-4 evidence labels) by hand.
 * `?analysis=` deep-links the paper being labeled; with none, the list of papers shows.
 */

import { ClipboardCheck, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { PaperBell } from './components/PaperBell'
import { Queue } from './screens/Queue'
import { Workspace } from './screens/Workspace'
import { usePaperNotices } from './usePaperNotices'

const NAV: NavEntry<'papers'>[] = [{ key: 'papers', label: 'Papers to label', icon: Tags }]

export function LabelerApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(() => new URLSearchParams(window.location.search).get('analysis'))
  const [unsaved, setUnsaved] = useState(false) // the open workspace holds drafts that are not saved
  const leave = (go: () => void) => () => {
    if (unsaved && !window.confirm('You have unsaved labels. Leave without saving?')) return
    go()
  }
  const openPaper = (id: string) => leave(() => setAnalysis(id))()
  usePaperNotices(openPaper)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (analysis) params.set('analysis', analysis)
    else params.delete('analysis')
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }, [analysis])

  return (
    <AppShell
      nav={NAV}
      active="papers"
      onNavigate={leave(() => setAnalysis(null))}
      role="Labeler"
      roleIcon={ClipboardCheck}
      onChangeRole={onChangeRole && leave(onChangeRole)}
      // The workspace shows two PDFs and a label panel, so it takes the whole window.
      wide={analysis ? 'full' : true}
      foldable
      notifications={<PaperBell onOpen={openPaper} />}
    >
      {analysis ? <Workspace analysisId={analysis} onDirtyChange={setUnsaved} /> : <Queue onOpen={setAnalysis} />}
    </AppShell>
  )
}
