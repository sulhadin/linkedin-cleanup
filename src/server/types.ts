export type Connection = {
  /** LinkedIn public identifier, e.g. `john-doe-1a2b3c`. Stable primary key. */
  id: string
  name: string
  headline: string
  profileUrl: string
  avatarUrl?: string
  /** Epoch ms of when the connection was made, when LinkedIn reports it. */
  connectedAt?: number
}

export type Snapshot = {
  scrapedAt: number
  connections: Connection[]
}

export type RemovalOutcome = 'removed' | 'already-gone' | 'failed'

export type RemovalResult = {
  id: string
  name: string
  outcome: RemovalOutcome
  error?: string
}

export type JobKind = 'scrape' | 'remove'

export type JobEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; done: number; total: number | null; message: string }
  | { type: 'result'; result: RemovalResult }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }

export type JobState = {
  id: string
  kind: JobKind
  startedAt: number
  finishedAt?: number
  status: 'running' | 'done' | 'error'
  events: JobEvent[]
}
