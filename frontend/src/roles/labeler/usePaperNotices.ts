/** Toasts for the papers the viewer added: one when a paper is ready to label, one when its
 * analysis failed and why. In a background tab the title also counts them ("(2) SecretSource")
 * until the viewer comes back. Only papers this tab saw running are announced, so a reload does
 * not repeat old news. */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { usePool } from '../../lib/labeling'

const READY_MS = 8000 // a failure stays until closed: its reason is worth reading

export function usePaperNotices(onOpen: (analysisId: string) => void) {
  const pool = usePool()
  const running = useRef<Set<string> | null>(null) // null until the first answer
  const unseen = useRef(0)
  const title = useRef(document.title)
  const open = useRef(onOpen)
  useEffect(() => {
    open.current = onOpen
  })

  useEffect(() => {
    const base = title.current
    const comeBack = () => {
      if (document.hidden) return
      unseen.current = 0
      document.title = base
    }
    document.addEventListener('visibilitychange', comeBack)
    return () => {
      document.removeEventListener('visibilitychange', comeBack)
      document.title = base
    }
  }, [])

  useEffect(() => {
    const papers = pool.data?.papers
    if (!papers) return
    for (const paper of papers) {
      if (!running.current?.has(paper.analysis_id) || paper.status === 'running') continue
      // The analysis id as the toast id: a second answer about the same paper replaces the first.
      if (paper.status === 'error') {
        toast.error('Could not analyse a paper you added', {
          id: paper.analysis_id,
          description: `${paper.title}. ${paper.reason || 'The analysis stopped.'} You can retry it from the paper list.`,
          duration: Infinity,
          closeButton: true,
        })
      } else {
        toast.success('Ready to label', {
          id: paper.analysis_id,
          description: paper.title,
          duration: READY_MS,
          action: { label: 'Open', onClick: () => open.current(paper.analysis_id) },
        })
      }
      if (document.hidden) {
        unseen.current += 1
        document.title = `(${unseen.current}) ${title.current}`
      }
    }
    running.current = new Set(papers.filter((p) => p.mine && p.status === 'running').map((p) => p.analysis_id))
  }, [pool.data])
}
