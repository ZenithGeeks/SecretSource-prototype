import assert from 'node:assert/strict'
import test from 'node:test'

import { toCsv } from '../src/lib/claims.ts'

test('claims CSV starts with a UTF-8 BOM for spreadsheet imports', () => {
  const csv = toCsv([
    {
      claim: 'A claim with a "quoted" phrase',
      citations: [],
    },
  ])

  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /"A claim with a ""quoted"" phrase"/)
})
