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
type Shown = { statements?: Statement[]; note?: string }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The tool's result as statements for the chat, or a note when it is not a list of statements. */
export function describeResult(name: string, result: Row): Shown {
  if (result.status === 'error') return { note: text(result.message) }
  switch (name) {
    case 'check_text': {
      const rows = (result.results as Row[]) ?? []
      const left = Number(result.not_checked) || 0
      return {
        statements: rows.map((row, index) => statement(index, row, 'text', 'source')),
        note: left ? `${left} more sentences were not checked: the limit is 6.` : rows.length ? undefined : 'No sentence long enough to check.',
      }
    }
    case 'find_support': {
      const rows = (result.passages as Row[]) ?? []
      return rows.length
        ? { statements: rows.map((row, index) => statement(index, row, 'text', 'paper')) }
        : { note: 'No passage in your papers bears on this.' }
    }
    case 'get_analysis': {
      const claims = (result.claims as Row[]) ?? []
      const tally = Object.entries((result.standing as Row) ?? {}).map(([standing, count]) => `${count} ${standing}`)
      const why = text(result.message) ? `: ${text(result.message)}` : ''
      return {
        note: [
          `${text(result.title)} · ${text(result.status)}${why}`,
          tally.join(' · '),
          '',
          ...claims.map((claim) => `${claim.number}. [${text(claim.standing)}] ${text(claim.claim)}`),
        ].join('\n'),
      }
    }
    case 'get_claim': {
      const verdicts = (result.verdicts as Row[]) ?? []
      const unchecked = (result.unchecked as Row[]) ?? []
      return {
        note: [
          `Claim ${result.number} [${text(result.standing)}] ${text(result.claim)}`,
          text(result.sentence),
          ...verdicts.map((v) => `\n${text(v.cited)}: ${text(v.verdict)}\n"${text(v.quote)}"\n${text(v.reasoning)}`),
          ...unchecked.map((u) => `\n${text(u.source)}: not checked (${text(u.reason)})`),
        ].join('\n'),
      }
    }
    case 'search_claims': {
      const claims = (result.claims as Row[]) ?? []
      return {
        note: claims.length
          ? claims.map((c) => `${text(c.title)} #${c.number} [${text(c.standing)}] ${text(c.claim)}`).join('\n')
          : 'No claim shares those words.',
      }
    }
    case 'find_in_paper':
      return { note: result.page ? `Found on page ${result.page}.` : 'That text is not in this paper.' }
    case 'get_gaps':
      return {
        note: `${count(result.notBacked)} claims no cited work backs · ${count(result.contradicted)} contradicted · ${count(result.missing)} works cited but not held`,
      }
    case 'bibtex':
      return { note: text(result.bibtex) }
    case 'submit_analysis':
      return { note: `Started analysis ${text(result.id)}. It runs in the background: see Analyses.` }
    case 'labeling_progress': {
      const next = result.next_unsaved as Row | null
      return {
        note: [
          `Saved ${result.saved} of ${result.claims} claims · reviewed ${result.reviewed}`,
          next ? `Next unsaved: claim ${next.number}, ${text(next.claim)}` : 'Every claim is saved.',
        ].join('\n'),
      }
    }
    default:
      return { note: JSON.stringify(result, null, 2) }
  }
}

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)

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
