import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { config } from './config.ts'
import { ChromeUnreachableError, checkLoggedIn, isReachable } from './browser.ts'
import { currentJob, getJob, JobBusyError, startJob } from './jobs.ts'
import { removeConnections } from './remove.ts'
import { scrapeConnections } from './scrape.ts'
import { dropFromSnapshot, logRemovals, readSnapshot, writeSnapshot } from './store.ts'
import type { Connection, JobEvent } from './types.ts'

const app = express()
app.use(express.json({ limit: '2mb' }))

// The server drives a real browser session; refuse anything not from this machine.
app.use((req, res, next) => {
  const host = req.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return next()
  res.status(403).json({ error: 'incleanup only accepts local requests.' })
})

app.get('/api/status', async (_req, res) => {
  const chrome = await isReachable()
  if (!chrome) {
    return res.json({
      chrome: false,
      loggedIn: false,
      hint: new ChromeUnreachableError(config.cdpPort).message,
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
  })
})

app.get('/api/connections', async (_req, res) => {
  const snapshot = await readSnapshot()
  res.json(snapshot ?? { scrapedAt: null, connections: [] })
})

app.post('/api/scrape', (_req, res) => {
  try {
    const job = startJob('scrape', async (j) => {
      j.emit({ type: 'log', message: 'Opening your LinkedIn connections page…' })
      const connections = await scrapeConnections({
        onProgress: (count, total) =>
          j.emit({
            type: 'progress',
            done: count,
            total,
            message: total ? `${count} of ${total} connections` : `${count} connections found`,
          }),
        onCheckpoint: async (partial) => {
          await writeSnapshot(partial)
          j.emit({ type: 'log', message: `Saved ${partial.length} so far.` })
        },
        shouldStop: () => j.shouldStop,
      })
      await writeSnapshot(connections)
      return `Found ${connections.length} connections.`
    })
    res.json({ jobId: job.state.id })
  } catch (error) {
    res.status(error instanceof JobBusyError ? 409 : 500).json({ error: message(error) })
  }
})

app.post('/api/remove', async (req, res) => {
  const ids: unknown = req.body?.ids
  const dryRun = req.body?.dryRun === true
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || ids.length === 0) {
    return res.status(400).json({ error: 'Expected a non-empty `ids` array of strings.' })
  }

  const snapshot = await readSnapshot()
  const known = new Map((snapshot?.connections ?? []).map((c) => [c.id, c]))
  const targets = (ids as string[])
    .map((id) => known.get(id))
    .filter((c): c is Connection => c !== undefined)

  if (targets.length === 0) {
    return res.status(400).json({ error: 'None of those ids are in the current snapshot.' })
  }

  try {
    const job = startJob('remove', async (j) => {
      j.emit({
        type: 'log',
        message: dryRun
          ? `Dry run: locating ${targets.length} people and checking the remove control.`
          : `Removing ${targets.length} connections.`,
      })

      const results = await removeConnections(
        targets,
        { dryRun, shouldStop: () => j.shouldStop },
        (result, done, total) => {
          j.emit({ type: 'result', result })
          j.emit({ type: 'progress', done, total, message: `${result.name}: ${result.outcome}` })
        },
      )

      if (!dryRun) {
        await logRemovals(results)
        await dropFromSnapshot(
          new Set(
            results.filter((r) => r.outcome !== 'failed').map((r) => r.id),
          ),
        )
      }

      const gone = results.filter((r) => r.outcome === 'already-gone').length
      const failed = results.filter((r) => r.outcome === 'failed').length
      if (dryRun) {
        const ready = results.filter((r) => r.outcome === 'would-remove').length
        return `Dry run: ${ready} ready to remove, ${gone} not in the list, ${failed} unreachable.`
      }
      const removed = results.filter((r) => r.outcome === 'removed').length
      return `${removed} removed, ${gone} already gone, ${failed} failed.`
    })
    res.json({ jobId: job.state.id })
  } catch (error) {
    res.status(error instanceof JobBusyError ? 409 : 500).json({ error: message(error) })
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

app.listen(config.port, '127.0.0.1', () => {
  console.log(`incleanup api → http://127.0.0.1:${config.port}`)
})
