import type { DatasetInfo } from './api.ts'

/**
 * Which lists exist is a fixed property of the app, not something to ask the
 * server for: fetching it meant the whole navigation vanished whenever the API
 * was unreachable. The server still owns the mechanics — URLs, harvesters —
 * this is only what the tabs need to render.
 */
export const DATASETS: DatasetInfo[] = [
  { kind: 'connections', label: 'Connections', short: 'Connections', verb: 'remove' },
  { kind: 'pages', label: 'Followed pages', short: 'Pages', verb: 'unfollow' },
  { kind: 'following', label: 'People you follow', short: 'Following', verb: 'unfollow' },
]
