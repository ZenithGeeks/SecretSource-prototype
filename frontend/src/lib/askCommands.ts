/**
 * The Ask panel's /commands. Each runs one data tool of the screen agent
 * (backend/app/agents/data_tools.py) through POST /agent/tools/{name}. `/` lists the commands and
 * `@` lists the reader's papers, so a command can name one: `/get_claim @Lost in the Middle 2`.
 */

import type { Statement, StatementVerdict } from './assistant'

export type Command = {
  name: string
  /** What goes after the name, shown in the menu. */
  hint: string
  summary: string
  /** Takes a paper: an @mention, or the paper that is open. Sent as analysis_id. */
  paper?: boolean
  /** The tool's argument for a number at the end of the line. */
  number?: string
  /** The tool's argument for the rest of the line. */
  text?: string
}

export const COMMANDS: Command[] = [
  { name: 'check_text', hint: 'text', summary: 'Judge each sentence against your papers', text: 'text' },
  { name: 'find_support', hint: 'claim', summary: 'Passages in your papers that bear on a claim', text: 'claim' },
  { name: 'search_claims', hint: 'words', summary: 'Find claims by their words', text: 'query' },
  { name: 'get_analysis', hint: '@paper', summary: 'Each claim of a paper and where it stands', paper: true },
  { name: 'get_claim', hint: '@paper number', summary: 'The evidence behind one claim', paper: true, number: 'claim_number' },
  { name: 'find_in_paper', hint: '@paper text', summary: 'The page where some text sits', paper: true, text: 'text' },
  { name: 'bibtex', hint: '@paper', summary: 'BibTeX for a paper and the works it cites', paper: true },
  { name: 'get_gaps', hint: '', summary: 'What your library leaves open' },
  { name: 'submit_analysis', hint: 'DOI, arXiv ID or URL', summary: 'Start checking a paper', text: 'paper' },
  { name: 'labeling_progress', hint: '@paper', summary: 'Your progress labeling a paper', paper: true },
]

/** A paper the reader can name with @. */
export type PaperRef = { id: string; label: string }

/** The commands whose names start with what follows the slash, while the draft is only that. */
export function matchCommands(draft: string): Command[] {
  const typed = /^\/(\w*)$/.exec(draft)
  return typed ? COMMANDS.filter((command) => command.name.startsWith(typed[1])) : []
}

const MENTION_LIMIT = 6

/** The papers whose label contains what follows the last @, when the draft ends with it. */
export function matchPapers(draft: string, papers: PaperRef[]): PaperRef[] {
  const typed = /@([^@]*)$/.exec(draft)
  if (!typed) return []
  const query = typed[1].toLowerCase()
  return papers.filter((paper) => paper.label.toLowerCase().includes(query)).slice(0, MENTION_LIMIT)
}

/** The draft with the @ being typed replaced by the paper's name. */
export const withMention = (draft: string, paper: PaperRef) => draft.replace(/@[^@]*$/, `@${paper.label} `)

export type Parsed = { name: string; args: Record<string, string | number> } | { error: string }

/** A `/command` line as the tool's arguments, or what is wrong with it. `open` is the analysis the
 * reader has open, which stands in when no paper is named. */
export function parseCommand(draft: string, papers: PaperRef[], open?: string): Parsed {
  const line = /^\/(\w+)\s*([\s\S]*)$/.exec(draft.trim())
  const command = COMMANDS.find((candidate) => candidate.name === line?.[1])
  if (!line || !command) return { error: `There is no /${line?.[1] ?? ''} command. Type / to see them.` }
  const args: Record<string, string | number> = {}
  let rest = line[2]
  if (command.paper) {
    // The longest label first, so "Attention" does not take "Attention Is All You Need".
    const named = [...papers].sort((a, b) => b.label.length - a.label.length).find((paper) => rest.includes(`@${paper.label}`))
    const id = named?.id ?? open
    if (!id) return { error: `Name a paper with @, for example /${command.name} @${papers[0]?.label ?? 'Paper'}` }
    args.analysis_id = id
    if (named) rest = rest.replace(`@${named.label}`, '')
  }
  if (command.number) {
    const last = /(\d+)\s*$/.exec(rest)
    if (!last) return { error: `Add the claim number, for example /${command.name} @${papers[0]?.label ?? 'Paper'} 2` }
    args[command.number] = Number(last[1])
    rest = rest.slice(0, last.index)
  }
  if (command.text) {
    if (!rest.trim()) return { error: `Add the ${command.hint.replace('@paper ', '')} after /${command.name}.` }
    args[command.text] = rest.trim()
  }
  return { name: command.name, args }
}

type Row = Record<string, unknown>

export type Standing = 'backed' | 'silent' | 'contradicted' | 'unchecked'

/** A claim in a list: its number in its paper, where it stands, and the paper when the list mixes several. */
export type ClaimRow = { number: number; claim: string; standing: Standing; paper?: string }

/** What a command's answer looks like in the panel (components/CommandResult). */
export type CommandView =
  | { kind: 'claims'; title?: string; status?: string; message?: string; tally?: Record<Standing, number>; claims: ClaimRow[]; highlight?: string[] }
  | {
      kind: 'claim'
      number: number
      claim: string
      sentence: string
      standing: Standing
      verdicts: { cited: string; verdict: StatementVerdict; quote: string; reasoning: string }[]
      unchecked: { source: string; reason: string }[]
    }
  | { kind: 'gaps'; notBacked: number; contradicted: number; missing: number }
  | { kind: 'page'; page: number | null }
  | { kind: 'progress'; saved: number; claims: number; reviewed: number; next: { number: number; claim: string } | null }
  | { kind: 'code'; text: string }
  | { kind: 'started'; id: string }
  | { kind: 'message'; text: string }

type Shown = { statements?: Statement[]; view?: CommandView; note?: string }

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
const rows = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : [])
const claimRow = (row: Row, paper?: string): ClaimRow => ({
  number: Number(row.number),
  claim: text(row.claim),
  standing: (text(row.standing) || 'unchecked') as Standing,
  paper,
})

/** The words of a search, for marking them in the claims it found. */
const words = (query: unknown) => (text(query).toLowerCase().match(/\w{3,}/g) ?? []).filter((word, at, all) => all.indexOf(word) === at)

/** The tool's result as statements for the chat, or as a view or a note when it is not a list of statements. */
export function describeResult(name: string, result: Row, args: Record<string, string | number> = {}): Shown {
  if (result.status === 'error') return { view: { kind: 'message', text: text(result.message) } }
  switch (name) {
    case 'check_text': {
      const checked = rows(result.results)
      const left = Number(result.not_checked) || 0
      return {
        statements: checked.map((row, index) => statement(index, row, 'text', 'source')),
        note: left ? `${left} more sentences were not checked: the limit is 6.` : checked.length ? undefined : 'No sentence long enough to check.',
      }
    }
    case 'find_support': {
      const passages = rows(result.passages)
      return passages.length
        ? { statements: passages.map((row, index) => statement(index, row, 'text', 'paper')) }
        : { view: { kind: 'message', text: 'No passage in your papers bears on this.' } }
    }
    case 'get_analysis':
      return {
        view: {
          kind: 'claims',
          title: text(result.title),
          status: text(result.status),
          message: text(result.message),
          tally: result.standing as Record<Standing, number>,
          claims: rows(result.claims).map((row) => claimRow(row)),
        },
      }
    case 'get_claim':
      return {
        view: {
          kind: 'claim',
          number: Number(result.number),
          claim: text(result.claim),
          sentence: text(result.sentence),
          standing: (text(result.standing) || 'unchecked') as Standing,
          verdicts: rows(result.verdicts).map((v) => ({
            cited: text(v.cited),
            verdict: (text(v.verdict) || 'unchecked') as StatementVerdict,
            quote: text(v.quote),
            reasoning: text(v.reasoning),
          })),
          unchecked: rows(result.unchecked).map((u) => ({ source: text(u.source), reason: text(u.reason) })),
        },
      }
    case 'search_claims': {
      const found = rows(result.claims)
      return found.length
        ? { view: { kind: 'claims', claims: found.map((row) => claimRow(row, text(row.title))), highlight: words(args.query) } }
        : { view: { kind: 'message', text: 'No claim shares those words.' } }
    }
    case 'find_in_paper':
      return { view: { kind: 'page', page: typeof result.page === 'number' ? result.page : null } }
    case 'get_gaps':
      return { view: { kind: 'gaps', notBacked: count(result.notBacked), contradicted: count(result.contradicted), missing: count(result.missing) } }
    case 'bibtex':
      return { view: { kind: 'code', text: text(result.bibtex) } }
    case 'submit_analysis':
      return { view: { kind: 'started', id: text(result.id) } }
    case 'labeling_progress': {
      const next = result.next_unsaved as Row | null
      return {
        view: {
          kind: 'progress',
          saved: Number(result.saved),
          claims: Number(result.claims),
          reviewed: Number(result.reviewed),
          next: next ? { number: Number(next.number), claim: text(next.claim) } : null,
        },
      }
    }
    default:
      return { note: JSON.stringify(result, null, 2) }
  }
}

function statement(index: number, row: Row, textKey: string, sourceKey: string): Statement {
  return {
    index,
    text: text(row[textKey]),
    source: text(row[sourceKey]),
    page: typeof row.page === 'number' ? row.page : undefined,
    verdict: (text(row.verdict) || undefined) as StatementVerdict | undefined,
    quote: text(row.quote) || undefined,
    reasoning: text(row.reasoning) || undefined,
  }
}
