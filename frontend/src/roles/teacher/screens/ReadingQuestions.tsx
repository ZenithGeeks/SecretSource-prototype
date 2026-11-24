import { Copy, Download, Edit3, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty, TextButton, Textarea } from '../../../components/ui'
import { downloadText } from '../../../lib/csv'
import { filterReadingQuestions, worksheetText } from '../../../lib/teacherSelectors'
import type { ReadingQuestionLevel, ReadingQuestionType, TeacherReadingQuestion } from '../../../lib/teacher'
import { useDeleteReadingQuestion, useRegenerateReadingQuestions, useTeacherReadingQuestions, useUpdateReadingQuestion } from '../../../lib/useTeacher'
import { LoadingState, StatusPill } from '../components/TeacherUi'
import { TeacherDialog } from '../components/TeacherDialog'

export function ReadingQuestions({ paperId }: { paperId?: string }) {
  const page = useTeacherReadingQuestions(paperId)
  const regenerate = useRegenerateReadingQuestions()
  const update = useUpdateReadingQuestion()
  const remove = useDeleteReadingQuestion()
  const [level, setLevel] = useState<ReadingQuestionLevel>('undergrad')
  const [types, setTypes] = useState<ReadingQuestionType[]>(['comprehension', 'critique', 'discussion'])
  const [editing, setEditing] = useState<TeacherReadingQuestion | null>(null)
  const [removing, setRemoving] = useState<TeacherReadingQuestion | null>(null)
  const [draft, setDraft] = useState({ prompt: '', answer: '' })
  const [notice, setNotice] = useState('')

  if (page.isPending) return <LoadingState label="Loading reading questions..." />
  if (page.isError || !page.data) return <Empty title="Reading questions unavailable" hint="Choose a paper from Home and try again." />

  const data = page.data
  const visible = filterReadingQuestions(data.questions, level, types)
  const setFilterType = (type: ReadingQuestionType) => setTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])
  const announce = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }
  const copy = async (text: string, message: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      announce(message)
    } catch {
      announce('Copy is unavailable in this browser.')
    }
  }
  const openPaper = (question: TeacherReadingQuestion) => window.open(`${data.paper.paperUrl}#page=${question.page}`, '_blank', 'noopener,noreferrer')
  const beginEdit = (question: TeacherReadingQuestion) => {
    setEditing(question)
    setDraft({ prompt: question.prompt, answer: question.answer ?? '' })
  }
  const save = () => {
    if (!editing || !draft.prompt.trim()) return
    update.mutate({ id: editing.id, prompt: draft.prompt.trim(), answer: draft.answer.trim() }, {
      onSuccess: () => {
        setEditing(null)
        announce('Question updated locally.')
      },
    })
  }
  const confirmRemove = () => {
    if (!removing) return
    remove.mutate(removing.id, {
      onSuccess: () => {
        setRemoving(null)
        announce('Question removed locally.')
      },
    })
  }

  return (
    <div className="mx-auto w-full max-w-310 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-subtle pb-5">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-widest text-accent">Built from {data.paper.verifiedClaims} checked claims</p>
          <h1 className="mt-1 font-serif text-[30px] leading-9 font-semibold tracking-tight text-ink">Reading questions <span className="text-ink-muted">· {data.paper.title}</span></h1>
          <p className="mt-1 max-w-3xl text-ui leading-5 text-ink-muted">{data.paper.citation}. Every answer points to a page in the paper, so grading is a page check.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => regenerate.mutate({ paperId: data.paper.id, level, types }, { onSuccess: () => announce('Questions regenerated locally.') })} disabled={regenerate.isPending || types.length === 0}><RefreshCw className={regenerate.isPending ? 'size-4 animate-spin' : 'size-4'} />{regenerate.isPending ? 'Regenerating...' : 'Regenerate'}</Button>
          <Button type="button" onClick={() => { downloadText(`${data.paper.title.toLowerCase()}-worksheet.txt`, worksheetText({ ...data, questions: visible }, false), 'text/plain;charset=utf-8'); announce('Worksheet exported locally.') }}><Download className="size-4" />Export worksheet</Button>
        </div>
      </header>

      {notice && <div role="status" className="rounded-lg bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2"><span className="text-caption font-medium text-ink-muted">Level</span><div className="flex items-center rounded-lg bg-ink p-0.5">{(['undergrad', 'graduate'] as ReadingQuestionLevel[]).map((item) => <FilterButton key={item} active={level === item} onClick={() => setLevel(item)} segmented>{item === 'undergrad' ? 'Undergraduate' : 'Graduate'}</FilterButton>)}</div></div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-caption font-medium text-ink-muted">Type</span>{(['comprehension', 'critique', 'discussion'] as ReadingQuestionType[]).map((item) => <FilterButton key={item} active={types.includes(item)} onClick={() => setFilterType(item)}>{item[0]!.toUpperCase() + item.slice(1)}</FilterButton>)}</div>
        <span className="ml-auto text-xs text-ink-muted">{visible.length} questions</span>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-3">
          {visible.length === 0 ? <Empty title="No questions match these filters" hint="Choose another level or turn on a question type." /> : visible.map((question, index) => <QuestionCard key={question.id} question={question} number={index + 1} onEdit={() => beginEdit(question)} onRemove={() => setRemoving(question)} onShow={() => openPaper(question)} />)}
        </section>

        <aside className="xl:sticky xl:top-5">
          <Card className="p-4">
            <h2 className="font-serif text-[17px] font-semibold">Answer key</h2>
            <p className="mt-2 text-ui leading-5 text-ink-muted">Each answer is the paper's own passage, so grading is a page check, not a judgment call.</p>
            <div className="mt-3 divide-y divide-border-subtle">{visible.map((question, index) => <div key={question.id} className="py-3 first:pt-0 last:pb-0"><p className="text-caption leading-4.5"><span className="font-semibold text-accent">Q{index + 1}</span><span className="text-ink-muted"> &nbsp;{question.anchor} — {question.answer ?? 'No answer key available.'}</span></p></div>)}</div>
            <Button type="button" variant="ghost" className="mt-2 px-0 text-xs" onClick={() => void copy(worksheetText({ ...data, questions: visible }, true), 'Answer key copied locally.')}><Copy className="size-4" />Copy answer key</Button>
          </Card>
        </aside>
      </div>

      <TeacherDialog open={Boolean(editing)} title="Edit reading question" description="Only this local question's prompt and answer key will change." onClose={() => setEditing(null)}>
        <div className="space-y-4"><label className="block text-sm font-medium">Question<Textarea value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} rows={4} className="mt-2 leading-6" /></label><label className="block text-sm font-medium">Answer key<Textarea value={draft.answer} onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))} rows={3} className="mt-2 leading-6" /></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="button" onClick={save} disabled={update.isPending || !draft.prompt.trim()}>{update.isPending ? 'Saving...' : 'Save question'}</Button></div></div>
      </TeacherDialog>
      <TeacherDialog open={Boolean(removing)} title="Remove this question?" description="The question will be removed from the local worksheet and answer key." onClose={() => setRemoving(null)}>
        <div className="rounded-lg bg-canvas p-3 text-sm leading-6 text-ink-muted">{removing?.prompt}</div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRemoving(null)} disabled={remove.isPending}>Keep question</Button><Button type="button" className="bg-refutes hover:opacity-90" onClick={confirmRemove} disabled={remove.isPending}><Trash2 className="size-4" />{remove.isPending ? 'Removing...' : 'Remove'}</Button></div>
      </TeacherDialog>
    </div>
  )
}

function FilterButton({ active, onClick, children, segmented = false }: { active: boolean; onClick: () => void; children: string; segmented?: boolean }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={segmented ? active ? 'rounded-md bg-surface px-3 py-1.5 text-caption font-medium text-ink shadow-sm' : 'rounded-md px-3 py-1.5 text-caption font-medium text-surface/75 hover:text-surface' : active ? 'rounded-full bg-accent-soft px-3 py-1.5 text-caption font-medium text-accent' : 'rounded-full border border-border-subtle px-3 py-1.5 text-caption font-medium text-ink-muted hover:border-accent hover:text-accent'}>{children}</button>
}

function QuestionCard({ question, number, onEdit, onRemove, onShow }: { question: TeacherReadingQuestion; number: number; onEdit: () => void; onRemove: () => void; onShow: () => void }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-xs font-medium text-ink-muted">{number}</span><StatusPill label={question.type} tone={question.type === 'critique' ? 'warning' : question.type === 'discussion' ? 'warning' : 'success'} /><span className="text-caption text-accent">anchored to {question.anchor}</span></div>
      <h3 className="pl-5 text-sm leading-5.5 text-ink">{question.prompt}</h3>
      {question.excerpt && <p className="border-l border-border-subtle pl-3 font-serif text-[12px] leading-5 italic text-ink-muted">“{question.excerpt}”</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3"><TextButton onClick={onShow} className="inline-flex items-center gap-1.5 text-xs"><ExternalLink className="size-3.5" />Show in paper</TextButton><div className="flex gap-1"><Button type="button" variant="ghost" onClick={onEdit}><Edit3 className="size-4" />Edit</Button><Button type="button" variant="ghost" className="text-refutes hover:bg-refutes-soft" onClick={onRemove}><Trash2 className="size-4" />Remove</Button></div></div>
    </Card>
  )
}
