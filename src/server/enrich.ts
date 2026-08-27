import { config } from './config.ts'
import { workPage } from './browser.ts'
import type { Entity } from './types.ts'

/**
 * The connections page never mentions shared connections, but 1st-degree people
 * search prints them under every result. Each result is one anchor wrapping the
 * whole row, so its own text already carries the mutual line. The
 * mutual-connection *names* are anchors too, so a row only counts when it shows
 * a degree marker or a mutual line — otherwise those names become fake results.
 */
const HARVEST_SEARCH_RESULTS = `(() => {
  const best = new Map()

  for (const anchor of document.querySelectorAll('a[href*="/in/"]')) {
    const match = (anchor.getAttribute('href') || '').match(/\\/in\\/([^/?#]+)/)
    if (!match) continue

    const text = (anchor.innerText || '').replace(/\\n+/g, ' | ')
    if (!/•\\s*1st\\b|•\\s*1\\.|mutual connection|ortak ba\\u011flant/i.test(text)) continue

    const id = decodeURIComponent(match[1])
    const previous = best.get(id)
    if (!previous || text.length > previous.length) best.set(id, text)
  }

  return [...best.entries()].map((entry) => ({ id: entry[0], text: entry[1] }))
})()`

/**
 * "A, B & 19 other mutual connections" → 21; "A & B are mutual connections" → 2;
 * "A is a mutual connection" → 1; no such line at all → 0.
 */
export function parseMutualCount(text: string): number {
  const others = text.match(/&\s*([\d,.]+)\s*other\s+mutual\s+connection/i)
  if (others) {
    const rest = Number(others[1]!.replace(/[^\d]/g, ''))
    return Number.isFinite(rest) ? rest + 2 : 2
  }
  if (/\bare\s+mutual\s+connections\b/i.test(text)) return 2
  if (/\bis\s+a\s+mutual\s+connection\b/i.test(text)) return 1
  return 0
}

export type EnrichOptions = {
  onProgress: (done: number, total: number | null) => void
  onCheckpoint: (patches: Map<string, Partial<Entity>>) => Promise<void>
  shouldStop: () => boolean
}

export type EnrichResult = {
  patches: Map<string, Partial<Entity>>
  pagesRead: number
  hitCap: boolean
}

/**
 * Walks 1st-degree people search page by page. LinkedIn caps this search at
 * roughly 1,000 results, so on a larger network the tail simply never appears —
 * those entries keep `mutual: null` rather than being recorded as zero.
 */
export async function enrichMutuals(options: EnrichOptions): Promise<EnrichResult> {
  const { onProgress, onCheckpoint, shouldStop } = options
  const page = await workPage()
  const patches = new Map<string, Partial<Entity>>()

  let pagesRead = 0
  let emptyPages = 0

  for (let pageNumber = 1; pageNumber <= config.maxEnrichPages; pageNumber++) {
    if (shouldStop()) break

    let rows: { id: string; text: string }[]
    try {
      await page.goto(
        `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&page=${pageNumber}`,
        { waitUntil: 'domcontentloaded' },
      )
      await page.waitForTimeout(2600)
      rows = (await page.evaluate(HARVEST_SEARCH_RESULTS)) as { id: string; text: string }[]
    } catch {
      // A tab closed or a navigation refused mid-run should not throw away the
      // pages already gathered — this takes minutes to collect.
      break
    }
    pagesRead = pageNumber

    if (rows.length === 0) {
      emptyPages += 1
      if (emptyPages >= 2) break
      continue
    }
    emptyPages = 0

    for (const row of rows) {
      if (!patches.has(row.id)) patches.set(row.id, { mutual: parseMutualCount(row.text) })
    }

    onProgress(patches.size, null)

    if (pageNumber % 10 === 0) await onCheckpoint(patches)
  }

  return { patches, pagesRead, hitCap: pagesRead >= config.maxEnrichPages }
}
