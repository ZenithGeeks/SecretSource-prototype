import { Eraser, Highlighter, Loader2, MessageSquareText, Pencil, RotateCw, Save } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react'

import { api, type PaperAnnotation, type PaperAnnotationColor } from '../lib/api'
import { normalizedPoint, normalizedRects, type NormalizedPoint } from '../lib/pdfAnnotations'
import { authEnabled } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { cn } from '../lib/utils'

// This file exports a compound React component whose Toolbar and Page members are consumed together.
/* eslint-disable react/only-export-components */

type Tool = 'highlight' | 'ink' | 'note' | 'eraser'
type NoteDraft = { page: number; x: number; y: number; text: string; id?: string }
type InkDraft = { page: number; points: NormalizedPoint[] }

const COLORS: { value: PaperAnnotationColor; label: string; className: string; fill: string }[] = [
  { value: 'yellow', label: 'yellow', className: 'bg-yellow-400', fill: 'rgba(250, 204, 21, .38)' },
  { value: 'green', label: 'green', className: 'bg-green-500', fill: 'rgba(34, 197, 94, .32)' },
  { value: 'blue', label: 'blue', className: 'bg-blue-500', fill: 'rgba(59, 130, 246, .28)' },
  { value: 'pink', label: 'pink', className: 'bg-pink-500', fill: 'rgba(236, 72, 153, .28)' },
]

type AnnotationContextValue = {
  annotations: PaperAnnotation[]
  color: PaperAnnotationColor
  tool: Tool
  loaded: boolean
  saving: boolean
  error: string | null
  canAnnotate: boolean
  noteDraft: NoteDraft | null
  inkDraft: InkDraft | null
  selectTool: (tool: Tool) => void
  selectColor: (color: PaperAnnotationColor) => void
  add: (annotation: PaperAnnotation) => void
  erase: (id: string) => void
  placeNote: (draft: NoteDraft) => void
  saveNote: () => void
  cancelNote: () => void
  changeNote: (text: string) => void
  beginInk: (page: number, point: NormalizedPoint) => void
  continueInk: (page: number, point: NormalizedPoint) => void
  finishInk: (page: number) => void
  retry: () => void
}

const AnnotationContext = createContext<AnnotationContextValue | null>(null)

function id() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function useAnnotations() {
  const context = useContext(AnnotationContext)
  if (!context) throw new Error('PdfAnnotations child must be inside PdfAnnotations')
  return context
}

function AnnotationProvider({ paper, children }: { paper: string; children: ReactNode }) {
  const { session, loading: authLoading } = useAuth()
  const canAnnotate = authEnabled && !authLoading && Boolean(session)
  return (
    <AnnotationState key={`${paper}:${session?.user.id ?? ''}`} paper={paper} canAnnotate={canAnnotate}>
      {children}
    </AnnotationState>
  )
}

function AnnotationState({ paper, canAnnotate, children }: { paper: string; canAnnotate: boolean; children: ReactNode }) {
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [loadedPaper, setLoadedPaper] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('highlight')
  const [color, setColor] = useState<PaperAnnotationColor>('yellow')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [savedRevision, setSavedRevision] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const [loadRetry, setLoadRetry] = useState(0)
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null)
  const [errorKind, setErrorKind] = useState<'load' | 'save' | null>(null)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const revisionRef = useRef(0)
  const inkDraftRef = useRef<InkDraft | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!canAnnotate) return
    api.getPaperAnnotations(paper)
      .then(({ annotations: current }) => {
        if (cancelled) return
        setAnnotations(current)
        setLoadedPaper(paper)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Could not load annotations')
          setErrorKind('load')
        }
      })
    return () => { cancelled = true }
  }, [paper, canAnnotate, loadRetry])

  const bumpRevision = useCallback(() => {
    const next = revisionRef.current + 1
    revisionRef.current = next
    setRevision(next)
  }, [])

  useEffect(() => {
    if (!canAnnotate || loadedPaper !== paper || revision === savedRevision || error) return
    const queuedRevision = revision
    const snapshot = annotations
    const timer = window.setTimeout(() => {
      setSaving(true)
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(() => api.savePaperAnnotations(paper, snapshot))
        .then(() => {
          if (queuedRevision === revisionRef.current) {
            setSavedRevision(queuedRevision)
            setError(null)
            setErrorKind(null)
          }
        })
        .catch((reason: unknown) => {
          if (queuedRevision === revisionRef.current) {
            setError(reason instanceof Error ? reason.message : 'Could not save annotations')
            setErrorKind('save')
          }
        })
        .finally(() => setSaving(false))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [annotations, canAnnotate, error, loadedPaper, paper, revision, retryCount, savedRevision])

  const add = useCallback((annotation: PaperAnnotation) => {
    setAnnotations((current) => [...current, annotation])
    bumpRevision()
    setError(null)
    setErrorKind(null)
  }, [bumpRevision])
  const erase = useCallback((annotationId: string) => {
    setAnnotations((current) => current.filter((item) => item.id !== annotationId))
    bumpRevision()
    setError(null)
    setErrorKind(null)
  }, [bumpRevision])
  const saveNote = useCallback(() => {
    if (!noteDraft?.text.trim()) return
    const annotation: PaperAnnotation = {
      id: noteDraft.id ?? id(),
      kind: 'note',
      page: noteDraft.page,
      color,
      x: noteDraft.x,
      y: noteDraft.y,
      text: noteDraft.text.trim(),
    }
    if (noteDraft.id) {
      setAnnotations((current) => current.map((item) => item.id === noteDraft.id ? annotation : item))
      bumpRevision()
      setError(null)
      setErrorKind(null)
    } else add(annotation)
    setNoteDraft(null)
  }, [add, bumpRevision, color, noteDraft])
  const beginInk = useCallback((page: number, point: NormalizedPoint) => {
    const draft = { page, points: [point] }
    inkDraftRef.current = draft
    setInkDraft(draft)
  }, [])
  const continueInk = useCallback((page: number, point: NormalizedPoint) => {
    const current = inkDraftRef.current
    if (current?.page !== page) return
    const points = current.points.length < 4500
      ? [...current.points, point]
      : [...current.points.filter((_, index) => index % 2 === 0), point]
    const draft = { ...current, points }
    inkDraftRef.current = draft
    setInkDraft(draft)
  }, [])
  const finishInk = useCallback((page: number) => {
    const current = inkDraftRef.current
    inkDraftRef.current = null
    setInkDraft(null)
    if (current?.page === page && current.points.length > 1) add({ id: id(), kind: 'ink', page, color, points: current.points })
  }, [add, color])
  const value = useMemo<AnnotationContextValue>(() => ({
    annotations,
    color,
    tool,
    loaded: loadedPaper === paper,
    saving,
    error,
    canAnnotate,
    noteDraft,
    inkDraft,
    selectTool: setTool,
    selectColor: setColor,
    add,
    erase,
    placeNote: setNoteDraft,
    saveNote,
    cancelNote: () => setNoteDraft(null),
    changeNote: (text) => setNoteDraft((draft) => draft ? { ...draft, text } : null),
    beginInk,
    continueInk,
    finishInk,
    retry: () => {
      setError(null)
      if (errorKind === 'load') setLoadRetry((count) => count + 1)
      else setRetryCount((count) => count + 1)
    },
  }), [add, annotations, beginInk, canAnnotate, color, continueInk, error, errorKind, erase, finishInk, inkDraft, loadedPaper, noteDraft, paper, saveNote, saving, tool])

  return <AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider>
}

function Toolbar() {
  const { color, tool, loaded, saving, error, canAnnotate, selectTool, selectColor, retry } = useAnnotations()
  const toolButtons: { tool: Tool; label: string; Icon: typeof Highlighter }[] = [
    { tool: 'highlight', label: 'Highlight', Icon: Highlighter },
    { tool: 'ink', label: 'Pen', Icon: Pencil },
    { tool: 'note', label: 'Note', Icon: MessageSquareText },
    { tool: 'eraser', label: 'Eraser', Icon: Eraser },
  ]
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Paper annotations">
      {toolButtons.map(({ tool: value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={tool === value}
          title={label}
          disabled={!canAnnotate || !loaded}
          onClick={() => selectTool(value)}
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent',
            tool === value && 'bg-accent-soft text-accent',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-border-subtle" aria-hidden="true" />
      {COLORS.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-label={`Highlight ${item.label}`}
          aria-pressed={color === item.value}
          title={`${item.label} annotation color`}
          disabled={!canAnnotate || !loaded}
          onClick={() => selectColor(item.value)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={cn('size-4 rounded-full ring-1 ring-black/10', item.className, color === item.value && 'ring-2 ring-ink ring-offset-1')} />
        </button>
      ))}
      <span className={cn('ml-1 min-w-12 text-[10px] text-ink-muted', canAnnotate ? 'hidden md:inline' : 'inline')} role="status" aria-live="polite">
        {!canAnnotate ? 'Sign in to save' : error ? 'Not saved' : saving ? 'Saving…' : loaded ? 'Saved' : 'Loading…'}
      </span>
      {error && canAnnotate && (
        <button type="button" onClick={retry} aria-label="Retry saving annotations" title={error} className="inline-flex size-8 shrink-0 items-center justify-center rounded text-refutes hover:bg-refutes-soft">
          <RotateCw className="size-4" aria-hidden="true" />
        </button>
      )}
      {saving && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
      {!saving && loaded && !error && <Save className="size-3.5 text-supports" aria-hidden="true" />}
    </div>
  )
}

function AnnotationPage({ page }: { page: number }) {
  const context = useAnnotations()
  const { add, canAnnotate, color, loaded, tool } = context
  const pageLayer = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const annotations = context.annotations.filter((item) => item.page === page)
  const pageElement = () => pageLayer.current?.parentElement?.closest<HTMLElement>('[data-page]') ?? null

  useEffect(() => {
    if (tool !== 'highlight' || !canAnnotate || !loaded) return
    const saveSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      const element = pageElement()
      if (!element || !element.contains(range.commonAncestorContainer)) return
      const rects = normalizedRects(Array.from(range.getClientRects()), element.getBoundingClientRect())
      if (rects.length) add({ id: id(), kind: 'highlight', page, color, rects })
    }
    document.addEventListener('mouseup', saveSelection)
    document.addEventListener('keyup', saveSelection)
    return () => {
      document.removeEventListener('mouseup', saveSelection)
      document.removeEventListener('keyup', saveSelection)
    }
  }, [add, canAnnotate, color, loaded, tool, page])

  const pointerPoint = (event: PointerEvent<HTMLDivElement>) => {
    const element = pageElement()
    return element ? normalizedPoint(event.clientX, event.clientY, element.getBoundingClientRect()) : null
  }
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!context.canAnnotate || !context.loaded) return
    if (event.target instanceof HTMLElement && event.target.closest('[data-note-editor]')) return
    const point = pointerPoint(event)
    if (!point) return
    if (context.tool === 'ink') {
      event.preventDefault()
      drawing.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      context.beginInk(page, point)
    } else if (context.tool === 'note') {
      event.preventDefault()
      const note = annotations.find((item) => item.kind === 'note' && item.x !== undefined && item.y !== undefined &&
        Math.abs(item.x - point.x) < 0.07 && Math.abs(item.y - point.y) < 0.06)
      context.placeNote({
        page,
        x: note?.x ?? point.x,
        y: note?.y ?? point.y,
        text: note?.text ?? '',
        id: note?.id,
      })
    }
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing.current || context.tool !== 'ink') return
    const point = pointerPoint(event)
    if (point) context.continueInk(page, point)
  }
  const handlePointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    context.finishInk(page)
  }

  const noteDraft = context.noteDraft?.page === page ? context.noteDraft : null
  const annotationStyle = (item: PaperAnnotation) => ({
    left: `${(item.x ?? 0) * 100}%`,
    top: `${(item.y ?? 0) * 100}%`,
  })
  return (
    <div
      ref={pageLayer}
      aria-label={`Annotations on page ${page}`}
      className={cn('absolute inset-0 z-10', context.tool === 'ink' || context.tool === 'note' ? 'pointer-events-auto' : 'pointer-events-none')}
      style={{ touchAction: context.tool === 'ink' ? 'none' : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {annotations.flatMap((annotation) => {
        if (annotation.kind === 'highlight') {
          const markColor = COLORS.find((item) => item.value === annotation.color) ?? COLORS[0]
          return (annotation.rects ?? []).map((rect, index) => (
            context.tool === 'eraser' ? (
              <button
                key={`${annotation.id}-${index}`}
                type="button"
                aria-label={`Remove annotation on page ${page}`}
                title="Erase this highlight"
                onClick={() => context.erase(annotation.id)}
                className="pointer-events-auto absolute cursor-crosshair rounded-sm ring-1 ring-red-500/40"
                style={{ left: `${rect.x0 * 100}%`, top: `${rect.y0 * 100}%`, width: `${(rect.x1 - rect.x0) * 100}%`, height: `${(rect.y1 - rect.y0) * 100}%`, backgroundColor: markColor.fill }}
              />
            ) : (
              <div
                key={`${annotation.id}-${index}`}
                aria-hidden="true"
                className="pointer-events-none absolute rounded-sm"
                style={{ left: `${rect.x0 * 100}%`, top: `${rect.y0 * 100}%`, width: `${(rect.x1 - rect.x0) * 100}%`, height: `${(rect.y1 - rect.y0) * 100}%`, backgroundColor: markColor.fill }}
              />
            )
          ))
        }
        if (annotation.kind === 'note') {
          return context.tool === 'eraser' ? (
            <button
              key={annotation.id}
              type="button"
              aria-label={`Remove annotation on page ${page}`}
              onClick={() => context.erase(annotation.id)}
              className="pointer-events-auto absolute max-w-[35%] cursor-crosshair whitespace-pre-wrap break-words bg-transparent text-left text-sm leading-5 text-ink line-through decoration-refutes"
              style={annotationStyle(annotation)}
            >
              {annotation.text}
            </button>
          ) : (
            <div key={annotation.id} aria-hidden="true" className="pointer-events-none absolute max-w-[35%] whitespace-pre-wrap break-words bg-transparent text-sm leading-5 text-ink" style={annotationStyle(annotation)}>
              {annotation.text}
            </div>
          )
        }
        const points = annotation.points ?? []
        const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 100},${point.y * 100}`).join(' ')
        const markColor = COLORS.find((item) => item.value === annotation.color) ?? COLORS[0]
        return [
          <svg key={annotation.id} className={cn('absolute inset-0 size-full overflow-visible', context.tool === 'eraser' ? 'pointer-events-auto' : 'pointer-events-none')} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden={context.tool !== 'eraser'}>
            <path
              d={path}
              fill="none"
              stroke={markColor.fill.replace(/, [\d.]+\)/, ', 1)')}
              strokeWidth={context.tool === 'eraser' ? 4 : 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents={context.tool === 'eraser' ? 'stroke' : 'none'}
              role={context.tool === 'eraser' ? 'button' : undefined}
              aria-label={context.tool === 'eraser' ? `Remove annotation on page ${page}` : undefined}
              tabIndex={context.tool === 'eraser' ? 0 : undefined}
              onClick={() => context.tool === 'eraser' && context.erase(annotation.id)}
              onKeyDown={(event) => {
                if (context.tool === 'eraser' && (event.key === 'Enter' || event.key === ' ')) context.erase(annotation.id)
              }}
            />
          </svg>,
        ]
      })}
      {context.inkDraft?.page === page && context.inkDraft.points.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path
            d={context.inkDraft.points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 100},${point.y * 100}`).join(' ')}
            fill="none"
            stroke={(COLORS.find((item) => item.value === context.color) ?? COLORS[0]).fill.replace(/, [\d.]+\)/, ', 1)')}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {noteDraft && (
        <div
          data-note-editor
          className="pointer-events-auto absolute z-20 flex w-52 flex-col gap-1"
          style={{ left: `${noteDraft.x * 100}%`, top: `${noteDraft.y * 100}%` }}
        >
          <textarea
            autoFocus
            aria-label={`Note text on page ${page}`}
            maxLength={2000}
            value={noteDraft.text}
            onChange={(event) => context.changeNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') context.cancelNote()
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) context.saveNote()
            }}
            className="min-h-16 resize rounded bg-transparent p-1 text-sm leading-5 text-ink shadow-[0_1px_4px_rgba(15,23,42,.25)] outline-none placeholder:text-ink-muted focus:ring-1 focus:ring-accent"
            placeholder="Write a note…"
          />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={context.cancelNote} className="rounded bg-surface/90 px-2 py-1 text-xs text-ink-muted">Cancel</button>
            <button type="button" onClick={context.saveNote} disabled={!noteDraft.text.trim()} className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50">Save note</button>
          </div>
        </div>
      )}
    </div>
  )
}

type PdfAnnotationsCompound = ((props: { paper: string; children: ReactNode }) => ReactElement) & {
  Toolbar: typeof Toolbar
  Page: typeof AnnotationPage
}

const PdfAnnotationsRoot = ({ paper, children }: { paper: string; children: ReactNode }) => (
  <AnnotationProvider paper={paper}>{children}</AnnotationProvider>
)

/** Reusable cloud annotation controls and page overlays for any authenticated PDF reader. */
export const PdfAnnotations = Object.assign(PdfAnnotationsRoot, { Toolbar, Page: AnnotationPage }) as PdfAnnotationsCompound
