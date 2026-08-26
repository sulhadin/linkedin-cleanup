import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import type { Connection, RemovalResult } from './types.ts'

// LinkedIn renders in the account's own language, so every control is matched
// against its English and Turkish labels.
const MORE_BUTTON = /^(more|more actions|daha fazla)/i
const REMOVE_ITEM = /(remove connection|bağlantıyı kaldır|bağlantıdan çıkar)/i
const CONFIRM_BUTTON = /^(remove|kaldır|çıkar)$/i

const jitter = () => {
  const { removalDelayMinMs: min, removalDelayMaxMs: max } = config
  return min + Math.random() * Math.max(0, max - min)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openMoreMenu(page: Page): Promise<boolean> {
  const button = page.getByRole('button', { name: MORE_BUTTON }).first()
  if (!(await button.isVisible().catch(() => false))) return false
  await button.click()
  await page.waitForTimeout(600)
  return true
}

async function removeOne(page: Page, connection: Connection, dryRun: boolean): Promise<RemovalResult> {
  const base = { id: connection.id, name: connection.name }

  await page.goto(connection.profileUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  if (/\/(login|uas|checkpoint|signup)/.test(page.url())) {
    return { ...base, outcome: 'failed', error: 'LinkedIn asked to log in again' }
  }
  if (page.url().includes('/404') || (await page.title()).match(/page not found/i)) {
    return { ...base, outcome: 'already-gone', error: 'Profile is unavailable' }
  }

  if (!(await openMoreMenu(page))) {
    return { ...base, outcome: 'failed', error: 'Could not find the profile "More" menu' }
  }

  const removeItem = page.getByText(REMOVE_ITEM).first()
  if (!(await removeItem.isVisible().catch(() => false))) {
    // No remove entry means the connection is already gone — the menu offers
    // "Connect" or "Follow" instead.
    await page.keyboard.press('Escape').catch(() => {})
    return { ...base, outcome: 'already-gone' }
  }

  await removeItem.click()
  await page.waitForTimeout(800)

  const dialog = page.getByRole('dialog').first()
  const confirm = dialog.getByRole('button', { name: CONFIRM_BUTTON }).first()
  if (!(await confirm.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {})
    return { ...base, outcome: 'failed', error: 'Confirmation dialog did not appear' }
  }

  if (dryRun) {
    await page.keyboard.press('Escape').catch(() => {})
    return { ...base, outcome: 'removed' }
  }

  await confirm.click()
  await page.waitForTimeout(1500)
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

    results.push(result)
    onProgress(result, index + 1, targets.length)

    if (index < targets.length - 1) await sleep(jitter())
  }

  return results
}
