import { config } from './config.ts'
import { workPage } from './browser.ts'
import { clickLoadMore, DATASETS, SCROLL_TO_END, type RawCard } from './datasets.ts'
import type { DatasetKind, Entity } from './types.ts'

export type ScanOptions = {
  onProgress: (count: number, total: number | null) => void
  /** Called periodically so a scan interrupted halfway is not wasted. */
  onCheckpoint: (entities: Entity[]) => Promise<void>
  shouldStop: () => boolean
}

export async function scanDataset(kind: DatasetKind, options: ScanOptions): Promise<Entity[]> {
  const { onProgress, onCheckpoint, shouldStop } = options
  const spec = DATASETS[kind]
  const page = await workPage()
  const cards = new Map<string, RawCard>()

  const absorb = async () => {
    const fresh = (await page.evaluate(spec.harvest)) as RawCard[]
    for (const card of fresh) if (!cards.has(card.id)) cards.set(card.id, card)
  }

  await page.goto(spec.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await absorb()

  const declared = (await page.evaluate(spec.total)) as number | null
  const target = declared === null ? null : Math.min(declared, config.maxConnections)
  onProgress(cards.size, target)

  let idleRounds = 0
  let checkpointedAt = 0

  while (idleRounds < config.scrollIdleRounds && cards.size < config.maxConnections) {
    if (shouldStop()) break
    if (target !== null && cards.size >= target) break

    const before = cards.size
    await page.evaluate(SCROLL_TO_END)
    await clickLoadMore(page)
    // LinkedIn stalls mid-list for seconds at a time; back off rather than
    // mistaking a pause for the end of the list.
    await page.waitForTimeout(config.scrollWaitMs * (1 + Math.min(idleRounds, 4)))
    await absorb()
    idleRounds = cards.size > before ? 0 : idleRounds + 1
    onProgress(cards.size, target)

    if (cards.size - checkpointedAt >= config.checkpointEvery) {
      checkpointedAt = cards.size
      await onCheckpoint([...cards.values()].map(spec.toEntity))
    }
  }

  return [...cards.values()].slice(0, config.maxConnections).map(spec.toEntity)
}
