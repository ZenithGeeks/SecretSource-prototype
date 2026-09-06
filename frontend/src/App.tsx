import { FileText } from 'lucide-react'
import { useState } from 'react'

import { AnalysisView } from './components/AnalysisView'
import { HistoryList } from './components/HistoryList'
import { SubmitForm } from './components/SubmitForm'
import { useAnalyses } from './lib/useAnalysis'
import { cn } from './lib/utils'

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [wide, setWide] = useState(false) // a page is open beside the claims
  const analyses = useAnalyses()

  // Switching analyses remounts the view (keyed by id), which closes any open page.
  const select = (id: string | null) => {
    setSelected(id)
    setWide(false)
  }

  return (
    <div
      className={cn(
        'mx-auto grid gap-8 p-6 transition-[max-width] duration-200 lg:grid-cols-[16rem_1fr]',
        wide ? 'max-w-[110rem]' : 'max-w-6xl',
      )}
    >
      {/* On narrow screens the work comes first and the history follows it. */}
      <aside className="order-2 space-y-3 lg:order-1">
        <h1 className="flex items-center gap-2 px-3 font-semibold lg:px-0">
          <FileText className="size-5 text-accent" />
          SecretSource
        </h1>
        <p className="px-3 text-sm text-ink-muted lg:px-0">
          Checks whether the sources a paper cites actually support what it claims.
        </p>
        <HistoryList analyses={analyses.data ?? []} selected={selected} onSelect={select} />
      </aside>

      <main className="order-1 space-y-6 lg:order-2">
        <SubmitForm onStarted={select} />
        <AnalysisView key={selected ?? 'none'} id={selected} onTargetChange={setWide} />
      </main>
    </div>
  )
}
