/**
 * A small BibTeX reader and writer: enough for the Author screens to list keys, find
 * duplicates and missing DOIs, merge new entries into a .bib and build a references list for
 * the preview. Not a full BibTeX parser — @string, @preamble and concatenation are ignored.
 */

export type BibEntry = {
  type: string // "article", "inproceedings" — lowercased
  key: string
  fields: Record<string, string> // field names lowercased, values without their outer braces/quotes
  line: number // 1-based line of the "@type{key,"
}

/** Reads the entries of a .bib file in order. Malformed entries are skipped, not thrown. */
export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  const at = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g
  let match: RegExpExecArray | null
  while ((match = at.exec(text))) {
    const type = match[1].toLowerCase()
    if (type === 'comment' || type === 'string' || type === 'preamble') continue
    const bodyStart = match.index + match[0].length
    const bodyEnd = findClosing(text, match.index + match[0].search(/[{(]/))
    if (bodyEnd < 0) break
    const body = text.slice(bodyStart, bodyEnd)
    entries.push({
      type,
      key: match[2],
      fields: parseFields(body),
      line: text.slice(0, match.index).split('\n').length,
    })
    at.lastIndex = bodyEnd + 1
  }
  return entries
}

/** Index of the brace that closes the one at `open`, or -1. Nested braces are balanced. */
function findClosing(text: string, open: number): number {
  const opener = text[open]
  const closer = opener === '(' ? ')' : '}'
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === opener) depth += 1
    else if (ch === closer) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0
  while (i < body.length) {
    const rest = body.slice(i)
    const head = rest.match(/^\s*(\w+)\s*=\s*/)
    if (!head) break
    i += head[0].length
    const name = head[1].toLowerCase()
    let value = ''
    if (body[i] === '{') {
      const end = findClosing(body, i)
      if (end < 0) break
      value = body.slice(i + 1, end)
      i = end + 1
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1)
      if (end < 0) break
      value = body.slice(i + 1, end)
      i = end + 1
    } else {
      const bare = body.slice(i).match(/^[^,\n]*/)
      value = bare ? bare[0].trim() : ''
      i += bare ? bare[0].length : 0
    }
    fields[name] = value.replace(/\s+/g, ' ').trim()
    const comma = body.slice(i).match(/^\s*,?/)
    i += comma ? comma[0].length : 0
  }
  return fields
}

/** Writes one entry back the way the mocks and the "Updated .bib" export format it. */
export function serializeBib(entry: Pick<BibEntry, 'type' | 'key' | 'fields'>): string {
  const lines = Object.entries(entry.fields).map(([name, value]) => `  ${name} = {${value}},`)
  return `@${entry.type}{${entry.key},\n${lines.join('\n')}\n}`
}

/** Keys defined more than once, each listed once. */
export function duplicateKeys(entries: BibEntry[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.key)) dupes.add(e.key)
    seen.add(e.key)
  }
  return [...dupes]
}

/** True when the entry gives no way to look the work up online. The same fields as the
 * gateway's lacks_locator (backend/app/author/logic.py), so both flag the same entries. */
export function lacksLocator(entry: BibEntry): boolean {
  const f = entry.fields
  return !(f.doi || f.url || f.eprint || f.arxiv)
}

/** "Khattab & Zaharia" · "Santhanam et al." from a BibTeX author field. */
export function shortAuthors(author: string): string {
  const names = author
    .split(/\s+and\s+/i)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.includes(',') ? n.split(',')[0] : n.split(/\s+/).pop() ?? n).trim())
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}
