/** The lists incleanup can read and prune. */
export type DatasetKind = 'connections' | 'pages' | 'following'

export type Entity = {
  /** Public identifier: profile slug for people, numeric id for company pages. */
  id: string
  name: string
  /** Headline for people, follower count for pages. */
  headline: string
  url: string
  avatarUrl?: string
  /** People only: when the connection was made. */
  connectedAt?: number
  /**
   * People only: shared connections. `undefined` means not looked up yet,
   * `null` means LinkedIn would not tell us — never treat either as zero.
   */
  mutual?: number | null
}

export type Snapshot = {
  scrapedAt: number
  entities: Entity[]
}

export type ActionOutcome = 'done' | 'would-do' | 'already-gone' | 'failed'

export type ActionResult = {
  id: string
  name: string
  outcome: ActionOutcome
  error?: string
}

export type JobKind = 'scan' | 'act' | 'enrich'

export type JobEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; done: number; total: number | null; message: string }
  | { type: 'result'; result: ActionResult }
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
