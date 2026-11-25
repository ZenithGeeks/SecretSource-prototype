/** Reads the markdown of docs/annotation-guideline.md into blocks the Labeler can render.
 * Only what that file uses: headings, paragraphs, lists, tables, and bold, italic and code
 * inside them. Anything else comes through as the text of a paragraph. */

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }

export type Inline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string }

const HEADING = /^(#{1,6})\s+(.*)$/
const ITEM = /^(-|\d+\.)\s+(.*)$/
const TABLE_RULE = /^\|[\s|:-]+\|$/
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/

export function parseGuide(markdown: string): Block[] {
  const blocks: Block[] = []
  let last: Block | undefined
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      last = undefined
      continue
    }
    const heading = HEADING.exec(line)
    const item = ITEM.exec(line)
    if (heading) {
      last = undefined
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2], id: slug(heading[2]) })
    } else if (item) {
      const ordered = item[1] !== '-'
      if (last?.kind !== 'list' || last.ordered !== ordered) blocks.push((last = { kind: 'list', ordered, items: [] }))
      last.items.push(item[2])
    } else if (line.startsWith('|')) {
      if (TABLE_RULE.test(line)) continue
      if (last?.kind !== 'table') blocks.push((last = { kind: 'table', head: cells(line), rows: [] }))
      else last.rows.push(cells(line))
    } else if (last?.kind === 'list' && raw.startsWith(' ')) {
      // An indented line carries on the list item above it.
      last.items[last.items.length - 1] += ` ${line}`
    } else if (last?.kind === 'paragraph') {
      last.text += ` ${line}`
    } else {
      blocks.push((last = { kind: 'paragraph', text: line }))
    }
  }
  return blocks
}

/** Splits a line into plain text and its **bold**, *italic* and `code` runs. */
export function parseInline(text: string): Inline[] {
  return text.split(INLINE).flatMap((part, index): Inline[] => {
    if (!part) return []
    // split() with a capture group puts each match at an odd index.
    if (index % 2 === 0) return [{ kind: 'text', text: part }]
    if (part.startsWith('**')) return [{ kind: 'strong', text: part.slice(2, -2) }]
    if (part.startsWith('`')) return [{ kind: 'code', text: part.slice(1, -1) }]
    return [{ kind: 'em', text: part.slice(1, -1) }]
  })
}

// The sections that tell a labeler what to do. The opening notes, the agreement process and
// anything about the automated judge are for the team, not for labelers.
export const GUIDE_SECTIONS = [
  '1. The task',
  '2. What counts as a claim',
  '3. Claim type',
  '4. Citation intent',
  '5. Evidence: which passages count',
  '6. Comparing the claim with the evidence',
  '7. The four levels',
  '9. Fields the labeler needs to record',
  '10. Hard cases',
  'References',
]

// Shown under a shorter name in the app. A rename belongs in docs/annotation-guideline.md first.
export const RENAMED: Record<string, string> = { 'Fields the labeler needs to record': 'Fields to record' }

/** The markdown under the headings in GUIDE_SECTIONS, without paragraphs about the judge.
 * Builds src/roles/labeler/annotation-guideline.md from docs/annotation-guideline.md, so the
 * team-only text never reaches the browser (tests/labeler-guide.test.tsx has the command).
 * The numbered sections are numbered again from 1, so a left-out section leaves no gap. */
export function labelerGuide(markdown: string): string {
  let shown = false
  const kept = markdown.split(/(?:\r?\n){2,}/).filter((chunk) => {
    const heading = /^#{1,2}\s+(.*)/.exec(chunk)
    if (heading) shown = GUIDE_SECTIONS.includes(heading[1].trim())
    return shown && (heading || !/\bjudge/.test(chunk))
  })
  let number = 0
  const renumbered = kept.map((chunk) =>
    chunk.trim().replace(/^(#{1,2}) \d+\. (.*)/, (_, hashes: string, title: string) => `${hashes} ${++number}. ${RENAMED[title] ?? title}`),
  )
  return `${renumbered.join('\n\n')}\n`
}

function cells(line: string): string[] {
  return line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim())
}

function slug(text: string): string {
  return `guide-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}
