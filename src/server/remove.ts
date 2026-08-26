import type { Locator, Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import { CONNECTIONS_URL } from './linkedin.ts'
import type { Connection, RemovalResult } from './types.ts'

// LinkedIn renders in the account's own language, so every control is matched
// against its English and Turkish labels.
const MORE_ACTIONS = /^(more actions|.* için diğer işlemler)/i
const REMOVE_ITEM = /^(remove connection|bağlantıyı kaldır|bağlantıdan çıkar)/i
const CONFIRM_BUTTON = /^(remove|kaldır|çıkar)$/i

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

async function openConnectionsPage(page: Page): Promise<void> {
  if (page.url().includes('/mynetwork/invite-connect/connections')) return
  await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
}

const searchBox = (page: Page) => page.locator('main input[placeholder*="Search by name" i]').first()

/**
 * Filters the list down to one person rather than scrolling to find them. The
 * name is what the box matches; the card is then picked by profile id, so two
 * people with the same name cannot be confused.
 */
async function findCard(page: Page, connection: Connection): Promise<Locator | null> {
  const box = searchBox(page)
  if (await visible(box, 5000)) {
    await box.fill('')
    await box.fill(connection.name)
    await page.waitForTimeout(1800)
  }

  const card = page
    .locator('[componentkey^="ConnectionCard_"]')
    .filter({ has: page.locator(`a[href*="/in/${encodeURIComponent(connection.id)}"]`) })
    .first()

  return (await visible(card, 5000)) ? card : null
}

async function clearSearch(page: Page): Promise<void> {
  const box = searchBox(page)
  if (await visible(box, 2000)) await box.fill('').catch(() => {})
}

async function removeOne(
  page: Page,
  connection: Connection,
  dryRun: boolean,
): Promise<RemovalResult> {
  const base = { id: connection.id, name: connection.name }

  await openConnectionsPage(page)
  if (/\/(login|uas|checkpoint|signup)/.test(page.url())) {
    return { ...base, outcome: 'failed', error: 'LinkedIn asked to log in again' }
  }

  const card = await findCard(page, connection)
  if (!card) {
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
    return { ...base, outcome: 'would-remove' }
  }

  await removeItem.click()

  const confirm = page.getByRole('dialog').getByRole('button', { name: CONFIRM_BUTTON }).first()
  if (await visible(confirm, 4000)) await confirm.click()

  await page.waitForTimeout(1500)

  const stillListed = await card
    .isVisible()
    .catch(() => false)
  if (stillListed) {
    return { ...base, outcome: 'failed', error: 'Card is still listed after the removal' }
  }

  return { ...base, outcome: 'removed' }
}

export type RemovalProgress = (result: RemovalResult, done: number, total: number) => void

export async function removeConnections(
  targets: Connection[],
  options: { dryRun: boolean; shouldStop: () => boolean },
  onProgress: RemovalProgress,
): Promise<RemovalResult[]> {
  if (targets.length > config.maxRemovalsPerRun) {
    throw new Error(
      `Refusing to remove ${targets.length} connections in one run (limit ${config.maxRemovalsPerRun}). ` +
        `Split it up, or raise INCLEANUP_MAX_REMOVALS.`,
    )
  }

  const page = await workPage()
  const results: RemovalResult[] = []

  for (const [index, connection] of targets.entries()) {
    if (options.shouldStop()) break

    let result: RemovalResult
    try {
      result = await removeOne(page, connection, options.dryRun)
    } catch (error) {
      result = {
        id: connection.id,
        name: connection.name,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    await clearSearch(page)
    results.push(result)
    onProgress(result, index + 1, targets.length)

    if (index < targets.length - 1) await sleep(jitter())
  }

  return results
}
