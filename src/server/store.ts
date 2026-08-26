import fs from 'node:fs/promises'
import path from 'node:path'
import { config, actionLogPath } from './config.ts'
import type { ActionResult, DatasetKind, Entity, Snapshot } from './types.ts'

const ensureDataDir = () => fs.mkdir(config.dataDir, { recursive: true })

const snapshotPath = (kind: DatasetKind) => path.join(config.dataDir, `${kind}.json`)

export async function readSnapshot(kind: DatasetKind): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(snapshotPath(kind), 'utf8')) as Snapshot
    return Array.isArray(parsed.entities) ? parsed : null
  } catch {
    return null
  }
}

export async function writeSnapshot(kind: DatasetKind, entities: Entity[]): Promise<Snapshot> {
  await ensureDataDir()
  const snapshot: Snapshot = { scrapedAt: Date.now(), entities }
  const tmp = path.join(config.dataDir, `${kind}.${process.pid}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.rename(tmp, snapshotPath(kind))
  return snapshot
}

export async function dropFromSnapshot(kind: DatasetKind, ids: Set<string>): Promise<void> {
  const snapshot = await readSnapshot(kind)
  if (!snapshot) return
  await writeSnapshot(
    kind,
    snapshot.entities.filter((entity) => !ids.has(entity.id)),
  )
}

/**
 * Merges freshly looked-up fields into the stored snapshot without disturbing
 * anything the enrichment pass does not know about.
 */
export async function mergeIntoSnapshot(
  kind: DatasetKind,
  patches: Map<string, Partial<Entity>>,
): Promise<void> {
  const snapshot = await readSnapshot(kind)
  if (!snapshot) return
  await writeSnapshot(
    kind,
    snapshot.entities.map((entity) => {
      const patch = patches.get(entity.id)
      return patch ? { ...entity, ...patch } : entity
    }),
  )
}

/**
 * Removals and unfollows are irreversible on LinkedIn's side, so every attempt
 * is appended to a local log the user can consult afterwards.
 */
export async function logActions(kind: DatasetKind, results: ActionResult[]): Promise<void> {
  if (results.length === 0) return
  await ensureDataDir()
  const stamp = new Date().toISOString()
  const lines = results.map(
    (r) => `${stamp}\t${kind}\t${r.outcome}\t${r.id}\t${r.name}${r.error ? `\t${r.error}` : ''}`,
  )
  await fs.appendFile(actionLogPath, `${lines.join('\n')}\n`, 'utf8')
}
