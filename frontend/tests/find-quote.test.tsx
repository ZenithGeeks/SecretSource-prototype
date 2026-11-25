/** findQuote: the passage's page is only a hint, so a part match there does not stop the search. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const findInPaper = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  api: { findInPaper },
}))

import { findQuote } from '../src/lib/findQuote'

const at = (page: number, coverage?: number) => ({ page, boxes: [], page_width: 600, page_height: 800, coverage })
const nothing = { page: null, boxes: [] }

describe('findQuote', () => {
  beforeEach(() => findInPaper.mockReset())

  it('keeps a whole match on the hinted page without searching further', async () => {
    findInPaper.mockResolvedValueOnce(at(1, 1))
    expect(await findQuote('p', 'q', 1)).toEqual(at(1, 1))
    expect(findInPaper).toHaveBeenCalledTimes(1)
  })

  it('takes the next page when it holds the quote better than the part match on the hint', async () => {
    findInPaper.mockResolvedValueOnce(at(1, 0.85)).mockResolvedValueOnce(at(2, 1))
    expect((await findQuote('p', 'q', 1))?.page).toBe(2)
    expect(findInPaper).toHaveBeenLastCalledWith('p', 'q')
  })

  it('keeps the hinted page on a tie, and when the paper search finds nothing', async () => {
    findInPaper.mockResolvedValueOnce(at(1, 0.9)).mockResolvedValueOnce(at(3, 0.9))
    expect((await findQuote('p', 'q', 1))?.page).toBe(1)
    findInPaper.mockResolvedValueOnce(at(1)).mockRejectedValueOnce(new Error('down'))
    expect((await findQuote('p', 'q', 1))?.page).toBe(1)
  })

  it('searches the whole paper without a hint, and gives null when no page holds the quote', async () => {
    findInPaper.mockResolvedValueOnce(at(4))
    expect((await findQuote('p', 'q'))?.page).toBe(4)
    findInPaper.mockResolvedValueOnce(nothing).mockResolvedValueOnce(nothing)
    expect(await findQuote('p', 'q', 2)).toBeNull()
  })
})
