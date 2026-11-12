/**
 * zipStored: the Author's project .zip without a compression library (SCRUM-527). fflate, a
 * test-only dependency now, reads each archive back as an unzip tool would.
 */

import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { zipStored } from '../src/lib/zip'

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

describe('zipStored', () => {
  it('holds every file with its exact text, in order, under its own name', () => {
    const files = [
      { name: 'main.tex', content: '\\section{Intro}\nSee~\\cite{khattab2020}.\n' },
      { name: 'refs/ünïcode — names.bib', content: '@article{k, title={Café “quotes” ✓}}' },
      { name: 'empty.tex', content: '' },
    ]
    const read = unzipSync(zipStored(files))
    expect(Object.keys(read)).toEqual(files.map((f) => f.name))
    for (const f of files) expect(strFromU8(read[f.name])).toBe(f.content)
  })

  it('writes stored entries with UTF-8 names, the standard CRC-32 and the given time', () => {
    const bytes = zipStored([{ name: 'a.txt', content: '123456789' }], new Date(2026, 10, 13, 9, 30, 42))
    const head = view(bytes)
    expect(head.getUint32(0, true)).toBe(0x04034b50)
    expect(head.getUint16(6, true)).toBe(0x0800) // UTF-8 name
    expect(head.getUint16(8, true)).toBe(0) // stored
    expect(head.getUint32(14, true)).toBe(0xcbf43926) // CRC-32 check value of "123456789"
    expect(head.getUint16(10, true)).toBe((9 << 11) | (30 << 5) | 21) // 09:30:42, two-second steps
    expect(head.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 13)
    // The end record counts the entries and points at the central directory after the data.
    const end = view(bytes.subarray(bytes.length - 22))
    expect(end.getUint32(0, true)).toBe(0x06054b50)
    expect(end.getUint16(10, true)).toBe(1)
    expect(end.getUint32(16, true)).toBe(30 + 'a.txt'.length + 9)
  })

  it('makes a valid empty archive from no files', () => {
    const bytes = zipStored([])
    expect(bytes).toHaveLength(22)
    expect(unzipSync(bytes)).toEqual({})
  })
})
