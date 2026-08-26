export type Connection = {
  id: string
  name: string
  headline: string
  profileUrl: string
  avatarUrl?: string
  connectedAt?: number
}

export type Snapshot = { scrapedAt: number | null; connections: Connection[] }

export type Status = {
  chrome: boolean
  loggedIn: boolean
  hint: string | null
  activeJob: { id: string; kind: string } | null
}

export type RemovalResult = {
  id: string
  name: string
  outcome: 'removed' | 'already-gone' | 'failed'
  error?: string
}

export type JobEvent =
  | { type: 'log'; message: string }
  | { type: 'progress'; done: number; total: number | null; message: string }
  | { type: 'result'; result: RemovalResult }
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
export const getConnections = () => json<Snapshot>('/api/connections')
export const startScrape = () => json<{ jobId: string }>('/api/scrape', { method: 'POST' })
export const stopJob = (id: string) => json<{ ok: true }>(`/api/jobs/${id}/stop`, { method: 'POST' })

export const startRemoval = (ids: string[], dryRun: boolean) =>
  json<{ jobId: string }>('/api/remove', {
    method: 'POST',
    body: JSON.stringify({ ids, dryRun }),
  })

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
