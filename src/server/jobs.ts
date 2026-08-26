import { randomUUID } from 'node:crypto'
import type { JobEvent, JobKind, JobState } from './types.ts'

type Subscriber = (event: JobEvent) => void

class Job {
  readonly state: JobState
  private readonly subscribers = new Set<Subscriber>()
  private stopRequested = false

  constructor(kind: JobKind) {
    this.state = { id: randomUUID(), kind, startedAt: Date.now(), status: 'running', events: [] }
  }

  emit(event: JobEvent): void {
    this.state.events.push(event)
    if (event.type === 'done' || event.type === 'error') {
      this.state.status = event.type === 'done' ? 'done' : 'error'
      this.state.finishedAt = Date.now()
    }
    for (const subscriber of this.subscribers) subscriber(event)
  }

  subscribe(subscriber: Subscriber): () => void {
    for (const event of this.state.events) subscriber(event)
    if (this.state.status !== 'running') return () => {}
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  requestStop(): void {
    this.stopRequested = true
  }

  get shouldStop(): boolean {
    return this.stopRequested
  }
}

export class JobBusyError extends Error {
  constructor(kind: JobKind) {
    super(`A ${kind} job is already running.`)
    this.name = 'JobBusyError'
  }
}

const jobs = new Map<string, Job>()
let active: Job | null = null

export function currentJob(): Job | null {
  return active && active.state.status === 'running' ? active : null
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

/**
 * One job at a time: every job drives the same Chrome tab, so overlapping runs
 * would fight over navigation.
 */
export function startJob(kind: JobKind, run: (job: Job) => Promise<string>): Job {
  const running = currentJob()
  if (running) throw new JobBusyError(running.state.kind)

  const job = new Job(kind)
  jobs.set(job.state.id, job)
  active = job

  void run(job)
    .then((summary) => job.emit({ type: 'done', summary }))
    .catch((error: unknown) =>
      job.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
    .finally(() => {
      if (active === job) active = null
    })

  return job
}

export type { Job }
