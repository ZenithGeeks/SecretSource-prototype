/**
 * Labeler role: build the labeled dataset (claims, passages, 1-4 evidence labels) by hand.
 * `?analysis=` deep-links the paper being labeled; with none, the list of papers shows.
 */

import { ClipboardCheck, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { NavEntry } from '../../components/AppShell'
import { AppShell } from '../../components/AppShell'
import { useAsk } from '../../components/Ask'
import { SettingsModal } from '../../components/SettingsModal'
import { settingsRequested } from '../../lib/settingsDeepLink'
import { PaperBell } from './components/PaperBell'
import { Queue } from './screens/Queue'
import { Workspace } from './screens/Workspace'
import { usePaperNotices } from './usePaperNotices'

const NAV: NavEntry<'papers'>[] = [{ key: 'papers', label: 'Papers to label', icon: Tags }]

export function LabelerApp({ onChangeRole }: { onChangeRole?: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(() => new URLSearchParams(window.location.search).get('analysis'))
  const [unsaved, setUnsaved] = useState(false) // the open workspace holds drafts that are not saved
  // A modal over the current screen, as in the other roles, so unsaved labels stay open under it.
  const [settingsOpen, setSettingsOpen] = useState(() => settingsRequested(window.location.search))
  const leave = (go: () => void) => () => {
    if (unsaved && !window.confirm('You have unsaved labels. Leave without saving?')) return
    go()
  }
  const openPaper = (id: string) => leave(() => setAnalysis(id))()
  usePaperNotices(openPaper)
  // Where the workspace draws its claim tools (review, questions about the paper and its
  // references) inside the Ask panel's "This claim" mode.
  const [claimSlot, setClaimSlot] = useState<HTMLDivElement | null>(null)
  const ask = useAsk({
    role: 'labeler',
    screen: analysis ? 'workspace' : 'papers',
    // No paper chip: a pool paper is often a teammate's, which the chat cannot read. Questions
    // about the open paper go through "This claim".
    canNarrow: false,
    // Do it with the Labeler's screen agent; the coding agent over MCP gets the same actions.
    actions: {
      role: 'labeler',
      screen: analysis ? 'workspace' : 'papers',
      screens: ['papers'],
      openScreen: () => leave(() => setAnalysis(null))(),
      openPaper,
    },
    extra: analysis ? { label: 'This claim', content: <div ref={setClaimSlot} /> } : undefined,
  })

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
      onOpenSettings={() => setSettingsOpen(true)}
      settingsActive={settingsOpen}
      // The workspace shows two PDFs and a label panel, so it takes the whole window.
      wide={analysis ? 'full' : true}
      foldable
      breadcrumb={['Papers to label']}
      toolbarLead={ask.button}
      panel={ask.panel}
      notifications={<PaperBell onOpen={openPaper} />}
    >
      {analysis ? (
        <Workspace analysisId={analysis} onDirtyChange={setUnsaved} askSlot={claimSlot} />
      ) : (
        <Queue onOpen={setAnalysis} />
      )}
      {ask.viewer}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentRole="labeler"
        onSwitchRole={onChangeRole ? leave(onChangeRole) : () => {}}
      />
    </AppShell>
  )
}
