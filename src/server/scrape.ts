import type { Page } from 'playwright-core'
import { config } from './config.ts'
import { workPage } from './browser.ts'
import type { Connection } from './types.ts'
import { CONNECTIONS_URL, isConnectionsPayload, parseConnectionsPayload } from './voyager.ts'

export type DomCard = { id: string; name: string; headline: string }

/**
 * The DOM is the authority on *who is actually in the list* — the JSON payloads
 * also carry the viewer's own profile and any suggestion rails on the page.
 * Cards are grouped by parent so the largest sibling group (the real list) wins.
 */
const harvestDom = (page: Page): Promise<DomCard[]> =>
  page.evaluate(() => {
    const cards = new Map<Element, { id: string; name: string; headline: string }[]>()

    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')) {
      if (anchor.closest('nav, header, aside, footer')) continue

      const id = anchor.getAttribute('href')?.match(/\/in\/([^/?#]+)/)?.[1]
      if (!id) continue

      const card = anchor.closest('li') ?? anchor.parentElement
      if (!card) continue

      const buttons = [...card.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
      if (buttons.some((t) => /^(connect|follow|withdraw|accept|ignore)$/i.test(t))) continue

      const lines = (card as HTMLElement).innerText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const name = (anchor.innerText || lines[0] || '').split('\n')[0]?.trim() ?? ''
      if (name.length === 0) continue

      const headline =
        lines.find(
          (line) =>
            line !== name &&
            !/^(message|connected|• )/i.test(line) &&
            !/^\d+(st|nd|rd|th)$/i.test(line) &&
            line.length > 2,
        ) ?? ''

      const parent = card.parentElement ?? card
      const group = cards.get(parent) ?? []
      if (!group.some((entry) => entry.id === id)) group.push({ id, name, headline })
      cards.set(parent, group)
    }

    let largest: { id: string; name: string; headline: string }[] = []
    for (const group of cards.values()) if (group.length > largest.length) largest = group
    return largest
  })

async function loadMore(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const showMore = page
    .getByRole('button', { name: /show more results|load more/i })
    .first()
  if (await showMore.isVisible().catch(() => false)) {
    await showMore.click().catch(() => {})
  }
  await page.waitForTimeout(1200)
}

export async function scrapeConnections(
  onProgress: (count: number) => void,
): Promise<Connection[]> {
  const page = await workPage()
  const meta = new Map<string, Connection>()

  const onResponse = (response: { url: () => string; json: () => Promise<unknown> }) => {
    if (!isConnectionsPayload(response.url())) return
    void response
      .json()
      .then((payload) => parseConnectionsPayload(payload, meta))
      .catch(() => {})
  }

  page.on('response', onResponse)
  try {
    await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    let cards = await harvestDom(page)
    let idleRounds = 0

    while (idleRounds < config.scrollIdleRounds && cards.length < config.maxConnections) {
      const before = cards.length
      await loadMore(page)
      cards = await harvestDom(page)
      idleRounds = cards.length > before ? 0 : idleRounds + 1
      onProgress(cards.length)
    }

    return cards.slice(0, config.maxConnections).map((card) => {
      const enriched = meta.get(card.id)
      return {
        id: card.id,
        name: enriched?.name || card.name,
        headline: enriched?.headline || card.headline,
        profileUrl: `https://www.linkedin.com/in/${card.id}/`,
        avatarUrl: enriched?.avatarUrl,
        connectedAt: enriched?.connectedAt,
      }
    })
  } finally {
    page.off('response', onResponse)
  }
}
