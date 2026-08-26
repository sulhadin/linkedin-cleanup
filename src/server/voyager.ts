import type { Connection } from './types.ts'

const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'

export const isConnectionsPayload = (url: string) =>
  url.includes('/voyager/api/') && /relationships|connections/i.test(url)

type Json = unknown
const isObject = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null

const str = (v: Json): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

/**
 * LinkedIn ships several profile shapes and renames them regularly, so rather
 * than pinning a `$type` we walk the whole payload and keep anything that looks
 * like a member: a public identifier plus a name.
 */
function collectProfiles(
  node: Json,
  inheritedCreatedAt: number | undefined,
  out: Map<string, Connection>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectProfiles(item, inheritedCreatedAt, out)
    return
  }
  if (!isObject(node)) return

  const createdAt =
    typeof node.createdAt === 'number' && node.createdAt > 0 ? node.createdAt : inheritedCreatedAt

  const id = str(node.publicIdentifier)
  const firstName = str(node.firstName)
  const lastName = str(node.lastName)

  if (id && (firstName || lastName)) {
    const name = [firstName, lastName].filter(Boolean).join(' ')
    const existing = out.get(id)
    const connection: Connection = {
      id,
      name,
      headline: str(node.headline) ?? existing?.headline ?? '',
      profileUrl: `https://www.linkedin.com/in/${id}/`,
      avatarUrl: extractAvatar(node.profilePicture) ?? existing?.avatarUrl,
      connectedAt: createdAt ?? existing?.connectedAt,
    }
    out.set(id, connection)
  }

  for (const value of Object.values(node)) collectProfiles(value, createdAt, out)
}

function extractAvatar(picture: Json): string | undefined {
  if (!isObject(picture)) return undefined
  const stack: Json[] = [picture]
  let root: string | undefined
  let segment: string | undefined
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    if (!isObject(node)) continue
    root ??= str(node.rootUrl)
    segment ??= str(node.fileIdentifyingUrlPathSegment)
    stack.push(...Object.values(node))
  }
  return root && segment ? `${root}${segment}` : undefined
}

export function parseConnectionsPayload(payload: Json, out: Map<string, Connection>): void {
  collectProfiles(payload, undefined, out)
}

export { CONNECTIONS_URL }
