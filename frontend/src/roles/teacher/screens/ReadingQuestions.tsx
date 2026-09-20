import { BookOpen, Copy, Download, Edit3, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Empty } from '../../../components/ui'
import { downloadText } from '../../../lib/csv'
import { filterReadingQuestions, worksheetText } from '../../../lib/teacherSelectors'
import type { ReadingQuestionLevel, ReadingQuestionType, TeacherReadingQuestion } from '../../../lib/teacher'
import { useDeleteReadingQuestion, useRegenerateReadingQuestions, useTeacherReadingQuestions, useUpdateReadingQuestion } from '../../../lib/useTeacher'
import { Breadcrumbs, LoadingState, PageHeading, StatusPill } from '../components/TeacherUi'
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
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Library' }, { label: 'Reading questions' }]} />
      <PageHeading
        title="Reading questions"
        description={`${data.paper.title} · ${data.paper.citation} · ${data.paper.verifiedClaims} verified claims`}
        actions={(
          <>
            <Button type="button" variant="ghost" onClick={() => { downloadText(`${data.paper.title.toLowerCase()}-worksheet.txt`, worksheetText({ ...data, questions: visible }, false), 'text/plain;charset=utf-8'); announce('Worksheet exported locally.') }}><Download className="size-4" />Export worksheet</Button>
            <Button type="button" onClick={() => regenerate.mutate({ paperId: data.paper.id, level, types }, { onSuccess: () => announce('Questions regenerated locally.') })} disabled={regenerate.isPending || types.length === 0}><RefreshCw className={regenerate.isPending ? 'size-4 animate-spin' : 'size-4'} />{regenerate.isPending ? 'Regenerating...' : 'Regenerate'}</Button>
          </>
        )}
      />

      <Card className="flex flex-col gap-4 bg-accent-soft/25 sm:flex-row sm:items-center"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-accent"><BookOpen className="size-5" /></span><div className="min-w-0"><p className="truncate font-serif text-xl font-semibold">{data.paper.fileName}</p><p className="mt-1 text-sm text-ink-muted">Questions are generated from the local verified paper record. Open in paper uses page anchors only.</p></div><StatusPill label={`${visible.length} shown`} tone="accent" /></Card>

      {notice && <div role="status" className="rounded-lg bg-supports-soft px-4 py-3 text-sm text-supports">{notice}</div>}
      <Card className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Level</p><div className="mt-3 flex flex-wrap gap-2">{(['undergrad', 'graduate'] as ReadingQuestionLevel[]).map((item) => <FilterButton key={item} active={level === item} onClick={() => setLevel(item)}>{item === 'undergrad' ? 'Undergrad' : 'Graduate'}</FilterButton>)}</div></div><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Type</p><div className="mt-3 flex flex-wrap gap-2">{(['comprehension', 'critique', 'discussion'] as ReadingQuestionType[]).map((item) => <FilterButton key={item} active={types.includes(item)} onClick={() => setFilterType(item)}>{item[0]!.toUpperCase() + item.slice(1)}</FilterButton>)}</div></div></Card>

      <section className="space-y-4" aria-labelledby="question-list-heading"><div className="flex items-end justify-between gap-3"><div><h2 id="question-list-heading" className="font-serif text-2xl font-semibold">Questions</h2><p className="mt-1 text-sm text-ink-muted">Edit wording, inspect the source passage, or remove a question from this worksheet.</p></div><span className="text-xs text-ink-muted">{visible.length} of {data.questions.length}</span></div>{visible.length === 0 ? <Empty title="No questions match these filters" hint="Choose another level or turn on a question type." /> : visible.map((question, index) => <QuestionCard key={question.id} question={question} number={index + 1} onEdit={() => beginEdit(question)} onRemove={() => setRemoving(question)} onShow={() => openPaper(question)} />)}</section>

      <Card><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">Answer key</p><h2 className="mt-1 font-serif text-2xl font-semibold">Teacher notes</h2><p className="mt-1 text-sm text-ink-muted">Answers stay separate from the student worksheet.</p></div><Button type="button" variant="ghost" onClick={() => void copy(worksheetText({ ...data, questions: visible }, true), 'Answer key copied locally.')}><Copy className="size-4" />Copy answer key</Button></div><div className="mt-5 divide-y divide-border-subtle">{visible.map((question) => <div key={question.id} className="py-3 first:pt-0 last:pb-0"><p className="text-sm font-medium">{question.prompt}</p><p className="mt-1 text-sm leading-6 text-ink-muted">{question.answer ?? 'No answer key available.'}</p></div>)}</div></Card>

      <TeacherDialog open={Boolean(editing)} title="Edit reading question" description="Only this local question's prompt and answer key will change." onClose={() => setEditing(null)}><div className="space-y-4"><label className="block text-sm font-medium">Question<textarea value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} rows={4} className="mt-2 w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm leading-6" /></label><label className="block text-sm font-medium">Answer key<textarea value={draft.answer} onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))} rows={3} className="mt-2 w-full rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm leading-6" /></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="button" onClick={save} disabled={update.isPending || !draft.prompt.trim()}>{update.isPending ? 'Saving...' : 'Save question'}</Button></div></div></TeacherDialog>
      <TeacherDialog open={Boolean(removing)} title="Remove this question?" description="The question will be removed from the local worksheet and answer key." onClose={() => setRemoving(null)}><div className="rounded-lg bg-canvas p-3 text-sm leading-6 text-ink-muted">{removing?.prompt}</div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRemoving(null)} disabled={remove.isPending}>Keep question</Button><Button type="button" className="bg-refutes hover:opacity-90" onClick={confirmRemove} disabled={remove.isPending}><Trash2 className="size-4" />{remove.isPending ? 'Removing...' : 'Remove'}</Button></div></TeacherDialog>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={active ? 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white' : 'rounded-full border border-border-subtle px-3 py-1.5 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent'}>{children}</button>
}

function QuestionCard({ question, number, onEdit, onRemove, onShow }: { question: TeacherReadingQuestion; number: number; onEdit: () => void; onRemove: () => void; onShow: () => void }) {
  return <Card className="space-y-4"><div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{number}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusPill label={question.type} tone={question.type === 'critique' ? 'warning' : question.type === 'discussion' ? 'accent' : 'success'} /><span className="text-xs text-ink-muted">{question.level}</span></div><h3 className="mt-3 text-base font-semibold leading-6">{question.prompt}</h3></div></div><div className="rounded-lg bg-canvas p-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">{question.anchor}</p>{question.excerpt ? <p className="mt-2 text-sm italic leading-6 text-ink-muted">{question.excerpt}</p> : <p className="mt-2 text-sm text-ink-muted">No passage excerpt available.</p>}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4"><button type="button" onClick={onShow} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"><ExternalLink className="size-3.5" />Show in paper</button><div className="flex gap-2"><Button type="button" variant="ghost" onClick={onEdit}><Edit3 className="size-4" />Edit</Button><Button type="button" variant="ghost" className="text-refutes hover:bg-refutes-soft" onClick={onRemove}><Trash2 className="size-4" />Remove</Button></div></div></Card>
}
