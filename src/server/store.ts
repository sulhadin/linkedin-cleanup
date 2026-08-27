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

export type Enrichment = Map<string, number | null | undefined>

/**
 * Read once before a scan starts. It cannot be re-read per write: a scan
 * checkpoints as it goes, so by the second checkpoint the stored snapshot is
 * the scan's own partial result, and merging against that erases everything
 * the earlier checkpoints had not yet reached.
 */
export async function readEnrichment(kind: DatasetKind): Promise<Enrichment> {
  const snapshot = await readSnapshot(kind)
  return new Map((snapshot?.entities ?? []).map((entity) => [entity.id, entity.mutual]))
}

/**
 * A scan only knows what the list page shows, so writing its result verbatim
 * would erase anything looked up separately — shared-connection counts take
 * minutes to gather and must survive a rescan.
 */
export async function writeScannedSnapshot(
  kind: DatasetKind,
  entities: Entity[],
  enrichment: Enrichment,
): Promise<Snapshot> {
  return writeSnapshot(
    kind,
    entities.map((entity) => {
      const mutual = enrichment.get(entity.id)
      return mutual === undefined ? entity : { ...entity, mutual }
    }),
  )
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

const whitelistPath = () => path.join(config.dataDir, 'whitelist.json')

type Whitelist = Partial<Record<DatasetKind, string[]>>

export async function readWhitelist(): Promise<Whitelist> {
  try {
    const parsed = JSON.parse(await fs.readFile(whitelistPath(), 'utf8')) as Whitelist
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export async function readProtectedIds(kind: DatasetKind): Promise<Set<string>> {
  return new Set((await readWhitelist())[kind] ?? [])
}

/**
 * The whitelist is the one list that must never be lost to a mistake elsewhere,
 * so it lives in its own file rather than as a flag inside a snapshot a rescan
 * rewrites.
 */
export async function setProtected(
  kind: DatasetKind,
  ids: string[],
  isProtected: boolean,
): Promise<string[]> {
  await ensureDataDir()
  const whitelist = await readWhitelist()
  const current = new Set(whitelist[kind] ?? [])

  for (const id of ids) {
    if (isProtected) current.add(id)
    else current.delete(id)
  }

  whitelist[kind] = [...current]
  const tmp = path.join(config.dataDir, `whitelist.${process.pid}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(whitelist, null, 2), 'utf8')
  await fs.rename(tmp, whitelistPath())
  return whitelist[kind]!
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
