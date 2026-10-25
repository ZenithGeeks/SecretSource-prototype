/**
 * Author smoke test (#711), through the real gateway and worker (README.md in this folder).
 *
 * "Author flow" is the path an author takes: import a .bib → open a draft → edit it →
 * Re-check → Replace with \cite → Compare. Its steps are serial tests on one page, so the
 * report names the step that broke; the steps after it are skipped, as they depend on it.
 *
 * "Bugs found on main" holds one independent test per bug the smoke run found on main, each
 * with its own project. While a bug is open its test checks its preconditions first and only
 * then calls test.fail() with the bug's issue, so a broken precondition is a real failure, the
 * bug itself is an expected one, and the test fails once the bug is fixed. The fix drops the
 * test.fail(), and the test stays as a regression test.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import type { CheckRun } from '../src/types/draftCheck.ts'

const BIB = fileURLToPath(new URL('./fixtures/smoke.bib', import.meta.url))

// The first version cites one entry that is in the .bib and one that is not (missing key).
const DRAFT = String.raw`\documentclass{article}
\begin{document}
\section{Smoke}
Late interaction works~\cite{alpha2020}.
Distillation helps~\cite{gamma2019}.
\bibliography{smoke}
\end{document}
`

const ISSUES = 'https://github.com/ZenithGeeks/SecretSource-prototype/issues'
const BUG_TIP_COVERS_NEW_DRAFT = `The first-run "Ask AI about your papers" tip covers New draft: ${ISSUES}/724`
const BUG_NONE_LOWER = `An entry with nothing to look up fails with "'NoneType' object has no attribute 'lower'": ${ISSUES}/726`
const NO_REPLACE = `No "Replace with \\cite{…}" control on main since #291 removed Find a source: ${ISSUES}/721`

/** A project name no earlier run used, so a stack reused across runs never matches an older one. */
const uniqueName = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

// --- the gateway, through the dev server's /api proxy as the app reaches it ----------------

async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/author${path}`)
  expect(response.ok(), `GET /author${path}`).toBe(true)
  return (await response.json()) as T
}

/** Imports the fixture .bib as a new project; returns the project's id. */
async function importBib(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/author/projects/import', {
    multipart: { file: { name: `${name}.bib`, mimeType: 'text/plain', buffer: await readFile(BIB) } },
  })
  expect(response.ok(), 'POST /author/projects/import').toBe(true)
  return ((await response.json()) as { id: string }).id
}

/** A draft in the project with one main.tex; returns the draft's id. */
async function createDraft(request: APIRequestContext, projectId: string, tex: string): Promise<string> {
  const response = await request.post('/api/author/drafts', {
    data: { title: 'Smoke draft', projectId, files: [{ name: 'main.tex', content: tex }] },
  })
  expect(response.ok(), 'POST /author/drafts').toBe(true)
  return ((await response.json()) as { id: string }).id
}

/** Waits for a check to leave running and returns it as the gateway stored it. */
async function finishedCheck(request: APIRequestContext, id: string): Promise<CheckRun> {
  await expect.poll(async () => (await apiGet<CheckRun>(request, `/checks/${id}`)).status, { timeout: 4 * 60_000 }).not.toBe('running')
  const run = await apiGet<CheckRun>(request, `/checks/${id}`)
  expect(run.status, `check ${id} ended "${run.status}": ${run.message ?? ''}`).toBe('done')
  return run
}

async function runCheck(request: APIRequestContext, draftId: string): Promise<CheckRun> {
  const response = await request.post(`/api/author/drafts/${draftId}/check`)
  expect(response.status(), 'POST /author/drafts/{id}/check').toBe(200)
  return finishedCheck(request, ((await response.json()) as { id: string }).id)
}

const projectUrl = (projectId: string) => `/?role=writer&screen=library&project=${projectId}`
const editor = (page: Page) => page.locator('.cm-content').first()
const fileTabs = (page: Page) => page.getByRole('tablist', { name: 'Project files' })

/** Dismisses the first-run Ask tip if it shows within a moment (#724). */
async function dismissAskTip(page: Page) {
  const tip = page.getByRole('button', { name: 'Got it' })
  try {
    await tip.waitFor({ state: 'visible', timeout: 3_000 })
    await tip.click()
  } catch {
    // no tip: this browser has seen it, or it is gone
  }
}

/** Replaces the open file's text and waits for the autosave. insertText skips the \cite
 * completion popup. */
async function setEditorText(page: Page, text: string) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/author\/drafts\/[^/]+\/files\//.test(r.url()))
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  expect((await saved).ok(), 'PUT /author/drafts/{id}/files/{name}').toBe(true)
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(/·\s*saved/)
}

test.describe('Author flow', () => {
  test.describe.configure({ mode: 'serial' })

  const project = uniqueName('smoke')
  const runs: CheckRun[] = []
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
  })

  test.afterAll(async () => {
    await page.close()
  })

  /** Presses Re-check and waits for the run to finish. A fixture check takes about 2 s,
   * often too short to see "Checking…", so it waits on the run itself. */
  async function recheck(): Promise<CheckRun> {
    const button = page.getByRole('button', { name: /^(Re-check|Checking…)$/ })
    await expect(button).toHaveText('Re-check')
    const started = page.waitForResponse((r) => /\/author\/drafts\/[^/]+\/check$/.test(r.url()) && r.request().method() === 'POST')
    await button.click()
    const response = await started
    expect(response.status(), 'POST /author/drafts/{id}/check').toBe(200)
    const run = await finishedCheck(page.request, ((await response.json()) as { id: string }).id)
    await expect(button).toHaveText('Re-check')
    await expect(page.getByText(/The check failed|Re-check failed/)).toHaveCount(0)
    runs.push(run)
    return run
  }

  test('import a .bib into a new project', async () => {
    await page.goto('/?role=writer&screen=library')
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
    const imported = page.waitForResponse((r) => r.url().includes('/author/projects/import'))
    await page.getByLabel('Import a .bib or an Overleaf .zip').setInputFiles({
      name: `${project}.bib`,
      mimeType: 'application/x-bibtex',
      buffer: await readFile(BIB),
    })
    expect((await imported).ok(), 'POST /author/projects/import').toBe(true)
    await expect(page.getByText(project).first()).toBeVisible()
  })

  test('open a new draft in the project', async () => {
    await page.getByText(project).first().click()
    await expect(page.getByRole('heading', { name: project })).toBeVisible()
    await expect(page.getByText(/2 entries/)).toBeVisible()
    await dismissAskTip(page)
    await page.getByRole('button', { name: 'New draft' }).click()
    await expect(editor(page)).toBeVisible()
    // The project's .bib is part of the draft as a shared file.
    await expect(fileTabs(page)).toContainText(`${project}.bib`)
  })

  test('edit the draft and save it', async () => {
    await setEditorText(page, DRAFT)
    await expect(editor(page)).toContainText(String.raw`\cite{gamma2019}`)
  })

  test('Re-check records the first version', async () => {
    const run = await recheck()
    const gamma = run.citations?.find((c) => c.key === 'gamma2019')
    expect(gamma, 'gamma2019 is not in the .bib').toMatchObject({ verdict: 'unchecked', reason: 'missing-key' })
  })

  test('Replace with \\cite{…} fixes the missing key', async () => {
    await expect(editor(page)).toContainText(String.raw`\cite{gamma2019}`)
    test.fail(true, NO_REPLACE)
    await page.getByText(String.raw`\cite{gamma2019}`).first().click()
    const replace = page.getByRole('button', { name: /Replace with \\cite\{beta2021\}/ })
    await expect(replace).toBeVisible({ timeout: 5_000 })
    await replace.click()
    await expect(editor(page)).toContainText(String.raw`\cite{beta2021}`)
  })

  test('Re-check after an edit records the next version', async () => {
    // Stands in for Replace until #721: the same change made by hand.
    await setEditorText(page, DRAFT.replace('gamma2019', 'beta2021'))
    const run = await recheck()
    expect(run.version).toBeGreaterThan(runs[0].version)
  })

  test('Compare the two versions in the project', async () => {
    const [first, second] = runs
    await page.goto('/?role=writer&screen=library')
    await page.getByText(project).first().click()
    // A missing bib key is a bibliography warning, not an open issue, so the box counts no fix.
    await expect(page.getByText(`Since v${first.version}`)).toBeVisible()
    await page.getByRole('button', { name: `Compare v${second.version} with v${first.version}` }).click()
    await expect(page.getByText(new RegExp(`v${second.version} vs v${first.version} · \\d+ changes?`))).toBeVisible()
    await expect(page.getByText(String.raw`\cite{beta2021}`)).toBeVisible()
  })
})

test.describe('Bugs found on main', () => {
  test('the project page opens with New draft clickable', async ({ page }) => {
    const name = uniqueName('tip')
    const projectId = await importBib(page.request, name)
    await page.goto(projectUrl(projectId))
    await expect(page.getByRole('heading', { name })).toBeVisible()
    const newDraft = page.getByRole('button', { name: 'New draft' })
    await expect(newDraft).toBeVisible()
    test.fail(true, BUG_TIP_COVERS_NEW_DRAFT)
    // trial: every check a click makes, including that nothing covers the button, without clicking.
    await newDraft.click({ trial: true, timeout: 5_000 })
  })

  test("the project's .bib stays in the editor after a save", async ({ page }) => {
    const name = uniqueName('bib')
    const draftId = await createDraft(page.request, await importBib(page.request, name), DRAFT)
    await page.goto(`/?role=writer&screen=editor&draft=${draftId}`)
    await expect(fileTabs(page)).toContainText(`${name}.bib`)
    await setEditorText(page, DRAFT.replace('Smoke', 'Smoke, edited'))
    // #725, fixed: an autosave's answer carries the project's .bib.
    await expect(fileTabs(page)).toContainText(`${name}.bib`, { timeout: 5_000 })
  })

  test('an entry with nothing to look up gets a readable reason', async ({ page }) => {
    const draftId = await createDraft(page.request, await importBib(page.request, uniqueName('reason')), DRAFT)
    const run = await runCheck(page.request, draftId)
    const alpha = run.citations?.find((c) => c.key === 'alpha2020')
    expect(alpha, 'the check lists \\cite{alpha2020}').toBeDefined()
    expect(alpha?.verdict, 'alpha2020 has nothing to look up, so it cannot be supported').not.toBe('supports')
    test.fail(true, BUG_NONE_LOWER)
    expect(alpha?.message ?? '').not.toMatch(/NoneType|has no attribute/)
  })

  test('a run with no supported citation is not labelled "all supported"', async ({ page }) => {
    const name = uniqueName('label')
    const projectId = await importBib(page.request, name)
    const run = await runCheck(page.request, await createDraft(page.request, projectId, DRAFT))
    expect(run.summary.checked, 'the run checked at least one citation').toBeGreaterThan(0)
    expect(run.citations?.some((c) => c.verdict === 'supports'), 'no fixture citation can be supported').toBe(false)
    await page.goto(projectUrl(projectId))
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await expect(page.getByText(/checked just now/).first()).toBeVisible()
    // #727, fixed: the label follows the counts.
    await expect(page.getByText('all supported')).toHaveCount(0, { timeout: 3_000 })
    await expect(page.getByRole('list', { name: 'Drafts in this project' })).toContainText(/\d+ unavailable/)
  })
})
