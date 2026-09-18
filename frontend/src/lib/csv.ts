/** Shared CSV escaping and browser download helpers. */

export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Prefix CSV text with a BOM so Excel on Windows detects UTF-8 correctly. */
export function csvText(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  return `\uFEFF${body}`
}

export function downloadText(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
