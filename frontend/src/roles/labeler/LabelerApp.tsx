/**
 * Labeler role: build the labeled dataset (claims, passages, 1-4 evidence labels) by hand.
 * `?analysis=` deep-links the paper being labeled; with none, the list of papers shows.
 */

import { ClipboardCheck, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { Queue } from './screens/Queue'
import { Workspace } from './screens/Workspace'

const NAV: NavEntry<'papers'>[] = [{ key: 'papers', label: 'Papers to label', icon: Tags }]

export function LabelerApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(() => new URLSearchParams(window.location.search).get('analysis'))

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
      onNavigate={() => setAnalysis(null)}
      role="Labeler"
      roleIcon={ClipboardCheck}
      onChangeRole={onChangeRole}
      wide
    >
      {analysis ? <Workspace analysisId={analysis} /> : <Queue onOpen={setAnalysis} />}
    </AppShell>
  )
}
