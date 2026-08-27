import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const dataDir = path.join(os.tmpdir(), `incleanup-test-${process.pid}`)
process.env.INCLEANUP_DATA_DIR = dataDir

const { readEnrichment, readSnapshot, writeScannedSnapshot, writeSnapshot } = await import(
  './store.ts'
)

const entity = (id: string, mutual?: number) => ({
  id,
  name: id,
  headline: '',
  url: `https://example.com/${id}`,
  ...(mutual === undefined ? {} : { mutual }),
})

const knownCount = async () => {
  const snapshot = await readSnapshot('connections')
  return (snapshot?.entities ?? []).filter((e) => typeof e.mutual === 'number').length
}

before(() => fs.mkdir(dataDir, { recursive: true }))
after(() => fs.rm(dataDir, { recursive: true, force: true }))

/**
 * Shared-connection counts take minutes to gather and have twice been wiped by
 * a rescan: first because the scan wrote its result verbatim, then because it
 * re-read the baseline on every checkpoint and so merged against its own
 * partial output.
 */
test('a checkpointed rescan keeps counts it did not gather itself', async () => {
  const before = Array.from({ length: 1000 }, (_, i) => entity(`p${i}`, i < 600 ? i : undefined))
  await writeSnapshot('connections', before)
  assert.equal(await knownCount(), 600)

  // Read once, as a scan does — not per write.
  const enrichment = await readEnrichment('connections')
  const rescanned = Array.from({ length: 1000 }, (_, i) => entity(`p${i}`))

  for (let n = 200; n <= 1000; n += 200) {
    await writeScannedSnapshot('connections', rescanned.slice(0, n), enrichment)
  }

  assert.equal(await knownCount(), 600)
})

test('a rescan drops entries that are no longer in the list', async () => {
  await writeSnapshot('connections', [entity('a', 5), entity('b', 7)])
  const enrichment = await readEnrichment('connections')

  await writeScannedSnapshot('connections', [entity('a')], enrichment)

  const snapshot = await readSnapshot('connections')
  assert.deepEqual(
    snapshot?.entities.map((e) => e.id),
    ['a'],
  )
  assert.equal(snapshot?.entities[0]?.mutual, 5)
})
