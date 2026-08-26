export type DatasetKind = 'connections' | 'pages' | 'following'

export type DatasetInfo = { kind: DatasetKind; label: string; verb: 'remove' | 'unfollow' }

export type Entity = {
  id: string
  name: string
  headline: string
  url: string
  avatarUrl?: string
  connectedAt?: number
  /** undefined = not looked up, null = LinkedIn would not say. Neither is zero. */
  mutual?: number | null
}

export type Snapshot = { scrapedAt: number | null; entities: Entity[] }

export type Status = {
  chrome: boolean
  loggedIn: boolean
  hint: string | null
  activeJob?: { id: string; kind: string } | null
  datasets: DatasetInfo[]
}

export type ActionResult = {
  id: string
  name: string
  outcome: 'done' | 'would-do' | 'already-gone' | 'failed'
  error?: string
}

export type JobEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; done: number; total: number | null; message: string }
  | { type: 'result'; result: ActionResult }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error ?? response.statusText)
  return body as T
}

export const getStatus = () => json<Status>('/api/status')

export const getDataset = (kind: DatasetKind) => json<Snapshot>(`/api/datasets/${kind}`)

export const startScan = (kind: DatasetKind) =>
  json<{ jobId: string }>(`/api/datasets/${kind}/scan`, { method: 'POST' })

export const startEnrich = () =>
  json<{ jobId: string }>('/api/datasets/connections/enrich', { method: 'POST' })

export const startAction = (kind: DatasetKind, ids: string[], dryRun: boolean) =>
  json<{ jobId: string }>(`/api/datasets/${kind}/act`, {
    method: 'POST',
    body: JSON.stringify({ ids, dryRun }),
  })

export const stopJob = (id: string) => json<{ ok: true }>(`/api/jobs/${id}/stop`, { method: 'POST' })

export function subscribeToJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`)
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as JobEvent
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') source.close()
  }
  source.onerror = () => source.close()
  return () => source.close()
}
