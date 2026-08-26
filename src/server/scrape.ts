import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import { HARVEST_NEW_CONNECTIONS, HARVEST_TOTAL, SCROLL_TO_END } from './harvest.ts'
import { CONNECTIONS_URL, profileUrl } from './linkedin.ts'
import type { Connection } from './types.ts'

type Card = {
  id: string
  name: string
  headline: string
  connectedText: string
  avatarUrl: string
}

const parseConnectedText = (text: string): number | undefined => {
  const date = Date.parse(text.replace(/^[^\d]*/, ''))
  return Number.isFinite(date) ? date : undefined
}

/**
 * Cards are accumulated across scroll rounds rather than snapshotted at the
 * end: LinkedIn virtualises the list, so rows scrolled past are gone from the
 * DOM long before the list stops growing.
 */
async function absorb(page: Page, into: Map<string, Card>): Promise<void> {
  const cards = (await page.evaluate(HARVEST_NEW_CONNECTIONS)) as Card[]
  for (const card of cards) if (!into.has(card.id)) into.set(card.id, card)
}

export async function scrapeConnections(
  onProgress: (count: number, total: number | null) => void,
): Promise<Connection[]> {
  const page = await workPage()
  const cards = new Map<string, Card>()

  await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await absorb(page, cards)

  const declared = (await page.evaluate(HARVEST_TOTAL)) as number | null
  const target = declared === null ? null : Math.min(declared, config.maxConnections)
  onProgress(cards.size, target)

  let idleRounds = 0
  while (idleRounds < config.scrollIdleRounds && cards.size < config.maxConnections) {
    if (target !== null && cards.size >= target) break

    const before = cards.size
    await page.evaluate(SCROLL_TO_END)
    // LinkedIn stalls mid-list for seconds at a time; back off rather than
    // mistaking a pause for the end of the list.
    await page.waitForTimeout(config.scrollWaitMs * (1 + Math.min(idleRounds, 4)))
    await absorb(page, cards)
    idleRounds = cards.size > before ? 0 : idleRounds + 1
    onProgress(cards.size, target)
  }

  return [...cards.values()].slice(0, config.maxConnections).map((card) => ({
    id: card.id,
    name: card.name || card.id,
    headline: card.headline,
    profileUrl: profileUrl(card.id),
    avatarUrl: card.avatarUrl || undefined,
    connectedAt: parseConnectedText(card.connectedText),
  }))
}
