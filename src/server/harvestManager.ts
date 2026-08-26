/**
 * Browser-side harvesting for the network-manager lists (followed pages and
 * followed people). These run the classic LinkedIn markup rather than the
 * componentkey-based rewrite used by the connections page, so cards carry
 * `data-chameleon-result-urn` and the action is a plain artdeco button.
 *
 * Passed as source strings for the same reason as `harvest.ts`: tsx's esbuild
 * `keepNames` would inject a `__name` helper that does not exist in the page.
 */

const cardHarvester = (linkPattern: string, idPattern: string) => `(() => {
  if (!window.__incleanupManagerSeen) window.__incleanupManagerSeen = new Set()
  const seen = window.__incleanupManagerSeen

  const rows = document.querySelectorAll('[data-chameleon-result-urn]')
  const found = []

  for (const row of rows) {
    const link = row.querySelector('a[href*="${linkPattern}"]')
    if (!link) continue

    const match = (link.getAttribute('href') || '').match(${idPattern})
    if (!match) continue
    const id = decodeURIComponent(match[1])
    if (seen.has(id)) continue

    const lines = (row.innerText || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) continue

    // Rows read: name, then a detail line, then the Following button.
    const name = lines[0]
    const headline =
      lines.find(
        (line) =>
          line !== name && !/^(following|takip|unfollow|takibi b\\u0131rak)$/i.test(line),
      ) || ''

    const img = row.querySelector('img')
    const avatarUrl = img && /^https?:/.test(img.src) ? img.src : ''

    seen.add(id)
    found.push({ id: id, name: name, headline: headline, avatarUrl: avatarUrl })
  }

  return found
})()`

export const HARVEST_PAGES = cardHarvester('/company/', String.raw`/\/company\/([^/?#]+)/`)
export const HARVEST_FOLLOWED_PEOPLE = cardHarvester('/in/', String.raw`/\/in\/([^/?#]+)/`)

/** The declared total, e.g. "148 pages" or "You are following 4 people". */
export const HARVEST_MANAGER_TOTAL = `(() => {
  const text = document.body.innerText
  const match =
    text.match(/([\\d][\\d.,]*)\\s+(pages|sayfa)/i) ||
    text.match(/following\\s+([\\d][\\d.,]*)\\s+people/i)
  if (!match) return null
  const count = Number(match[1].replace(/[^\\d]/g, ''))
  return Number.isFinite(count) && count > 0 ? count : null
})()`
