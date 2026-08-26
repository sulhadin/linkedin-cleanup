export const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'

/** Profile ids can contain non-ASCII characters, so the path segment is re-encoded. */
export const profileUrl = (id: string) => `https://www.linkedin.com/in/${encodeURIComponent(id)}/`
