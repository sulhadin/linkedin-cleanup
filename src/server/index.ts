import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { config } from './config.ts'
import { ChromeUnreachableError, checkLoggedIn, closeTabOnExit, isReachable } from './browser.ts'
import { runActions } from './actions.ts'
import { DATASETS } from './datasets.ts'
import { enrichMutuals } from './enrich.ts'
import { currentJob, getJob, JobBusyError, startJob } from './jobs.ts'
import { scanDataset } from './scan.ts'
import {
  dropFromSnapshot,
  logActions,
  mergeIntoSnapshot,
  readSnapshot,
  writeScannedSnapshot,
  writeSnapshot,
} from './store.ts'
import type { DatasetKind, Entity, JobEvent } from './types.ts'

const app = express()
app.use(express.json({ limit: '2mb' }))

// The server drives a real browser session; refuse anything not from this machine.
app.use((req, res, next) => {
  const host = req.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return next()
  res.status(403).json({ error: 'incleanup only accepts local requests.' })
})

const isKind = (value: string): value is DatasetKind => value in DATASETS

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const fail = (res: express.Response, error: unknown) =>
  res.status(error instanceof JobBusyError ? 409 : 500).json({ error: message(error) })

const datasetList = () =>
  Object.entries(DATASETS).map(([kind, spec]) => ({ kind, label: spec.label, verb: spec.verb }))

app.get('/api/status', async (_req, res) => {
  if (!(await isReachable())) {
    return res.json({
      chrome: false,
      loggedIn: false,
      hint: new ChromeUnreachableError(config.cdpPort).message,
      datasets: datasetList(),
    })
  }

  // A running job owns the tab; probing it here would queue behind navigation.
  const job = currentJob()
  const loggedIn = job ? true : await checkLoggedIn().catch(() => false)
  res.json({
    chrome: true,
    loggedIn,
    hint: loggedIn ? null : 'Log in to LinkedIn in the incleanup browser window, then reload.',
    activeJob: job ? { id: job.state.id, kind: job.state.kind } : null,
    datasets: datasetList(),
  })
})

app.get('/api/datasets/:kind', async (req, res) => {
  const kind = req.params.kind
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown dataset.' })
  res.json((await readSnapshot(kind)) ?? { scrapedAt: null, entities: [] })
})

app.post('/api/datasets/:kind/scan', (req, res) => {
  const kind = req.params.kind
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown dataset.' })

  try {
    const job = startJob('scan', async (j) => {
      j.emit({ type: 'log', message: `Opening ${DATASETS[kind].label.toLowerCase()}…` })
      const entities = await scanDataset(kind, {
        onProgress: (count, total) =>
          j.emit({
            type: 'progress',
            done: count,
            total,
            message: total ? `${count} of ${total}` : `${count} found`,
          }),
        onCheckpoint: async (partial) => {
          await writeScannedSnapshot(kind, partial)
          j.emit({ type: 'log', message: `Saved ${partial.length} so far.` })
        },
        shouldStop: () => j.shouldStop,
      })
      await writeScannedSnapshot(kind, entities)
      return `Found ${entities.length}.`
    })
    res.json({ jobId: job.state.id })
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/datasets/connections/enrich', (_req, res) => {
  try {
    const job = startJob('enrich', async (j) => {
      j.emit({ type: 'log', message: 'Reading shared connections from 1st-degree search…' })
      const { patches, pagesRead, hitCap } = await enrichMutuals({
        onProgress: (done) =>
          j.emit({ type: 'progress', done, total: null, message: `${done} looked up` }),
        onCheckpoint: (partial) => mergeIntoSnapshot('connections', partial),
        shouldStop: () => j.shouldStop,
      })
      await mergeIntoSnapshot('connections', patches)

      const snapshot = await readSnapshot('connections')
      const unknown = (snapshot?.entities ?? []).filter((e) => e.mutual === undefined).length
      return unknown > 0 || hitCap
        ? `${patches.size} looked up over ${pagesRead} pages. ${unknown} left unknown — LinkedIn caps this search.`
        : `${patches.size} looked up over ${pagesRead} pages.`
    })
    res.json({ jobId: job.state.id })
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/datasets/:kind/act', async (req, res) => {
  const kind = req.params.kind
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown dataset.' })

  const ids: unknown = req.body?.ids
  const dryRun = req.body?.dryRun === true
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.length === 0) {
    return res.status(400).json({ error: 'Expected a non-empty `ids` array of strings.' })
  }

  const snapshot = await readSnapshot(kind)
  const known = new Map((snapshot?.entities ?? []).map((e) => [e.id, e]))
  const targets = (ids as string[])
    .map((id) => known.get(id))
    .filter((e): e is Entity => e !== undefined)

  if (targets.length === 0) {
    return res.status(400).json({ error: 'None of those ids are in the current snapshot.' })
  }

  const { verb, label } = DATASETS[kind]

  try {
    const job = startJob('act', async (j) => {
      j.emit({
        type: 'log',
        message: dryRun
          ? `Dry run: locating ${targets.length} in ${label.toLowerCase()}.`
          : `About to ${verb} ${targets.length}.`,
      })

      const results = await runActions(
        kind,
        targets,
        { dryRun, shouldStop: () => j.shouldStop },
        (result, done, total) => {
          j.emit({ type: 'result', result })
          j.emit({ type: 'progress', done, total, message: `${result.name}: ${result.outcome}` })
        },
      )

      if (!dryRun) {
        await logActions(kind, results)
        await dropFromSnapshot(
          kind,
          new Set(results.filter((r) => r.outcome !== 'failed').map((r) => r.id)),
        )
      }

      const gone = results.filter((r) => r.outcome === 'already-gone').length
      const failed = results.filter((r) => r.outcome === 'failed').length
      if (dryRun) {
        const ready = results.filter((r) => r.outcome === 'would-do').length
        return `Dry run: ${ready} ready to ${verb}, ${gone} not in the list, ${failed} unreachable.`
      }
      const done = results.filter((r) => r.outcome === 'done').length
      return `${done} ${verb === 'remove' ? 'removed' : 'unfollowed'}, ${gone} already gone, ${failed} failed.`
    })
    res.json({ jobId: job.state.id })
  } catch (error) {
    fail(res, error)
  }
})

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Unknown job.' })
  job.requestStop()
  res.json({ ok: true })
})

app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Unknown job.' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (event: JobEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
    if (event.type === 'done' || event.type === 'error') res.end()
  }

  const unsubscribe = job.subscribe(send)
  if (job.state.status !== 'running') res.end()
  req.on('close', unsubscribe)
})

if (process.env.NODE_ENV === 'production') {
  const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web')
  app.use(express.static(webRoot))
  app.get('*', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')))
}

closeTabOnExit()

app.listen(config.port, '127.0.0.1', () => {
  console.log(`incleanup api → http://127.0.0.1:${config.port}`)
})
