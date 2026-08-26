import type { Locator, Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import { DATASETS } from './datasets.ts'
import type { ActionResult, DatasetKind, Entity } from './types.ts'

// LinkedIn renders in the account's own language, so every control is matched
// against its English and Turkish labels.
const MORE_ACTIONS = /^(more actions|.* için diğer işlemler)/i
const REMOVE_ITEM = /^(remove connection|bağlantıyı kaldır|bağlantıdan çıkar)/i
// The confirmation button reads "Remove connection", not "Remove"; matching the
// short label alone leaves the dialog hanging open. "Cancel" must not match.
const CONFIRM_BUTTON = /^(remove connection|remove|unfollow|bağlantıyı kaldır|kaldır|takibi bırak)$/i
const STOP_FOLLOWING = /stop following|takibi bırak/i

const jitter = () => {
  const { removalDelayMinMs: min, removalDelayMaxMs: max } = config
  return min + Math.random() * Math.max(0, max - min)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const visible = (locator: Locator, timeout: number) =>
  locator
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false)

async function ensureOn(page: Page, url: string, marker: string): Promise<void> {
  if (page.url().includes(marker)) return
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
}

/**
 * LinkedIn uses a native <dialog>, which carries the dialog role implicitly and
 * so is invisible to an attribute selector like [role="dialog"].
 */
async function confirmDialog(page: Page): Promise<string | null> {
  const dialog = page.locator('dialog[open], [role="dialog"], [role="alertdialog"]').first()
  if (!(await visible(dialog, 4000))) return null

  const confirm = dialog.getByRole('button', { name: CONFIRM_BUTTON }).first()
  if (!(await visible(confirm, 3000))) {
    // Leaving a half-open dialog behind would block every later action.
    await page.keyboard.press('Escape').catch(() => {})
    const labels = await dialog.getByRole('button').allInnerTexts().catch(() => [])
    return `Confirmation dialog has no recognised button (saw: ${labels.join(', ') || 'none'})`
  }

  await confirm.click()
  return null
}

// ---------------------------------------------------------------- connections

const searchBox = (page: Page) => page.locator('main input[placeholder*="Search by name" i]').first()

/**
 * Filters the list down to one person rather than scrolling to find them. The
 * name is what the box matches; the card is then picked by profile id, so two
 * people with the same name cannot be confused.
 */
function connectionCard(page: Page, entity: Entity): Locator {
  return page
    .locator('[componentkey^="ConnectionCard_"]')
    .filter({ has: page.locator(`a[href*="/in/${encodeURIComponent(entity.id)}"]`) })
    .first()
}

async function filterTo(page: Page, name: string): Promise<void> {
  const box = searchBox(page)
  if (!(await visible(box, 5000))) return
  await box.fill('')
  await page.waitForTimeout(500)
  await box.fill(name)
  await page.waitForTimeout(1800)
}

async function removeConnection(
  page: Page,
  entity: Entity,
  dryRun: boolean,
): Promise<ActionResult> {
  const base = { id: entity.id, name: entity.name }

  await ensureOn(page, DATASETS.connections.url, '/mynetwork/invite-connect/connections')
  if (/\/(login|uas|checkpoint|signup)/.test(page.url())) {
    return { ...base, outcome: 'failed', error: 'LinkedIn asked to log in again' }
  }

  await filterTo(page, entity.name)
  const card = connectionCard(page, entity)
  if (!(await visible(card, 5000))) {
    return { ...base, outcome: 'already-gone', error: 'Not in the connections list' }
  }

  const moreActions = card.getByRole('button', { name: MORE_ACTIONS }).first()
  if (!(await visible(moreActions, 4000))) {
    return { ...base, outcome: 'failed', error: 'Card has no "More actions" button' }
  }
  await moreActions.click()

  const removeItem = page.getByRole('menuitem', { name: REMOVE_ITEM }).first()
  if (!(await visible(removeItem, 4000))) {
    await page.keyboard.press('Escape').catch(() => {})
    return { ...base, outcome: 'failed', error: 'Menu has no "Remove connection" entry' }
  }

  if (dryRun) {
    // A dry run never clicks the entry. Whether LinkedIn asks to confirm after
    // that click is its decision, not something to gamble a real connection on.
    await page.keyboard.press('Escape').catch(() => {})
    return { ...base, outcome: 'would-do' }
  }

  await removeItem.click()
  const problem = await confirmDialog(page)
  if (problem) return { ...base, outcome: 'failed', error: problem }

  await page.waitForTimeout(2000)
  await filterTo(page, entity.name)
  if ((await connectionCard(page, entity).count()) > 0) {
    return { ...base, outcome: 'failed', error: 'Still listed as a connection afterwards' }
  }

  return { ...base, outcome: 'done' }
}

// ------------------------------------------------------------------ unfollows

/**
 * The manager lists keep the row in place after unfollowing and flip the button
 * from "stop following" to "follow", so that label is both the control and the
 * proof the action landed.
 */
async function unfollow(
  page: Page,
  kind: Extract<DatasetKind, 'pages' | 'following'>,
  entity: Entity,
  dryRun: boolean,
): Promise<ActionResult> {
  const base = { id: entity.id, name: entity.name }
  const spec = DATASETS[kind]
  const marker = kind === 'pages' ? '/network-manager/company' : '/network-manager/people-follow'
  const linkPath = kind === 'pages' ? `/company/${entity.id}` : `/in/${encodeURIComponent(entity.id)}`

  await ensureOn(page, spec.url, marker)
  if (/\/(login|uas|checkpoint|signup)/.test(page.url())) {
    return { ...base, outcome: 'failed', error: 'LinkedIn asked to log in again' }
  }

  const row = page
    .locator('[data-chameleon-result-urn]')
    .filter({ has: page.locator(`a[href*="${linkPath}"]`) })
    .first()

  // The row may be further down a long, lazily paged list.
  if (!(await visible(row, 3000))) {
    await row.scrollIntoViewIfNeeded().catch(() => {})
    if (!(await visible(row, 3000))) {
      return { ...base, outcome: 'already-gone', error: 'Not in the list' }
    }
  }

  const button = row.getByRole('button', { name: STOP_FOLLOWING }).first()
  if (!(await visible(button, 3000))) {
    return { ...base, outcome: 'already-gone', error: 'Not currently followed' }
  }

  if (dryRun) return { ...base, outcome: 'would-do' }

  await button.click()
  const problem = await confirmDialog(page)
  if (problem) return { ...base, outcome: 'failed', error: problem }

  // The label flips to "follow" only once the request lands, which can take a
  // few seconds; sampling once after a fixed pause calls a success a failure.
  const flipped = await button
    .waitFor({ state: 'hidden', timeout: 10000 })
    .then(() => true)
    .catch(() => false)

  if (!flipped) {
    return { ...base, outcome: 'failed', error: 'Still shows as followed afterwards' }
  }

  return { ...base, outcome: 'done' }
}

// ---------------------------------------------------------------------- runner

export type ActionProgress = (result: ActionResult, done: number, total: number) => void

export async function runActions(
  kind: DatasetKind,
  targets: Entity[],
  options: { dryRun: boolean; shouldStop: () => boolean },
  onProgress: ActionProgress,
): Promise<ActionResult[]> {
  // Removing a connection cannot be undone; unfollowing can, so it is not held
  // to the same cap.
  const limit = kind === 'connections' ? config.maxRemovalsPerRun : config.maxUnfollowsPerRun
  if (targets.length > limit) {
    throw new Error(
      `Refusing to ${DATASETS[kind].verb} ${targets.length} entries in one run (limit ${limit}). ` +
        `Split it up, or raise INCLEANUP_MAX_REMOVALS / INCLEANUP_MAX_UNFOLLOWS.`,
    )
  }

  const page = await workPage()
  const results: ActionResult[] = []

  for (const [index, entity] of targets.entries()) {
    if (options.shouldStop()) break

    let result: ActionResult
    try {
      result =
        kind === 'connections'
          ? await removeConnection(page, entity, options.dryRun)
          : await unfollow(page, kind, entity, options.dryRun)
    } catch (error) {
      result = {
        id: entity.id,
        name: entity.name,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    results.push(result)
    onProgress(result, index + 1, targets.length)

    if (index < targets.length - 1) await sleep(jitter())
  }

  return results
}
