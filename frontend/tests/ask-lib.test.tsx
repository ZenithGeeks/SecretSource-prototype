/**
 * The edges of the Ask libraries: a /command line that cannot be read, tool results with missing
 * fields, the screen agent's browser tools on an odd page, and the small helpers of lib/assistant.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeTool, runTool, type DraftReader, type ScreenActions, type ToolContext } from '../src/lib/agentTools'
import { allowedNames, readAccess } from '../src/lib/agentAccess'
import { describeResult, matchCommands, parseCommand } from '../src/lib/askCommands'
import { shortTitle, sourceLabel, sourceTarget } from '../src/lib/assistant'

vi.mock('../src/lib/supabase', () => ({ authEnabled: false, supabase: null, sessionStorageKey: '' }))

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('reading a /command line', () => {
  it('says there is no command when the line has no name at all', () => {
    expect(parseCommand('hello', [])).toEqual({ error: 'There is no / command. Type / to see them.' })
    expect(matchCommands('/ge').map((c) => c.name)).toEqual(['get_analysis', 'get_claim', 'get_gaps'])
  })

  it('suggests an example with a placeholder paper name when the library is empty', () => {
    expect(parseCommand('/get_analysis', [])).toEqual({ error: 'Name a paper with @, for example /get_analysis @Paper' })
    expect(parseCommand('/get_claim', [], 'open1')).toEqual({ error: 'Add the claim number, for example /get_claim @Paper 2' })
  })

  it('takes the claim number of the open paper when none is named', () => {
    expect(parseCommand('/get_claim 4', [], 'open1')).toEqual({ name: 'get_claim', args: { analysis_id: 'open1', claim_number: 4 } })
  })
})

describe('reading a tool result with fields missing', () => {
  it('reads check_text with nothing to check, and with no results at all', () => {
    expect(describeResult('check_text', { results: [{ text: 'A.', source: 's.pdf' }] }).note).toBeUndefined()
    expect(describeResult('check_text', { results: [] })).toEqual({ statements: [], note: 'No sentence long enough to check.' })
    expect(describeResult('check_text', {}).note).toBe('No sentence long enough to check.')
  })

  it('reads a statement whose page and judge fields are absent', () => {
    expect(describeResult('check_text', { results: [{ text: 'A.', source: 's.pdf', page: '3' }] }).statements).toEqual([
      { index: 0, text: 'A.', source: 's.pdf', page: undefined, verdict: undefined, quote: undefined, reasoning: undefined },
    ])
  })

  it('shows the passages that bear on a claim as statements, or says none does', () => {
    const found = describeResult('find_support', { passages: [{ text: 'P.', paper: 'x.pdf', page: 5, verdict: 'supports' }] })
    expect(found.statements).toEqual([expect.objectContaining({ text: 'P.', source: 'x.pdf', page: 5, verdict: 'supports' })])
    expect(describeResult('find_support', {})).toEqual({ view: { kind: 'message', text: 'No passage in your papers bears on this.' } })
  })

  it('defaults a claim and its verdicts to unchecked', () => {
    const { view } = describeResult('get_claim', { number: 2, claim: 'C', verdicts: [{ cited: 'Smith' }], unchecked: [{ source: 's', reason: 'r' }] })
    expect(view).toMatchObject({
      standing: 'unchecked',
      verdicts: [{ cited: 'Smith', verdict: 'unchecked', quote: '', reasoning: '' }],
      unchecked: [{ source: 's', reason: 'r' }],
    })
    expect(describeResult('get_analysis', { claims: [{ number: 1, claim: 'C' }] }).view).toMatchObject({ claims: [{ standing: 'unchecked' }] })
  })

  it('says no claim shares the words, and marks none when the query is not text', () => {
    expect(describeResult('search_claims', {})).toEqual({ view: { kind: 'message', text: 'No claim shares those words.' } })
    expect(describeResult('search_claims', { claims: [{ number: 1, claim: 'C', standing: 'backed' }] }).view).toMatchObject({ highlight: [] })
  })

  it('reads the page find_in_paper found, or null', () => {
    expect(describeResult('find_in_paper', { page: 7 }).view).toEqual({ kind: 'page', page: 7 })
    expect(describeResult('find_in_paper', { page: null }).view).toEqual({ kind: 'page', page: null })
  })

  it('counts the gaps by list length, and reads bibtex, a started analysis and progress', () => {
    expect(describeResult('get_gaps', { notBacked: [1, 2], contradicted: [1] }).view).toEqual({ kind: 'gaps', notBacked: 2, contradicted: 1, missing: 0 })
    expect(describeResult('bibtex', { bibtex: '@article{a}' }).view).toEqual({ kind: 'code', text: '@article{a}' })
    expect(describeResult('submit_analysis', { id: 'a9' }).view).toEqual({ kind: 'started', id: 'a9' })
    expect(describeResult('labeling_progress', { saved: 1, claims: 4, reviewed: 2, next_unsaved: null }).view).toMatchObject({ next: null })
    expect(describeResult('labeling_progress', { saved: 1, claims: 4, reviewed: 2, next_unsaved: { number: 3, claim: 'Next' } }).view).toMatchObject({
      next: { number: 3, claim: 'Next' },
    })
  })

  it('prints a tool it does not know as JSON', () => {
    expect(describeResult('mystery', { a: 1 })).toEqual({ note: JSON.stringify({ a: 1 }, null, 2) })
  })
})

describe('what a source line says', () => {
  it('names the file, with a page when the passage has one, and cuts a title at its colon', () => {
    const statement = { index: 0, text: 'T', source: 'paper.PDF' }
    expect(sourceLabel(statement)).toBe('paper')
    expect(sourceLabel({ ...statement, page: 4 }, 'A Title')).toBe('A Title · p. 4')
    expect(sourceTarget(statement)).toEqual({ paper: 'paper.PDF', label: 'paper', source: null, page: undefined, quote: undefined })
    expect(shortTitle('InstructBLIP: Towards General-purpose Models')).toBe('InstructBLIP')
    expect(shortTitle(': only a subtitle')).toBe(': only a subtitle')
  })
})

describe('the access setting', () => {
  it('reads full, and lists what each level allows', () => {
    expect(readAccess({ level: 'full' })).toEqual({ level: 'full' })
    expect(allowedNames({ level: 'read' })).not.toContain('open_screen')
    expect(allowedNames({ level: 'custom', tools: ['bibtex'] })).toEqual(['bibtex'])
  })
})

const actions = (over: Partial<ScreenActions> = {}): ScreenActions => ({ screen: 'library', screens: ['home', 'library'], openScreen: vi.fn(), ...over })
const context = (over: Partial<ToolContext> = {}): ToolContext => ({ actions: actions(), point: vi.fn(), confirm: vi.fn(async () => true), ...over })

describe('describing a tool call', () => {
  it('has one line for each tool, and the name of one it does not know', () => {
    const line = (name: string, args: Record<string, unknown> = {}) => describeTool({ id: '1', name, args })
    expect(line('read_screen')).toBe('Reading the screen')
    expect(line('open_screen', { screen: 'graph' })).toBe('Opening graph')
    expect(line('open_paper')).toBe('Opening the paper')
    expect(line('point_at', { target: 'paper:a1', note: 'This one' })).toBe('Pointing: This one')
    expect(line('point_at', { target: 'paper:a1' })).toBe('Pointing: paper:a1')
    expect(line('fill_field', { text: 'hi' })).toBe('Filling in: “hi”')
    expect(line('switch_role', { role: 'author' })).toBe('Switching to the Author role')
    expect(line('read_draft', { file: 'main.tex' })).toBe('Reading main.tex')
    expect(line('read_draft')).toBe('Reading the draft')
    expect(line('delete_everything')).toBe('delete_everything')
  })
})

describe('the screen agent tools on an odd page', () => {
  it('says so when the agent calls a tool the app does not have', async () => {
    expect(await runTool({ id: '1', name: 'delete_everything', args: {} }, context())).toEqual({
      status: 'error',
      message: 'there is no tool named delete_everything in this app',
    })
  })

  it('open_paper fails in a role with no papers, and opens one otherwise', async () => {
    expect(await runTool({ id: '1', name: 'open_paper', args: { analysis_id: 'a1' } }, context())).toMatchObject({ status: 'error' })
    const openPaper = vi.fn()
    expect(await runTool({ id: '2', name: 'open_paper', args: { analysis_id: 'a1' } }, context({ actions: actions({ openPaper }) }))).toEqual({ status: 'done' })
    expect(openPaper).toHaveBeenCalledWith('a1')
  })

  it('read_screen labels a thing by its placeholder, its title, or nothing', async () => {
    document.body.innerHTML = `
      <input data-ask-target="field:a" placeholder="Search here" />
      <div data-ask-target="paper:b" title="Hover text"></div>
      <div data-ask-target="paper:c"></div>`
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const result = await runTool({ id: '1', name: 'read_screen', args: {} }, context())
    expect(result.targets).toEqual([
      { target: 'field:a', label: 'Search here' },
      { target: 'paper:b', label: 'Hover text' },
      { target: 'paper:c', label: '' },
    ])
  })

  it('point_at moves the cursor to a target that is on the screen', async () => {
    document.body.innerHTML = '<button data-ask-target="paper:a1">ColBERTv2</button>'
    const point = vi.fn()
    const done = await runTool({ id: '1', name: 'point_at', args: { target: 'paper:a1', note: 'Here it is' } }, context({ point }))
    expect(done).toEqual({ status: 'done' })
    expect(point).toHaveBeenCalledWith({ target: { kind: 'paper', id: 'a1' }, tone: 'shows', label: 'Here it is' })
  })

  it('point_at refuses a name that has no kind, even when an element carries it', async () => {
    document.body.innerHTML = '<button data-ask-target="plain">Plain</button><button data-ask-target=":x">Empty kind</button>'
    for (const target of ['plain', ':x']) {
      expect(await runTool({ id: '1', name: 'point_at', args: { target, note: 'n' } }, context())).toMatchObject({ status: 'error' })
    }
  })

  it('fill_field refuses what is not a text field, whatever its name', async () => {
    document.body.innerHTML = '<input data-ask-target="plain" /><button data-ask-target="paper:a1">Paper</button>'
    for (const target of ['plain', 'paper:a1', 'field:missing']) {
      const confirm = vi.fn(async () => true)
      expect(await runTool({ id: '1', name: 'fill_field', args: { target, text: 'x' } }, context({ confirm }))).toMatchObject({ status: 'error' })
      expect(confirm).not.toHaveBeenCalled()
    }
  })

  it('fill_field types into a textarea, and calls an unlabeled field "this field"', async () => {
    document.body.innerHTML = '<textarea data-ask-target="field:note"></textarea>'
    const confirm = vi.fn(async () => true)
    const field = document.querySelector('textarea')!
    const typed = vi.fn()
    field.addEventListener('input', typed)

    expect(await runTool({ id: '1', name: 'fill_field', args: { target: 'field:note', text: 'hello' } }, context({ confirm }))).toEqual({ status: 'applied' })
    expect(confirm).toHaveBeenCalledWith({ summary: 'Type “hello” into this field.', action: 'Apply' })
    expect(field.value).toBe('hello')
    expect(typed).toHaveBeenCalled()
  })

  it('switch_role names a missing role, and leaves the reason out when there is none', async () => {
    const base = { switchRole: vi.fn() }
    const none = await runTool({ id: '1', name: 'switch_role', args: {} }, context({ actions: actions(base), onSwitched: vi.fn() }))
    expect(none).toEqual({ status: 'error', message: 'no role (none); roles: researcher, labeler, author' })

    const confirm = vi.fn(async () => true)
    const onSwitched = vi.fn()
    const call = { id: '2', name: 'switch_role', args: { role: 'labeler' } }
    // actions.role is not set: the researcher's app.
    expect(await runTool(call, context({ actions: actions(base), confirm, onSwitched }))).toEqual({ status: 'switched' })
    expect(confirm).toHaveBeenCalledWith({ summary: 'Switch to the Labeler role.', action: 'Switch' })
    expect(onSwitched).toHaveBeenCalledWith('labeler')
  })

  it('switch_role switches without asking about unsaved work when the app has no such check', async () => {
    const onSwitched = vi.fn()
    const call = { id: '1', name: 'switch_role', args: { role: 'labeler', reason: '  ' } }
    expect(await runTool(call, context({ actions: actions({ switchRole: vi.fn() }), onSwitched }))).toEqual({ status: 'switched' })
  })
})

describe('read_draft', () => {
  const reader = (over: Partial<DraftReader> = {}): DraftReader => ({
    draft: () => ({ id: 'd1', title: 'Thesis' }),
    active: undefined,
    files: () => [{ name: 'main.tex', kind: 'tex', dirty: false }],
    read: (file) => (file === 'main.tex' ? 'one\ntwo' : undefined),
    bibKeys: () => [],
    ...over,
  })
  const read = (draft: DraftReader) => runTool({ id: '1', name: 'read_draft', args: {} }, context({ actions: actions({ draftEditor: () => draft }) }))

  it('opens the first file when the editor shows none', async () => {
    expect(await read(reader())).toMatchObject({ file: 'main.tex', text: '1\tone\n2\ttwo' })
  })
})
