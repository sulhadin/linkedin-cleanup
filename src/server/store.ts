import fs from 'node:fs/promises'
import path from 'node:path'
import { config, removalLogPath, snapshotPath } from './config.ts'
import type { Connection, RemovalResult, Snapshot } from './types.ts'

const ensureDataDir = () => fs.mkdir(config.dataDir, { recursive: true })

export async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await fs.readFile(snapshotPath, 'utf8')
    const parsed = JSON.parse(raw) as Snapshot
    if (!Array.isArray(parsed.connections)) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeSnapshot(connections: Connection[]): Promise<Snapshot> {
  await ensureDataDir()
  const snapshot: Snapshot = { scrapedAt: Date.now(), connections }
  const tmp = path.join(config.dataDir, `connections.${process.pid}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.rename(tmp, snapshotPath)
  return snapshot
}

export async function dropFromSnapshot(ids: Set<string>): Promise<void> {
  const snapshot = await readSnapshot()
  if (!snapshot) return
  await writeSnapshot(snapshot.connections.filter((c) => !ids.has(c.id)))
}

/**
 * Removals are irreversible on LinkedIn's side, so every attempt is appended to
 * a local log the user can consult to re-invite someone they cut by mistake.
 */
export async function logRemovals(results: RemovalResult[]): Promise<void> {
  if (results.length === 0) return
  await ensureDataDir()
  const stamp = new Date().toISOString()
  const lines = results.map(
    (r) => `${stamp}\t${r.outcome}\t${r.id}\t${r.name}${r.error ? `\t${r.error}` : ''}`,
  )
  await fs.appendFile(removalLogPath, `${lines.join('\n')}\n`, 'utf8')
}
